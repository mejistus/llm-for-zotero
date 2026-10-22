export type ProcessOutput = {
  stdout: string;
  exitCode?: number;
};

const OPENCODE_ENV_KEYS = [
  "HOME",
  "USERPROFILE",
  "PATH",
  "Path",
  "APPDATA",
  "LOCALAPPDATA",
  "NPM_CONFIG_PREFIX",
  "npm_config_prefix",
  "PREFIX",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "XDG_STATE_HOME",
  "XDG_CACHE_HOME",
  "OPENCODE_CONFIG",
  "OPENCODE_CONFIG_DIR",
  "HTTPS_PROXY",
  "HTTP_PROXY",
  "ALL_PROXY",
  "NO_PROXY",
  "no_proxy",
] as const;

function readEnvironmentValue(key: string): string {
  try {
    const processValue = (globalThis as any).process?.env?.[key];
    if (typeof processValue === "string" && processValue.trim()) {
      return processValue.trim();
    }
  } catch {
    void 0;
  }
  try {
    const servicesValue = (globalThis as any).Services?.env?.get?.(key);
    if (typeof servicesValue === "string" && servicesValue.trim()) {
      return servicesValue.trim();
    }
  } catch {
    void 0;
  }
  return "";
}

export function buildOpenCodeLaunchEnvironment(): Record<string, string> {
  const environment: Record<string, string> = {};
  for (const key of OPENCODE_ENV_KEYS) {
    const value = readEnvironmentValue(key);
    if (value) environment[key] = value;
  }
  const noProxy = [
    environment.NO_PROXY || environment.no_proxy,
    "localhost",
    "127.0.0.1",
    "::1",
  ]
    .filter(Boolean)
    .join(",");
  environment.NO_PROXY = noProxy;
  environment.no_proxy = noProxy;
  return environment;
}

export async function loadOpenCodeSubprocessModule(): Promise<any> {
  const CU = (globalThis as any).ChromeUtils;
  let Subprocess: any;
  if (CU?.importESModule) {
    try {
      const mod = CU.importESModule(
        "resource://gre/modules/Subprocess.sys.mjs",
      );
      Subprocess = mod.Subprocess || mod.default || mod;
    } catch {
      void 0;
    }
  }
  if (!Subprocess?.call && CU?.import) {
    try {
      const mod = CU.import("resource://gre/modules/Subprocess.jsm");
      Subprocess = mod.Subprocess || mod;
    } catch {
      void 0;
    }
  }
  if (!Subprocess?.call) {
    throw new Error(
      "Subprocess module not available in this Zotero environment",
    );
  }
  return Subprocess;
}

/**
 * Give the child EOF on stdin.
 *
 * Zotero's Subprocess always allocates a stdin pipe, and OpenCode's `run`
 * command waits for stdin to close before starting the turn. Leaving the pipe
 * open makes `opencode run` sit silently until the plugin's timeout fires.
 */
export async function closeProcessStdin(proc: any): Promise<void> {
  try {
    if (proc?.stdin && !proc.stdin.closed) {
      await proc.stdin.close?.();
    }
  } catch {
    void 0;
  }
}

export async function readProcessStreamToString(stream: any): Promise<string> {
  let out = "";
  while (true) {
    let chunk: string | undefined;
    try {
      chunk = await stream?.readString?.();
    } catch {
      break;
    }
    if (!chunk) break;
    out += chunk;
  }
  return out;
}

export async function waitForProcessExitCode(
  proc: any,
): Promise<number | undefined> {
  try {
    const result = await proc?.wait?.();
    const exitCode = result?.exitCode;
    return typeof exitCode === "number" ? exitCode : undefined;
  } catch {
    return undefined;
  }
}

export async function readProcessOutput(proc: any): Promise<ProcessOutput> {
  const stdout = await readProcessStreamToString(proc?.stdout);
  const exitCode = await waitForProcessExitCode(proc);
  return { stdout, exitCode };
}
