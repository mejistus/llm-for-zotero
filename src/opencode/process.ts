import { ensureDir, removePathQuietly } from "../utils/geckoFs";
import { joinLocalPath } from "../utils/localPath";
import { resolveOpenCodeBinaryPath } from "./binary";
import {
  OPENCODE_TEST_TIMEOUT_MS,
  OPENCODE_TURN_TIMEOUT_MS,
} from "./constants";
import {
  buildOpenCodeLaunchEnvironment,
  closeProcessStdin,
  loadOpenCodeSubprocessModule,
  readProcessStreamToString,
  waitForProcessExitCode,
} from "./subprocess";

export type OpenCodeUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
  cost?: number;
};

export type OpenCodeStreamEvent =
  | { type: "text"; text: string; sessionID?: string }
  | {
      type: "reasoning";
      summary?: string;
      details?: string;
      sessionID?: string;
    }
  | {
      type: "tool";
      tool: string;
      callID?: string;
      status?: string;
      input?: unknown;
      output?: string;
      sessionID?: string;
    }
  | {
      type: "step";
      phase: "start" | "finish";
      reason?: string;
      usage?: OpenCodeUsage;
      sessionID?: string;
    }
  | { type: "usage"; usage: OpenCodeUsage; sessionID?: string }
  | { type: "error"; message: string; sessionID?: string };

function asRecord(value: unknown): Record<string, any> | undefined {
  return value && typeof value === "object"
    ? (value as Record<string, any>)
    : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function readNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function readPositiveNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : undefined;
}

function readUsage(
  value: unknown,
  costValue?: unknown,
): OpenCodeUsage | undefined {
  const tokens = asRecord(value);
  if (!tokens) return undefined;
  const cache = asRecord(tokens.cache);
  const inputTokens = readNumber(tokens.input ?? tokens.inputTokens);
  const outputTokens = readNumber(tokens.output ?? tokens.outputTokens);
  const reasoningTokens = readNumber(
    tokens.reasoning ?? tokens.reasoningTokens,
  );
  const reportedTotal = readPositiveNumber(tokens.total);
  const rawCost = costValue !== undefined ? costValue : tokens.cost;
  const cost =
    typeof rawCost === "number" && Number.isFinite(rawCost)
      ? rawCost
      : undefined;
  return {
    inputTokens,
    outputTokens,
    totalTokens: reportedTotal ?? inputTokens + outputTokens + reasoningTokens,
    cacheReadTokens: readNumber(cache?.read ?? cache?.readTokens),
    cacheWriteTokens: readNumber(cache?.write ?? cache?.writeTokens),
    reasoningTokens,
    ...(cost !== undefined ? { cost } : {}),
  };
}

function readSessionID(
  raw: Record<string, any>,
  part?: Record<string, any>,
): string | undefined {
  return readString(raw.sessionID) || readString(part?.sessionID);
}

export function parseOpenCodeEventLine(
  line: string,
): OpenCodeStreamEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  let raw: Record<string, any>;
  try {
    const parsed = JSON.parse(trimmed);
    const record = asRecord(parsed);
    if (!record) return null;
    raw = record;
  } catch {
    return null;
  }

  const type = readString(raw.type);
  const part = asRecord(raw.part);
  const sessionID = readSessionID(raw, part);

  if (type === "text") {
    const text = readString(part?.text);
    if (text === undefined) return null;
    return { type: "text", text, ...(sessionID ? { sessionID } : {}) };
  }

  if (type === "reasoning") {
    const details = readString(part?.text);
    const summary = readString(part?.summary) || details;
    if (details === undefined && summary === undefined) return null;
    return {
      type: "reasoning",
      ...(summary !== undefined ? { summary } : {}),
      ...(details !== undefined ? { details } : {}),
      ...(sessionID ? { sessionID } : {}),
    };
  }

  if (type === "tool_use") {
    const tool = readString(part?.tool);
    if (!tool) return null;
    const state = asRecord(part?.state);
    const callID = readString(part?.callID);
    const status = readString(state?.status);
    const output = readString(state?.output);
    return {
      type: "tool",
      tool,
      ...(callID ? { callID } : {}),
      ...(status ? { status } : {}),
      ...(state && "input" in state ? { input: state.input } : {}),
      ...(output !== undefined ? { output } : {}),
      ...(sessionID ? { sessionID } : {}),
    };
  }

  if (type === "step_start") {
    return {
      type: "step",
      phase: "start",
      ...(sessionID ? { sessionID } : {}),
    };
  }

  if (type === "step_finish") {
    const reason = readString(part?.reason);
    const usage = readUsage(part?.tokens, part?.cost);
    return {
      type: "step",
      phase: "finish",
      ...(reason ? { reason } : {}),
      ...(usage ? { usage } : {}),
      ...(sessionID ? { sessionID } : {}),
    };
  }

  if (type === "usage") {
    const usage = readUsage(
      raw.usage ?? part?.tokens ?? part?.usage,
      raw.cost ?? part?.cost,
    );
    if (!usage) return null;
    return { type: "usage", usage, ...(sessionID ? { sessionID } : {}) };
  }

  if (type === "error") {
    const error = asRecord(raw.error);
    const data = asRecord(raw.data);
    const message =
      readString(error?.message) ||
      readString(data?.message) ||
      readString(raw.message) ||
      "OpenCode reported an error";
    return { type: "error", message, ...(sessionID ? { sessionID } : {}) };
  }

  return null;
}

export function buildOpenCodeRunArgs(params: {
  model: string;
  prompt: string;
  sessionID?: string;
  autoApprove?: boolean;
}): string[] {
  return [
    "run",
    "--format",
    "json",
    "--model",
    params.model,
    ...(params.sessionID ? ["--session", params.sessionID] : []),
    ...(params.autoApprove ? ["--auto"] : []),
    "--",
    params.prompt,
  ];
}

function tailText(value: string, maxLength = 4000): string {
  const trimmed = value.trim();
  return trimmed.length > maxLength
    ? trimmed.slice(trimmed.length - maxLength)
    : trimmed;
}

/**
 * Pick the most useful message for a turn that produced no text.
 *
 * OpenCode reports provider failures as `{"type":"error"}` events on stdout
 * and often exits with code 1 while leaving stderr empty, so the exit code
 * alone hides the real cause (quota, auth, model routing, …).
 */
export function buildOpenCodeTurnFailureMessage(params: {
  streamError?: string;
  stderr?: string;
  exitCode?: number;
}): string | null {
  const streamError = params.streamError?.trim();
  const exitCode = params.exitCode;
  const exitSuffix =
    typeof exitCode === "number" && exitCode !== 0
      ? ` (OpenCode exited with code ${exitCode})`
      : "";
  if (streamError) return `${streamError}${exitSuffix}`;
  if (typeof exitCode !== "number" || exitCode === 0) return null;
  const detail = tailText(params.stderr || "");
  return detail
    ? `${detail}${exitSuffix}`
    : `OpenCode exited with code ${exitCode}`;
}

function resolveTempRoot(): string | null {
  const zotero = (
    globalThis as {
      Zotero?: { getTempDirectory?: () => { path?: string } | null };
    }
  ).Zotero;
  const zoteroTemp = zotero?.getTempDirectory?.()?.path?.trim();
  if (zoteroTemp) return zoteroTemp;
  const pathUtilsTemp = (
    globalThis as { PathUtils?: { tempDir?: string } }
  ).PathUtils?.tempDir?.trim();
  return pathUtilsTemp || null;
}

export async function runOpenCodeTurn(params: {
  cliPath?: string;
  cwd: string;
  model: string;
  prompt: string;
  sessionID?: string;
  autoApprove?: boolean;
  signal?: AbortSignal;
  timeoutMs?: number;
  onEvent?: (event: OpenCodeStreamEvent) => void | Promise<void>;
}): Promise<{
  text: string;
  sessionID?: string;
  usage?: OpenCodeUsage;
  stderr: string;
}> {
  if (params.signal?.aborted) {
    throw new Error("OpenCode turn aborted");
  }

  const cliPath = await resolveOpenCodeBinaryPath(params.cliPath);
  const args = buildOpenCodeRunArgs({
    model: params.model,
    prompt: params.prompt,
    sessionID: params.sessionID,
    autoApprove: params.autoApprove,
  });
  const Subprocess = await loadOpenCodeSubprocessModule();
  let proc: any;
  try {
    proc = await Subprocess.call({
      command: cliPath,
      arguments: args,
      workdir: params.cwd,
      stderr: "pipe",
      environment: buildOpenCodeLaunchEnvironment(),
      environmentAppend: true,
    });
  } catch (error) {
    throw new Error(
      `Failed to spawn OpenCode (command: ${cliPath} ${args.join(" ")}): ${
        error instanceof Error ? error.message : JSON.stringify(error)
      }`,
    );
  }

  await closeProcessStdin(proc);

  const timeoutMs = params.timeoutMs ?? OPENCODE_TURN_TIMEOUT_MS;
  let stderr = "";
  let sessionID = params.sessionID;
  let usage: OpenCodeUsage | undefined;
  let streamError = "";
  let aborted = false;
  let timedOut = false;
  let killed = false;
  const textParts: string[] = [];
  const stderrPromise = readProcessStreamToString(proc.stderr);

  const killProcess = (): void => {
    if (killed) return;
    killed = true;
    try {
      (proc as any).kill?.();
    } catch {
      void 0;
    }
  };
  const handleAbort = (): void => {
    aborted = true;
    killProcess();
  };
  params.signal?.addEventListener("abort", handleAbort, { once: true });
  const timeoutId =
    timeoutMs > 0
      ? setTimeout(() => {
          timedOut = true;
          killProcess();
        }, timeoutMs)
      : undefined;

  const handleLine = async (line: string): Promise<void> => {
    const event = parseOpenCodeEventLine(line);
    if (!event) return;
    if (event.sessionID) sessionID = event.sessionID;
    if (event.type === "text") textParts.push(event.text);
    if (event.type === "error") streamError = event.message;
    if (event.type === "step" && event.usage) usage = event.usage;
    if (event.type === "usage") usage = event.usage;
    await params.onEvent?.(event);
  };

  let lineBuffer = "";
  try {
    while (true) {
      let chunk: string;
      try {
        chunk = await proc.stdout.readString();
      } catch {
        break;
      }
      if (!chunk) break;
      lineBuffer += chunk;
      const lines = lineBuffer.split("\n");
      lineBuffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        await handleLine(line);
      }
    }
    if (lineBuffer.trim()) {
      await handleLine(lineBuffer);
      lineBuffer = "";
    }
  } catch (error) {
    killProcess();
    throw error;
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
    params.signal?.removeEventListener("abort", handleAbort);
    stderr = await stderrPromise;
  }

  if (timedOut) {
    const detail = tailText(stderr);
    throw new Error(
      `OpenCode turn timed out after ${timeoutMs}ms${detail ? `: ${detail}` : ""}`,
    );
  }
  if (aborted) {
    throw new Error("OpenCode turn aborted");
  }

  const exitCode = await waitForProcessExitCode(proc);
  const text = textParts.join("");
  if (!text) {
    const failure = buildOpenCodeTurnFailureMessage({
      streamError,
      stderr,
      exitCode,
    });
    if (failure) throw new Error(failure);
  }

  return {
    text,
    ...(sessionID ? { sessionID } : {}),
    ...(usage ? { usage } : {}),
    stderr,
  };
}

export async function runOpenCodeConnectionTest(params: {
  cliPath?: string;
  model: string;
  signal?: AbortSignal;
}): Promise<{ reply: string; model: string }> {
  const tempRoot = resolveTempRoot();
  if (!tempRoot) {
    throw new Error(
      "Cannot resolve temp directory for OpenCode connection test",
    );
  }
  const tempDir = joinLocalPath(
    tempRoot,
    "llm-for-zotero-opencode-test",
    `${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  await ensureDir(tempDir);
  try {
    const result = await runOpenCodeTurn({
      cliPath: params.cliPath,
      cwd: tempDir,
      model: params.model,
      prompt: "Reply with exactly: OK",
      signal: params.signal,
      timeoutMs: OPENCODE_TEST_TIMEOUT_MS,
    });
    const reply = result.text.trim();
    if (!reply) {
      throw new Error("OpenCode returned no text");
    }
    return { reply, model: params.model };
  } finally {
    await removePathQuietly(tempDir);
  }
}
