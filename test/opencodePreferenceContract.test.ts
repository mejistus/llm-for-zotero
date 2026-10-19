import { assert } from "chai";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "mocha";

const testDir = dirname(fileURLToPath(import.meta.url));

function source(path: string): string {
  return readFileSync(resolve(testDir, "..", path), "utf8");
}

function flattened(path: string): string {
  return source(path).replace(/\s+/g, " ");
}

function translationFor(sourceText: string, key: string): string | undefined {
  const flattenedSource = sourceText.replace(/\s+/g, " ");
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = flattenedSource.match(
    new RegExp(`"${escapedKey}"\\s*:\\s*"([^"]+)"`),
  );
  return match?.[1];
}

describe("OpenCode CLI preference contract", function () {
  it("selects and labels the opencode_cli auth mode", function () {
    const script = flattened("src/modules/preferenceScript.ts");
    assert.include(script, '"opencode_cli"');
    assert.include(script, "OpenCode CLI");
  });

  it("wires the OpenCode model loader and connection test", function () {
    const script = flattened("src/modules/preferenceScript.ts");
    assert.include(script, "loadOpenCodeModels");
    assert.include(script, "runOpenCodeConnectionTest");
  });

  it("renders the CLI path, model fetch and auto-approve controls", function () {
    const script = flattened("src/modules/preferenceScript.ts");
    assert.include(script, "OpenCode CLI path");
    assert.include(script, "Fetch OpenCode models");
    assert.include(script, "Auto-approve tools (--auto)");
  });

  it("translates the OpenCode CLI controls to Chinese", function () {
    const i18n = source("src/utils/i18n.ts");
    for (const key of ["OpenCode CLI path", "Fetch OpenCode models"]) {
      const translation = translationFor(i18n, key);
      assert.isString(translation, `missing Chinese translation for ${key}`);
      assert.match(
        translation as string,
        /[\u4e00-\u9fff]/,
        `translation for ${key} is not Chinese`,
      );
    }
  });

  it("renders OpenCode as an Agent-tab runtime entry", function () {
    const markup = flattened("addon/content/preferences.xhtml");
    assert.include(markup, 'data-llm-agent-row="opencode"');
    assert.include(markup, "__addonRef__-opencode-enable");
    assert.include(markup, "__addonRef__-opencode-configure");
    assert.include(markup, "Configure OpenCode provider");
    const script = flattened("src/modules/preferenceScript.ts");
    assert.include(script, "ensureOpenCodeProvider");
    assert.include(script, "setOpenCodeModeEnabled");
  });

  it("documents the Agent mode and native MCP requirements", function () {
    const script = flattened("src/modules/preferenceScript.ts");
    assert.include(
      script,
      "Requires Agent mode. Zotero library tools also require the native MCP tools toggle in the Agent tab.",
    );
    const readme = flattened("README.md");
    assert.include(readme, "- [OpenCode Setup](#opencode-setup)");
    assert.include(readme, "Zotero MCP tools");
  });
});
