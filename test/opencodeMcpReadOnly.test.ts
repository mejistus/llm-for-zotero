import { assert } from "chai";
import {
  isMcpToolReadOnlyVisible,
  registerScopedZoteroMcpScope,
  ZOTERO_MCP_WRITE_TOOL_NAMES,
} from "../src/agent/mcp/server";

const READ_ONLY_HIDDEN_WRITE_TOOLS = [
  "note_write",
  "library_update",
  "library_delete",
  "file_io",
  "run_command",
  "zotero_script",
] as const;

const READ_ONLY_VISIBLE_TOOLS = [
  "library_search",
  "library_read",
  "paper_read",
  "literature_search",
  "submit_document",
] as const;

describe("OpenCode MCP read-only scope enforcement", function () {
  it("hides every curated write tool from a read-only scope", function () {
    for (const toolName of ZOTERO_MCP_WRITE_TOOL_NAMES) {
      assert.isFalse(
        isMcpToolReadOnlyVisible(toolName, { readOnly: true }),
        `${toolName} must be hidden from a read-only MCP scope`,
      );
    }
  });

  it("hides the OpenCode write tools by name", function () {
    for (const toolName of READ_ONLY_HIDDEN_WRITE_TOOLS) {
      assert.isFalse(
        isMcpToolReadOnlyVisible(toolName, { readOnly: true }),
        `${toolName} must not be callable by name through a read-only scope`,
      );
    }
  });

  it("keeps read and document tools visible in a read-only scope", function () {
    for (const toolName of READ_ONLY_VISIBLE_TOOLS) {
      assert.isTrue(
        isMcpToolReadOnlyVisible(toolName, { readOnly: true }),
        `${toolName} must remain visible through a read-only scope`,
      );
    }
  });

  it("keeps write tools visible when the scope is not read-only", function () {
    for (const toolName of READ_ONLY_HIDDEN_WRITE_TOOLS) {
      assert.isTrue(isMcpToolReadOnlyVisible(toolName, { readOnly: false }));
      assert.isTrue(isMcpToolReadOnlyVisible(toolName, undefined));
      assert.isTrue(isMcpToolReadOnlyVisible(toolName, null));
    }
  });

  it("preserves readOnly when normalizing a registered scope", function () {
    const readOnlyScope = registerScopedZoteroMcpScope(
      { readOnly: true },
      { token: "opencode-read-only-normalization-fixture" },
    );
    try {
      assert.isTrue(readOnlyScope.getState()?.readOnly);
    } finally {
      readOnlyScope.clear();
    }
  });
});
