import { getClaudeRuntimeRootDir } from "../claudeCode/projectSkills";
import { ensureDir } from "../utils/geckoFs";
import { joinLocalPath } from "../utils/localPath";
import { OPENCODE_RUNTIME_DIR_NAME } from "./constants";

function normalizeConversationKey(conversationKey: number): number {
  const key = Math.floor(Number(conversationKey));
  return Number.isFinite(key) && key > 0 ? key : 0;
}

export function getOpenCodeConversationDir(conversationKey: number): string {
  return joinLocalPath(
    getClaudeRuntimeRootDir(),
    OPENCODE_RUNTIME_DIR_NAME,
    `scope-${normalizeConversationKey(conversationKey)}`,
  );
}

export async function ensureOpenCodeConversationDir(
  conversationKey: number,
): Promise<string> {
  const dir = getOpenCodeConversationDir(conversationKey);
  await ensureDir(dir);
  return dir;
}
