import { assert } from "chai";
import { shortenChatModelLabel } from "../src/utils/modelDisplay";

describe("chat model label", function () {
  it("shows the leaf segment for namespaced gateway ids", function () {
    assert.equal(
      shortenChatModelLabel("opencode-go/deepseek-v4.1-flash"),
      "deepseek-v4.1-flash",
    );
    assert.equal(
      shortenChatModelLabel("opencode/opencode-go/deepseek-v4.1-flash"),
      "deepseek-v4.1-flash",
    );
    assert.equal(
      shortenChatModelLabel("openrouter/deepseek/deepseek-v4-pro"),
      "deepseek-v4-pro",
    );
    assert.equal(shortenChatModelLabel("codex-app/gpt-5.6-sol"), "gpt-5.6-sol");
  });

  it("keeps plain model names unchanged", function () {
    assert.equal(shortenChatModelLabel("gpt-5.6-sol"), "gpt-5.6-sol");
    assert.equal(
      shortenChatModelLabel("deepseek-v4.1-flash"),
      "deepseek-v4.1-flash",
    );
    assert.equal(shortenChatModelLabel(""), "");
    assert.equal(shortenChatModelLabel("   "), "");
  });

  it("keeps a duplicate-entry suffix on the leaf segment", function () {
    assert.equal(
      shortenChatModelLabel("opencode-go/deepseek-v4.1-flash #2"),
      "deepseek-v4.1-flash #2",
    );
  });
});
