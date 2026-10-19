import { assert } from "chai";
import type { AgentRuntimeRequest } from "../src/agent/types";
import { buildOpenCodeTurnPrompt } from "../src/opencode/prompt";

function buildRequest(
  overrides: Record<string, unknown> = {},
): AgentRuntimeRequest {
  return {
    conversationKey: 1,
    mode: "agent",
    userText: "Summarize the paper",
    turnPaperScope: {
      libraryID: 1,
      conversationKind: "global",
      papers: [],
      collections: [],
      tags: [],
      selectedPassagePaperRefs: [],
    },
    ...overrides,
  } as unknown as AgentRuntimeRequest;
}

describe("opencode prompt", function () {
  it("includes the system preamble, turn context, and user request", function () {
    const prompt = buildOpenCodeTurnPrompt({ request: buildRequest() });
    assert.include(prompt, "running inside Zotero through OpenCode");
    assert.include(prompt, "Library scope:");
    assert.include(prompt, "libraryID=1");
    assert.include(prompt, "User request:\nSummarize the paper");
  });

  it("includes system prompt, custom instructions, and bounded history", function () {
    const history = Array.from({ length: 22 }, (_, index) => ({
      role: index % 2 === 0 ? "user" : "assistant",
      content: `entry-${index}-end`,
    }));
    const prompt = buildOpenCodeTurnPrompt({
      request: buildRequest({
        systemPrompt: "System instructions",
        customInstructions: "Custom instructions",
        history,
      }),
      includeHistory: true,
    });
    assert.include(prompt, "System instructions");
    assert.include(prompt, "Custom instructions");
    assert.include(prompt, "Conversation so far:");
    assert.notInclude(prompt, "entry-0-end");
    assert.notInclude(prompt, "entry-1-end");
    assert.include(prompt, "entry-2-end");
    assert.include(prompt, "entry-21-end");
  });

  it("omits history unless requested", function () {
    const prompt = buildOpenCodeTurnPrompt({
      request: buildRequest({
        history: [{ role: "user", content: "old message" }],
      }),
    });
    assert.notInclude(prompt, "Conversation so far:");
    assert.notInclude(prompt, "old message");
  });

  it("includes bounded runtime correction messages after the user request", function () {
    const continuationMessages = Array.from({ length: 22 }, (_, index) => ({
      role: "user" as const,
      content:
        index === 21
          ? [{ type: "text" as const, text: "final correction" }]
          : `correction-${index}-end`,
    }));
    const prompt = buildOpenCodeTurnPrompt({
      request: buildRequest(),
      continuationMessages,
    });
    assert.include(prompt, "Runtime correction:");
    assert.isAbove(
      prompt.indexOf("Runtime correction:"),
      prompt.indexOf("User request:"),
    );
    assert.notInclude(prompt, "correction-0-end");
    assert.notInclude(prompt, "correction-1-end");
    assert.include(prompt, "correction-2-end");
    assert.include(prompt, "final correction");
  });

  it("omits the runtime correction section when there are no messages", function () {
    const prompt = buildOpenCodeTurnPrompt({
      request: buildRequest(),
      continuationMessages: [],
    });
    assert.notInclude(prompt, "Runtime correction:");
  });
});
