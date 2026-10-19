import { assert } from "chai";
import {
  detectProviderPreset,
  getProviderUrlTemplates,
  pinProviderPresetIdOnUrlEdit,
  resolveProviderPresetId,
  type ProviderPresetId,
} from "../src/utils/providerPresets";
import { resolveProviderTransportEndpoint } from "../src/utils/providerTransport";

const OPENCODE_GO_MESSAGES_URL = "https://opencode.ai/zen/go/v1/messages";

describe("providerUrlTemplates", function () {
  it("offers the OpenCode Go Messages endpoint for the opencode preset", function () {
    const matched = getProviderUrlTemplates("opencode").filter(
      (template) => template.url === OPENCODE_GO_MESSAGES_URL,
    );
    assert.lengthOf(matched, 1);
    assert.equal(matched[0].protocol, "anthropic_messages");
  });

  it("offers the OpenCode Go Messages endpoint for customized providers", function () {
    const matched = getProviderUrlTemplates("customized").filter(
      (template) => template.url === OPENCODE_GO_MESSAGES_URL,
    );
    assert.lengthOf(matched, 1);
    assert.equal(matched[0].protocol, "anthropic_messages");
  });

  it("returns unique absolute template URLs without trailing slashes", function () {
    const presetIds: ProviderPresetId[] = ["opencode", "customized"];
    for (const presetId of presetIds) {
      const templates = getProviderUrlTemplates(presetId);
      const urls = templates.map((template) => template.url);
      assert.equal(new Set(urls).size, urls.length, presetId);
      for (const template of templates) {
        assert.match(template.url, /^https?:\/\//, template.url);
        assert.isFalse(template.url.endsWith("/"), template.url);
      }
    }
  });

  it("assigns every OpenCode template to the opencode preset", function () {
    for (const template of getProviderUrlTemplates("opencode")) {
      assert.equal(
        detectProviderPreset(template.url),
        template.presetId,
        template.url,
      );
    }
  });

  it("omits dedicated-auth Copilot from customized URL templates", function () {
    for (const template of getProviderUrlTemplates("customized")) {
      assert.notEqual(template.presetId, "copilot", template.url);
    }
  });

  it("omits local presets whose protocols customized mode cannot use", function () {
    for (const template of getProviderUrlTemplates("customized")) {
      assert.notEqual(template.presetId, "ollama", template.url);
      assert.notEqual(template.presetId, "local_openai", template.url);
    }
  });

  it("pins a customized provider when an OpenCode URL is edited", function () {
    const fresh = {
      authMode: "api_key" as const,
      apiBase: "",
      presetIdOverride: undefined,
    };
    const pinned = pinProviderPresetIdOnUrlEdit(fresh);
    assert.equal(pinned, "customized");
    assert.equal(
      resolveProviderPresetId({
        ...fresh,
        apiBase: OPENCODE_GO_MESSAGES_URL,
        presetIdOverride: pinned,
      }),
      "customized",
    );
  });

  it("pins an already detected preset when its URL is edited", function () {
    assert.equal(
      pinProviderPresetIdOnUrlEdit({
        authMode: "api_key",
        apiBase: OPENCODE_GO_MESSAGES_URL,
        presetIdOverride: undefined,
      }),
      "opencode",
    );
  });

  it("resolves OpenCode transport endpoints from protocol templates", function () {
    assert.equal(
      resolveProviderTransportEndpoint({
        protocol: "anthropic_messages",
        apiBase: OPENCODE_GO_MESSAGES_URL,
      }),
      OPENCODE_GO_MESSAGES_URL,
    );
    assert.equal(
      resolveProviderTransportEndpoint({
        protocol: "openai_chat_compat",
        apiBase: "https://opencode.ai/zen/go/v1",
      }),
      "https://opencode.ai/zen/go/v1/chat/completions",
    );
    assert.equal(
      resolveProviderTransportEndpoint({
        protocol: "responses_api",
        apiBase: "https://opencode.ai/zen/go/v1/responses",
      }),
      "https://opencode.ai/zen/go/v1/responses",
    );
  });
});
