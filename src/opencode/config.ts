import { ensureDir, writeFileBytes } from "../utils/geckoFs";
import { joinLocalPath } from "../utils/localPath";

export type OpenCodeMcpServerConfig = {
  serverName: string;
  url: string;
  headers: Record<string, string>;
};

const READ_ONLY_PERMISSIONS: Record<string, string> = {
  read: "allow",
  glob: "allow",
  grep: "allow",
  list: "allow",
  todoread: "allow",
  todowrite: "allow",
  lsp: "allow",
  skill: "allow",
};

const SAFE_ZOTERO_MCP_TOOL_NAMES = [
  "library_search",
  "library_read",
  "library_retrieve",
  "paper_read",
  "literature_search",
  "load_skill",
] as const;

export function buildOpenCodeProjectConfig(params: {
  mcp?: OpenCodeMcpServerConfig;
  allowWriteTools?: boolean;
}): Record<string, unknown> {
  const permission: Record<string, string> =
    params.allowWriteTools === true
      ? { "*": "allow" }
      : { "*": "deny", ...READ_ONLY_PERMISSIONS };
  if (params.allowWriteTools !== true && params.mcp) {
    for (const tool of SAFE_ZOTERO_MCP_TOOL_NAMES) {
      permission[`${params.mcp.serverName}_${tool}`] = "allow";
    }
  }

  return {
    $schema: "https://opencode.ai/config.json",
    ...(params.mcp
      ? {
          mcp: {
            [params.mcp.serverName]: {
              type: "remote",
              url: params.mcp.url,
              headers: params.mcp.headers,
              enabled: true,
              oauth: false,
            },
          },
        }
      : {}),
    permission,
  };
}

export async function writeOpenCodeProjectConfig(
  dir: string,
  config: Record<string, unknown>,
): Promise<string> {
  await ensureDir(dir);
  const path = joinLocalPath(dir, "opencode.json");
  const content = `${JSON.stringify(config, null, 2)}\n`;
  const written = await writeFileBytes(path, new TextEncoder().encode(content));
  if (!written) {
    throw new Error(`Cannot write OpenCode project config at ${path}`);
  }
  return path;
}
