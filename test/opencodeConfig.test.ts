import { assert } from "chai";
import { buildOpenCodeProjectConfig } from "../src/opencode/config";

const SERVER_NAME = "llm_for_zotero_profile_abc123";

function buildMcpConfig() {
  return {
    serverName: SERVER_NAME,
    url: "http://127.0.0.1:23119/llm-for-zotero/mcp",
    headers: { Authorization: "Bearer token" },
  };
}

describe("opencode project config", function () {
  it("writes a remote MCP server config", function () {
    const config = buildOpenCodeProjectConfig({ mcp: buildMcpConfig() });
    assert.equal(config.$schema, "https://opencode.ai/config.json");
    assert.deepEqual(config.mcp, {
      [SERVER_NAME]: {
        type: "remote",
        url: "http://127.0.0.1:23119/llm-for-zotero/mcp",
        headers: { Authorization: "Bearer token" },
        enabled: true,
        oauth: false,
      },
    });
  });

  it("denies write tools and allows only safe MCP tools by default", function () {
    const config = buildOpenCodeProjectConfig({ mcp: buildMcpConfig() });
    const permission = config.permission as Record<string, string>;
    assert.equal(permission["*"], "deny");
    assert.equal(permission.read, "allow");
    assert.equal(permission.glob, "allow");
    assert.equal(permission.grep, "allow");
    assert.isUndefined(permission.edit);
    assert.isUndefined(permission.bash);
    assert.isUndefined(permission.webfetch);
    assert.isUndefined(permission[`${SERVER_NAME}_*`]);
    assert.equal(permission[`${SERVER_NAME}_library_search`], "allow");
    assert.equal(permission[`${SERVER_NAME}_library_read`], "allow");
    assert.equal(permission[`${SERVER_NAME}_library_retrieve`], "allow");
    assert.equal(permission[`${SERVER_NAME}_paper_read`], "allow");
    assert.equal(permission[`${SERVER_NAME}_literature_search`], "allow");
    assert.equal(permission[`${SERVER_NAME}_load_skill`], "allow");
    assert.isUndefined(permission[`${SERVER_NAME}_library_delete`]);
    const keys = Object.keys(permission);
    assert.isBelow(
      keys.indexOf("*"),
      keys.indexOf(`${SERVER_NAME}_library_search`),
    );
  });

  it("allows write tools when auto approve is enabled", function () {
    const config = buildOpenCodeProjectConfig({
      mcp: buildMcpConfig(),
      allowWriteTools: true,
    });
    assert.deepEqual(config.permission, { "*": "allow" });
  });
});
