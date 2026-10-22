import { assert } from "chai";
import {
  buildOpenCodeRunArgs,
  buildOpenCodeTurnFailureMessage,
  parseOpenCodeEventLine,
} from "../src/opencode/process";
import { closeProcessStdin } from "../src/opencode/subprocess";

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

describe("opencode subprocess stdin", function () {
  it("closes the stdin pipe so opencode run does not wait for EOF", async function () {
    let closes = 0;
    await closeProcessStdin({
      stdin: {
        closed: false,
        close: async () => {
          closes += 1;
        },
      },
    });
    assert.equal(closes, 1);
  });

  it("leaves an already closed pipe alone", async function () {
    let closes = 0;
    await closeProcessStdin({
      stdin: {
        closed: true,
        close: async () => {
          closes += 1;
        },
      },
    });
    assert.equal(closes, 0);
  });

  it("tolerates a missing or failing stdin pipe", async function () {
    await closeProcessStdin(undefined);
    await closeProcessStdin({});
    await closeProcessStdin({
      stdin: {
        closed: false,
        close: async () => {
          throw new Error("gone");
        },
      },
    });
  });
});

describe("opencode turn failure message", function () {
  it("prefers the provider error event over the exit code", function () {
    assert.equal(
      buildOpenCodeTurnFailureMessage({
        streamError:
          "Free usage limit reached. Subscribe to OpenCode Go to keep going.",
        stderr: "",
        exitCode: 1,
      }),
      "Free usage limit reached. Subscribe to OpenCode Go to keep going. (OpenCode exited with code 1)",
    );
  });

  it("keeps the provider error even when the CLI exits cleanly", function () {
    assert.equal(
      buildOpenCodeTurnFailureMessage({
        streamError: "Model unavailable: bogus/model",
        exitCode: 0,
      }),
      "Model unavailable: bogus/model",
    );
  });

  it("falls back to stderr when there is no error event", function () {
    assert.equal(
      buildOpenCodeTurnFailureMessage({
        stderr: "boom",
        exitCode: 1,
      }),
      "boom (OpenCode exited with code 1)",
    );
  });

  it("reports the exit code when stderr is empty", function () {
    assert.equal(
      buildOpenCodeTurnFailureMessage({ exitCode: 1 }),
      "OpenCode exited with code 1",
    );
  });

  it("returns null when the turn exited cleanly", function () {
    assert.isNull(buildOpenCodeTurnFailureMessage({ exitCode: 0 }));
    assert.isNull(buildOpenCodeTurnFailureMessage({}));
  });
});
