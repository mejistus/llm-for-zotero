import { assert } from "chai";
import {
  buildOpenCodeRunArgs,
  parseOpenCodeEventLine,
} from "../src/opencode/process";

describe("opencode process", function () {
  it("builds run arguments in CLI order", function () {
    const args = buildOpenCodeRunArgs({
      model: "opencode-go/deepseek-v4.1-flash",
      prompt: "hello",
      sessionID: "session-1",
      autoApprove: true,
    });
    assert.deepEqual(args, [
      "run",
      "--format",
      "json",
      "--model",
      "opencode-go/deepseek-v4.1-flash",
      "--session",
      "session-1",
      "--auto",
      "--",
      "hello",
    ]);
  });

  it("omits optional arguments when they are not set", function () {
    const args = buildOpenCodeRunArgs({
      model: "provider/model",
      prompt: "hello",
    });
    assert.deepEqual(args, [
      "run",
      "--format",
      "json",
      "--model",
      "provider/model",
      "--",
      "hello",
    ]);
  });

  it("parses text events", function () {
    const event = parseOpenCodeEventLine(
      JSON.stringify({
        type: "text",
        part: { type: "text", text: "Hello" },
        sessionID: "session-1",
      }),
    );
    assert.deepEqual(event, {
      type: "text",
      text: "Hello",
      sessionID: "session-1",
    });
  });

  it("parses reasoning events", function () {
    const event = parseOpenCodeEventLine(
      JSON.stringify({
        type: "reasoning",
        part: { type: "reasoning", text: "Thinking" },
      }),
    );
    assert.deepEqual(event, {
      type: "reasoning",
      summary: "Thinking",
      details: "Thinking",
    });
  });

  it("parses tool use events", function () {
    const event = parseOpenCodeEventLine(
      JSON.stringify({
        type: "tool_use",
        part: {
          type: "tool",
          tool: "write",
          callID: "call-1",
          state: {
            status: "completed",
            input: { path: "/tmp/a.txt" },
            output: "written",
          },
        },
      }),
    );
    assert.deepEqual(event, {
      type: "tool",
      tool: "write",
      callID: "call-1",
      status: "completed",
      input: { path: "/tmp/a.txt" },
      output: "written",
    });
  });

  it("parses step_finish events with usage", function () {
    const event = parseOpenCodeEventLine(
      JSON.stringify({
        type: "step_finish",
        part: {
          type: "step-finish",
          reason: "stop",
          tokens: {
            input: 10,
            output: 20,
            reasoning: 3,
            total: 50,
            cache: { read: 4, write: 5 },
          },
          cost: 0.01,
        },
        sessionID: "session-1",
      }),
    );
    assert.deepEqual(event, {
      type: "step",
      phase: "finish",
      reason: "stop",
      usage: {
        inputTokens: 10,
        outputTokens: 20,
        totalTokens: 50,
        cacheReadTokens: 4,
        cacheWriteTokens: 5,
        reasoningTokens: 3,
        cost: 0.01,
      },
      sessionID: "session-1",
    });
  });

  it("falls back to summed usage when total is not positive", function () {
    const event = parseOpenCodeEventLine(
      JSON.stringify({
        type: "step_finish",
        part: {
          tokens: {
            input: 10,
            output: 20,
            reasoning: 3,
            total: 0,
          },
        },
      }),
    );
    assert.equal(
      event?.type === "step" ? event.usage?.totalTokens : undefined,
      33,
    );
  });

  it("parses error events", function () {
    const event = parseOpenCodeEventLine(
      JSON.stringify({
        type: "error",
        error: { message: "provider failed" },
      }),
    );
    assert.deepEqual(event, {
      type: "error",
      message: "provider failed",
    });
  });

  it("returns null for invalid JSON and unknown event types", function () {
    assert.isNull(parseOpenCodeEventLine("not json"));
    assert.isNull(
      parseOpenCodeEventLine(JSON.stringify({ type: "future_event" })),
    );
  });
});
