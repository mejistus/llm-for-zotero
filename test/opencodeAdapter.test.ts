import { assert } from "chai";
import type { AgentRuntimeRequest } from "../src/agent/types";
import { resolveOpenCodeAutoApprove } from "../src/opencode/adapter";
import { resolveOpenCodeBinaryPath } from "../src/opencode/binary";

const PREFIX = "extensions.zotero.llmforzotero";

type TestGroup = {
  authMode: string;
  apiBase?: string;
  models: Array<{ model: string }>;
  openCodeAutoApprove?: boolean;
};

function buildRequest(
  overrides: Record<string, unknown> = {},
): AgentRuntimeRequest {
  return {
    conversationKey: 1,
    mode: "agent",
    userText: "Summarize the paper",
    authMode: "opencode_cli",
    apiBase: "/opt/homebrew/bin/opencode",
    model: "opencode/model-a",
    ...overrides,
  } as unknown as AgentRuntimeRequest;
}

function buildGroup(overrides: Partial<TestGroup> = {}): TestGroup {
  return {
    authMode: "opencode_cli",
    apiBase: "/opt/homebrew/bin/opencode",
    models: [{ model: "opencode/model-a" }],
    openCodeAutoApprove: true,
    ...overrides,
  };
}

describe("opencode adapter auto-approve", function () {
  const originalZotero = (globalThis as { Zotero?: unknown }).Zotero;

  after(function () {
    (globalThis as { Zotero?: unknown }).Zotero = originalZotero;
  });

  it("matches by CLI path and model", function () {
    assert.isTrue(resolveOpenCodeAutoApprove(buildRequest(), [buildGroup()]));
  });

  it("trims the request and group CLI path and model", function () {
    assert.isTrue(
      resolveOpenCodeAutoApprove(
        buildRequest({
          apiBase: "  /opt/homebrew/bin/opencode  ",
          model: "  opencode/model-a  ",
        }),
        [
          buildGroup({
            apiBase: " /opt/homebrew/bin/opencode ",
            models: [{ model: " opencode/model-a " }],
          }),
        ],
      ),
    );
  });

  it("does not match a group for a different CLI path or model", function () {
    assert.isFalse(
      resolveOpenCodeAutoApprove(
        buildRequest({ apiBase: "/usr/local/bin/opencode" }),
        [buildGroup()],
      ),
    );
    assert.isFalse(
      resolveOpenCodeAutoApprove(buildRequest({ model: "opencode/model-b" }), [
        buildGroup(),
      ]),
    );
  });

  it("ignores groups that are not opencode_cli", function () {
    assert.isFalse(
      resolveOpenCodeAutoApprove(buildRequest(), [
        buildGroup({ authMode: "api_key" }),
      ]),
    );
  });

  it("requires every matching group to opt in", function () {
    assert.isFalse(
      resolveOpenCodeAutoApprove(buildRequest(), [
        buildGroup(),
        buildGroup({ openCodeAutoApprove: false }),
      ]),
    );
    assert.isFalse(
      resolveOpenCodeAutoApprove(buildRequest(), [
        buildGroup(),
        buildGroup({ openCodeAutoApprove: undefined }),
      ]),
    );
    assert.isTrue(
      resolveOpenCodeAutoApprove(buildRequest(), [buildGroup(), buildGroup()]),
    );
  });

  it("does not fall back to the global auto-approve pref", function () {
    const prefStore = new Map<string, unknown>();
    prefStore.set(`${PREFIX}.openCodeAutoApprove`, true);
    prefStore.set(`${PREFIX}.modelProviderGroups`, "[]");
    prefStore.set(`${PREFIX}.modelProviderGroupsMigrationVersion`, 9);
    (globalThis as { Zotero?: unknown }).Zotero = {
      Prefs: {
        get: (key: string) => prefStore.get(key),
        set: (key: string, value: unknown) => {
          prefStore.set(key, value);
        },
      },
    };
    assert.isFalse(resolveOpenCodeAutoApprove(buildRequest()));
  });

  it("honors the per-request metadata override", function () {
    assert.isTrue(
      resolveOpenCodeAutoApprove(
        buildRequest({ metadata: { openCodeAutoApprove: true } }),
        [],
      ),
    );
  });
});

describe("opencode binary resolution", function () {
  const originalZotero = (globalThis as { Zotero?: unknown }).Zotero;
  const originalIOUtils = (globalThis as { IOUtils?: unknown }).IOUtils;

  after(function () {
    (globalThis as { Zotero?: unknown }).Zotero = originalZotero;
    (globalThis as { IOUtils?: unknown }).IOUtils = originalIOUtils;
  });

  function stubPlatform(options: {
    isWin: boolean;
    existingPaths: string[];
  }): void {
    (globalThis as { Zotero?: unknown }).Zotero = {
      isWin: options.isWin,
      Prefs: { get: () => undefined, set: () => undefined },
    };
    (globalThis as { IOUtils?: unknown }).IOUtils = {
      exists: async (path: string) => options.existingPaths.includes(path),
    };
  }

  it("prefers a .cmd shim for a Windows path without an executable extension", async function () {
    stubPlatform({
      isWin: true,
      existingPaths: ["C:\\Tools\\opencode.cmd", "C:\\Tools\\opencode.exe"],
    });
    assert.equal(
      await resolveOpenCodeBinaryPath("C:\\Tools\\opencode"),
      "C:\\Tools\\opencode.cmd",
    );
  });

  it("falls back to a .exe shim on Windows", async function () {
    stubPlatform({
      isWin: true,
      existingPaths: ["C:\\Tools\\opencode.exe"],
    });
    assert.equal(
      await resolveOpenCodeBinaryPath("C:\\Tools\\opencode"),
      "C:\\Tools\\opencode.exe",
    );
  });

  it("leaves Windows paths with an executable extension unchanged", async function () {
    stubPlatform({
      isWin: true,
      existingPaths: ["C:\\Tools\\opencode.cmd"],
    });
    assert.equal(
      await resolveOpenCodeBinaryPath("C:\\Tools\\opencode.exe"),
      "C:\\Tools\\opencode.exe",
    );
  });

  it("does not apply Windows shims on POSIX", async function () {
    stubPlatform({
      isWin: false,
      existingPaths: ["/opt/homebrew/bin/opencode.cmd"],
    });
    assert.equal(
      await resolveOpenCodeBinaryPath("/opt/homebrew/bin/opencode"),
      "/opt/homebrew/bin/opencode",
    );
  });
});
