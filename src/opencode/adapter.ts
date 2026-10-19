import type {
  AgentModelAdapter,
  AgentStepParams,
} from "../agent/model/adapter";
import { buildAgentModelCapabilities } from "../agent/model/contentCapabilities";
import type {
  AgentModelCapabilities,
  AgentModelStep,
  AgentRuntimeRequest,
} from "../agent/types";
import {
  buildZoteroMcpConfigValue,
  getZoteroMcpServerName,
  registerScopedZoteroMcpScope,
  resolveConversationScopeToken,
  type ZoteroMcpActiveScope,
} from "../agent/mcp/server";
import { getClaudeProfileSignature } from "../claudeCode/projectSkills";
import { getModelProviderGroups } from "../utils/modelProviders";
import { isNativeZoteroMcpToolsEnabled } from "../codexAppServer/prefs";
import {
  buildOpenCodeProjectConfig,
  writeOpenCodeProjectConfig,
  type OpenCodeMcpServerConfig,
} from "./config";
import { DEFAULT_OPENCODE_MODEL } from "./constants";
import { runOpenCodeTurn, type OpenCodeUsage } from "./process";
import { buildOpenCodeTurnPrompt } from "./prompt";
import { ensureOpenCodeConversationDir } from "./runtimeDir";
import {
  clearOpenCodeSessionId,
  getOpenCodeSessionId,
  setOpenCodeSessionId,
} from "./session";

const STALE_SESSION_ERROR_PATTERN =
  /session.*(not found|unknown|missing|expired)|unknown session|no such session/i;

function normalizePositiveInt(value: unknown): number | undefined {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return Math.floor(parsed);
}

function buildOpenCodeMcpScope(
  request: AgentRuntimeRequest,
  profileSignature: string,
  conversationKey: number,
  readOnly: boolean,
): ZoteroMcpActiveScope {
  const scope = request.turnPaperScope;
  const selectedPaper =
    scope?.papers.find((entry) => entry.roles.includes("active"))?.paper ||
    scope?.papers[0]?.paper;
  const kind =
    scope?.conversationKind === "paper" || request.conversationKind === "paper"
      ? "paper"
      : "global";
  const activeItemId =
    normalizePositiveInt(request.activeItemId) ||
    normalizePositiveInt(request.item?.id) ||
    selectedPaper?.itemId;
  const paperItemID =
    kind === "paper" ? selectedPaper?.itemId || activeItemId : undefined;
  return {
    runtimeAuthority: "opencode",
    readOnly,
    profileSignature,
    conversationKey,
    conversationGeneration: request.conversationGeneration,
    libraryID:
      normalizePositiveInt(scope?.libraryID) ||
      normalizePositiveInt(request.libraryID) ||
      normalizePositiveInt(request.item?.libraryID),
    kind,
    paperItemID,
    activeItemId: paperItemID || activeItemId,
    activeContextItemId: selectedPaper?.contextItemId,
    userText: request.userText,
    turnPaperScope: request.turnPaperScope,
    turnPaperScopeWarnings: request.turnPaperScopeWarnings,
    executionContext: request.executionContext,
    documentReadObservations: request.documentReadObservations,
    documentArtifactObservations: request.documentArtifactObservations,
    exhaustiveReadBackend: "unavailable",
  };
}

type OpenCodeAutoApproveGroup = {
  authMode: string;
  apiBase?: string;
  models: ReadonlyArray<{ model: string }>;
  openCodeAutoApprove?: boolean;
};

export function resolveOpenCodeAutoApprove(
  request: AgentRuntimeRequest,
  groups?: readonly OpenCodeAutoApproveGroup[],
): boolean {
  if (
    (request.metadata as Record<string, unknown> | undefined)
      ?.openCodeAutoApprove
  ) {
    return true;
  }

  let providerGroups: readonly OpenCodeAutoApproveGroup[];
  try {
    providerGroups = groups ?? getModelProviderGroups();
  } catch {
    return false;
  }

  const cliPath = (request.apiBase || "").trim();
  const requestedModel = request.model?.trim();
  const matches = providerGroups.filter(
    (group) =>
      group.authMode === "opencode_cli" &&
      (group.apiBase || "").trim() === cliPath &&
      group.models.some((entry) => entry.model.trim() === requestedModel),
  );
  if (matches.length === 0) return false;
  return matches.every((group) => group.openCodeAutoApprove === true);
}

export class OpenCodeCliAgentAdapter implements AgentModelAdapter {
  getCapabilities(_request: AgentRuntimeRequest): AgentModelCapabilities {
    return buildAgentModelCapabilities({
      streaming: true,
      toolCalls: true,
      contentInputs: null,
      fileInputs: false,
      reasoning: true,
    });
  }

  supportsTools(_request: AgentRuntimeRequest): boolean {
    return true;
  }

  async runStep(params: AgentStepParams): Promise<AgentModelStep> {
    const { request } = params;
    if (request.authMode !== "opencode_cli") {
      throw new Error('OpenCode CLI adapter requires authMode "opencode_cli".');
    }

    const conversationKey = normalizePositiveInt(request.conversationKey) || 0;
    const model = request.model?.trim() || DEFAULT_OPENCODE_MODEL;
    let sessionID = getOpenCodeSessionId(conversationKey);
    const conversationDir =
      await ensureOpenCodeConversationDir(conversationKey);
    const autoApprove = resolveOpenCodeAutoApprove(request);
    const profileSignature = getClaudeProfileSignature();

    const buildPrompt = (includeHistory: boolean): string =>
      buildOpenCodeTurnPrompt({
        request,
        includeHistory,
        continuationMessages: params.continuationMessages,
      });

    let clearScope: () => void = () => undefined;
    try {
      let mcp: OpenCodeMcpServerConfig | undefined;
      if (isNativeZoteroMcpToolsEnabled()) {
        const scope = buildOpenCodeMcpScope(
          request,
          profileSignature,
          conversationKey,
          !autoApprove,
        );
        const scopeToken = resolveConversationScopeToken({
          profileSignature,
          conversationKey,
        });
        const registration = registerScopedZoteroMcpScope(scope, {
          token: scopeToken,
        });
        clearScope = registration.clear;
        const configValue = buildZoteroMcpConfigValue({ scopeToken });
        mcp = {
          serverName: getZoteroMcpServerName(profileSignature),
          url: typeof configValue.url === "string" ? configValue.url : "",
          headers:
            (configValue.http_headers as Record<string, string> | undefined) ||
            {},
        };
      }

      await writeOpenCodeProjectConfig(
        conversationDir,
        buildOpenCodeProjectConfig({ mcp, allowWriteTools: autoApprove }),
      );

      const emitUsage = async (usage: OpenCodeUsage): Promise<void> => {
        await params.onUsage?.({
          promptTokens: usage.inputTokens,
          completionTokens: usage.outputTokens,
          totalTokens: usage.totalTokens,
          cacheReadTokens: usage.cacheReadTokens,
          cacheWriteTokens: usage.cacheWriteTokens,
        });
      };

      const runTurn = async (prompt: string, turnSessionID?: string) => {
        let streamedText = "";
        let streamError = "";
        const result = await runOpenCodeTurn({
          cliPath: request.apiBase?.trim() || undefined,
          cwd: conversationDir,
          model,
          prompt,
          sessionID: turnSessionID,
          autoApprove,
          signal: params.signal,
          onEvent: async (event) => {
            if (event.type === "text") {
              streamedText += event.text;
              await params.onTextDelta?.(event.text);
              return;
            }
            if (event.type === "reasoning") {
              await params.onReasoning?.({
                summary: event.summary,
                details: event.details,
              });
              return;
            }
            if (event.type === "step" && event.usage) {
              await emitUsage(event.usage);
              return;
            }
            if (event.type === "usage") {
              await emitUsage(event.usage);
              return;
            }
            if (event.type === "error") {
              streamError = event.message;
            }
          },
        });
        return { result, streamedText, streamError };
      };

      let turn: Awaited<ReturnType<typeof runTurn>>;
      try {
        turn = await runTurn(buildPrompt(!sessionID), sessionID);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!sessionID || !STALE_SESSION_ERROR_PATTERN.test(message)) {
          throw error;
        }
        clearOpenCodeSessionId(conversationKey);
        sessionID = undefined;
        turn = await runTurn(buildPrompt(true), undefined);
      }

      const { result, streamedText, streamError } = turn;
      if (result.sessionID) {
        setOpenCodeSessionId(conversationKey, result.sessionID);
      }
      const finalText = (result.text || streamedText).trim();
      if (!finalText) {
        throw new Error(streamError || "OpenCode returned no text");
      }
      return { kind: "final", text: finalText };
    } finally {
      clearScope();
    }
  }
}
