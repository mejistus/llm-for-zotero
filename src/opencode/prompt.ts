import type { AgentModelMessage, AgentRuntimeRequest } from "../agent/types";
import {
  buildTurnContextEnvelope,
  renderTurnContextEnvelopeForModel,
} from "../agent/context/turnContextEnvelope";
import {
  CORE_RESEARCH_CONTRACT,
  PAPER_CITATION_CONTRACT,
  RESEARCH_RESPONSE_FORMAT_GUIDANCE,
} from "../shared/instructionContracts";

const SYSTEM_PREAMBLE = [
  "You are an AI research assistant running inside Zotero through OpenCode. Use the Zotero MCP tools for library and paper access. Prefer library_search/library_read/paper_read/library_retrieve over filesystem exploration. Do not ask the user for file paths that the Zotero tools can resolve.",
  CORE_RESEARCH_CONTRACT,
  PAPER_CITATION_CONTRACT,
  RESEARCH_RESPONSE_FORMAT_GUIDANCE,
].join("\n\n");

function extractText(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      const text = (part as { text?: unknown }).text;
      return typeof text === "string" ? text : "";
    })
    .filter(Boolean)
    .join("\n")
    .trim();
}

function formatRole(role: string): string {
  if (role === "assistant") return "Assistant";
  if (role === "system") return "System";
  return "User";
}

function buildHistorySection(history: AgentRuntimeRequest["history"]): string {
  if (!Array.isArray(history) || !history.length) return "";
  const lines: string[] = [];
  for (const message of history.slice(-20)) {
    const text = extractText(message.content);
    if (!text) continue;
    lines.push(`${formatRole(message.role)}: ${text}`);
  }
  return lines.length ? `Conversation so far:\n${lines.join("\n\n")}` : "";
}

function buildRuntimeCorrectionSection(
  messages: AgentModelMessage[] | undefined,
): string {
  if (!Array.isArray(messages) || !messages.length) return "";
  const lines: string[] = [];
  for (const message of messages.slice(-20)) {
    const text = extractText(message.content);
    if (!text) continue;
    lines.push(text);
  }
  return lines.length ? `Runtime correction:\n${lines.join("\n\n")}` : "";
}

export function buildOpenCodeTurnPrompt(params: {
  request: AgentRuntimeRequest;
  includeHistory?: boolean;
  continuationMessages?: AgentModelMessage[];
}): string {
  const { request } = params;
  const sections: string[] = [SYSTEM_PREAMBLE];

  if (request.turnPaperScope) {
    sections.push(
      renderTurnContextEnvelopeForModel(buildTurnContextEnvelope(request)),
    );
  }
  if (request.systemPrompt?.trim()) {
    sections.push(request.systemPrompt.trim());
  }
  if (request.customInstructions?.trim()) {
    sections.push(request.customInstructions.trim());
  }
  if (params.includeHistory) {
    const history = buildHistorySection(request.history);
    if (history) sections.push(history);
  }
  sections.push(`User request:\n${request.userText}`);

  const runtimeCorrection = buildRuntimeCorrectionSection(
    params.continuationMessages,
  );
  if (runtimeCorrection) sections.push(runtimeCorrection);

  return sections
    .filter((section) => Boolean(section && section.trim()))
    .join("\n\n")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
