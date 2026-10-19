import { assert } from "chai";
import {
  buildProviderCatalogIdentity,
  getModelProviderGroups,
  getRuntimeModelEntries,
  migrateApiBaseForAuthModeChange,
  normalizeModelProviderGroups,
  setModelProviderGroups,
  type StandardModelProviderGroup,
} from "../src/utils/modelProviders";
import { transitionProviderAuthMode } from "../src/modules/preferences/providerAuthModeTransition";
import { CATALOG_EXCLUDED_AUTH_MODES } from "../src/modelCapabilities";
import { DEFAULT_OPENCODE_MODEL } from "../src/opencode/constants";

function openCodeCliGroup(): StandardModelProviderGroup {
  return {
    id: "opencode-cli-provider",
    apiBase: "/opt/homebrew/bin/opencode",
    apiKey: "",
    authMode: "opencode_cli",
    providerProtocol: "openai_chat_compat",
    models: [
      {
        id: "opencode-cli-model",
        model: "opencode-go/deepseek-v4.1-flash",
        temperature: 0.3,
        outputTokenLimit: { mode: "auto" },
      },
    ],
    openCodeAutoApprove: true,
  };
}

function apiKeyGroup(): StandardModelProviderGroup {
  return {
    id: "api-key-provider",
    apiBase: "https://example.com/v1",
    apiKey: "test-key",
    authMode: "api_key",
    providerProtocol: "openai_chat_compat",
    models: [
      {
        id: "api-key-model",
        model: "meta-llama/llama-3-70b",
        temperature: 0.3,
        outputTokenLimit: { mode: "auto" },
      },
    ],
  };
}

describe("OpenCode CLI provider mode", function () {
  let originalZotero: typeof Zotero;

  beforeEach(function () {
    originalZotero = globalThis.Zotero;
    const prefs = new Map<string, unknown>();
    globalThis.Zotero = {
      Prefs: {
        get: (key: string) => prefs.get(key),
        set: (key: string, value: unknown) => prefs.set(key, value),
      },
    } as unknown as typeof Zotero;
  });

  afterEach(function () {
    globalThis.Zotero = originalZotero;
  });

  it("round-trips the CLI path, auth mode, model and auto-approve flag", function () {
    setModelProviderGroups([openCodeCliGroup()]);
    const [saved] = getModelProviderGroups() as StandardModelProviderGroup[];
    assert.equal(saved.authMode, "opencode_cli");
    assert.equal(saved.apiBase, "/opt/homebrew/bin/opencode");
    assert.equal(saved.models[0].model, "opencode-go/deepseek-v4.1-flash");
    assert.isTrue(saved.openCodeAutoApprove);
  });

  it("exposes one OpenAI-compatible OpenCode runtime entry", function () {
    setModelProviderGroups([openCodeCliGroup()]);
    const entries = getRuntimeModelEntries();
    assert.lengthOf(entries, 1);
    const [runtime] = entries;
    assert.equal(runtime.authMode, "opencode_cli");
    assert.equal(runtime.providerProtocol, "openai_chat_compat");
    assert.equal(runtime.providerLabel, "OpenCode");
    assert.equal(
      runtime.displayModelLabel,
      "opencode/opencode-go/deepseek-v4.1-flash",
    );
    assert.equal(runtime.apiBase, "/opt/homebrew/bin/opencode");
  });

  it("resolves no preset catalog identity for the CLI mode", function () {
    setModelProviderGroups([openCodeCliGroup()]);
    const [saved] = getModelProviderGroups() as StandardModelProviderGroup[];
    assert.isUndefined(buildProviderCatalogIdentity(saved).provider);
  });

  it("transitions into the CLI mode and does not carry the path back out", function () {
    const transitioned = transitionProviderAuthMode(
      apiKeyGroup(),
      "opencode_cli",
    ) as StandardModelProviderGroup;
    assert.equal(transitioned.authMode, "opencode_cli");
    assert.equal(transitioned.providerProtocol, "openai_chat_compat");
    assert.equal(transitioned.apiBase, "");
    assert.equal(transitioned.models[0].model, DEFAULT_OPENCODE_MODEL);

    const empty = apiKeyGroup();
    empty.models[0].model = "";
    const defaulted = transitionProviderAuthMode(
      empty,
      "opencode_cli",
    ) as StandardModelProviderGroup;
    assert.equal(defaulted.models[0].model, DEFAULT_OPENCODE_MODEL);

    const back = transitionProviderAuthMode(
      { ...transitioned, apiBase: "/opt/homebrew/bin/opencode" },
      "api_key",
    ) as StandardModelProviderGroup;
    assert.equal(back.authMode, "api_key");
    assert.equal(back.apiBase, "");
  });

  it("clears the repurposed apiBase when crossing the CLI boundary", function () {
    assert.equal(
      migrateApiBaseForAuthModeChange(
        "api_key",
        "opencode_cli",
        "https://example.com/v1",
      ),
      "",
    );
    assert.equal(
      migrateApiBaseForAuthModeChange(
        "opencode_cli",
        "api_key",
        "/opt/homebrew/bin/opencode",
      ),
      "",
    );
  });

  it("excludes the CLI mode from generic catalog discovery", function () {
    assert.isTrue(CATALOG_EXCLUDED_AUTH_MODES.has("opencode_cli"));
  });

  it("still normalizes an untyped CLI group", function () {
    const [group] = normalizeModelProviderGroups([
      {
        id: "raw-opencode",
        apiBase: "/opt/homebrew/bin/opencode",
        apiKey: "",
        authMode: "opencode_cli",
        providerProtocol: "openai_chat_compat",
        models: [
          {
            id: "raw-opencode-model",
            model: "opencode-go/deepseek-v4.1-flash",
            temperature: 0.3,
            outputTokenLimit: { mode: "auto" },
          },
        ],
        openCodeAutoApprove: true,
      },
    ]) as StandardModelProviderGroup[];
    assert.equal(group.authMode, "opencode_cli");
    assert.equal(group.apiBase, "/opt/homebrew/bin/opencode");
    assert.isTrue(group.openCodeAutoApprove);
  });
});
