import { OPENCODE_MODEL_CACHE_TTL_MS } from "./constants";
import { resolveOpenCodeBinaryPath } from "./binary";
import {
  buildOpenCodeLaunchEnvironment,
  closeProcessStdin,
  loadOpenCodeSubprocessModule,
  readProcessOutput,
  readProcessStreamToString,
} from "./subprocess";

let cachedModels: string[] | null = null;
let cacheExpiresAt = 0;

function tailText(value: string, maxLength = 4000): string {
  const trimmed = value.trim();
  return trimmed.length > maxLength
    ? trimmed.slice(trimmed.length - maxLength)
    : trimmed;
}

export function parseOpenCodeModelList(stdout: string): string[] {
  const seen = new Set<string>();
  const models: string[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const model = line.trim();
    if (!model) continue;
    const key = model.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    models.push(model);
  }
  return models.sort((left, right) => left.localeCompare(right));
}

export async function loadOpenCodeModels(options?: {
  cliPath?: string;
  force?: boolean;
}): Promise<string[]> {
  if (!options?.force && cachedModels && Date.now() < cacheExpiresAt) {
    return [...cachedModels];
  }

  const cliPath = await resolveOpenCodeBinaryPath(options?.cliPath);
  const Subprocess = await loadOpenCodeSubprocessModule();
  let proc: any;
  try {
    proc = await Subprocess.call({
      command: cliPath,
      arguments: ["models"],
      stderr: "pipe",
      environment: buildOpenCodeLaunchEnvironment(),
      environmentAppend: true,
    });
  } catch (error) {
    throw new Error(
      `Failed to run OpenCode models (command: ${cliPath} models): ${
        error instanceof Error ? error.message : JSON.stringify(error)
      }`,
    );
  }

  await closeProcessStdin(proc);

  const stderrPromise = readProcessStreamToString(proc.stderr);
  const { stdout, exitCode } = await readProcessOutput(proc);
  const stderr = await stderrPromise;
  if (typeof exitCode === "number" && exitCode !== 0) {
    const detail = tailText(stderr);
    throw new Error(
      `OpenCode models exited with code ${exitCode}${detail ? `: ${detail}` : ""}`,
    );
  }

  const models = parseOpenCodeModelList(stdout);
  cachedModels = models;
  cacheExpiresAt = Date.now() + OPENCODE_MODEL_CACHE_TTL_MS;
  return [...models];
}

export function resetOpenCodeModelCacheForTests(): void {
  cachedModels = null;
  cacheExpiresAt = 0;
}
