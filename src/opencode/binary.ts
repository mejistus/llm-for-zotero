import { pathExists } from "../utils/geckoFs";
import { joinLocalPath } from "../utils/localPath";
import { getRuntimePlatformInfo } from "../utils/runtimePlatform";
import { OPENCODE_BINARY_NAME } from "./constants";
import { loadOpenCodeSubprocessModule, readProcessOutput } from "./subprocess";

function getRuntimeEnvValue(key: string): string {
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

function getHomeDir(): string {
  return (
    getRuntimeEnvValue("HOME") ||
    getRuntimeEnvValue("USERPROFILE") ||
    (
      globalThis as { PathUtils?: { homeDir?: string } }
    ).PathUtils?.homeDir?.trim() ||
    ""
  );
}

const WINDOWS_EXECUTABLE_EXTENSIONS = [".exe", ".cmd", ".bat"] as const;

function hasWindowsExecutableExtension(path: string): boolean {
  const lower = path.toLowerCase();
  return WINDOWS_EXECUTABLE_EXTENSIONS.some((extension) =>
    lower.endsWith(extension),
  );
}

async function resolveWindowsExecutablePath(path: string): Promise<string> {
  if (
    !path ||
    getRuntimePlatformInfo().platform !== "windows" ||
    hasWindowsExecutableExtension(path)
  ) {
    return path;
  }
  for (const extension of [".cmd", ".exe"] as const) {
    const candidate = `${path}${extension}`;
    if (await pathExists(candidate)) return candidate;
  }
  return path;
}

function firstLookupResult(stdout: string): string {
  for (const line of stdout.split(/\r?\n/)) {
    const candidate = line.trim();
    if (candidate) return candidate;
  }
  return "";
}

async function lookupWithShell(): Promise<string> {
  let Subprocess: any;
  try {
    Subprocess = await loadOpenCodeSubprocessModule();
  } catch {
    return "";
  }
  const info = getRuntimePlatformInfo();
  try {
    const proc = await Subprocess.call({
      command: info.shellPath,
      arguments: [
        info.shellFlag,
        info.platform === "windows"
          ? `where ${OPENCODE_BINARY_NAME}`
          : `which ${OPENCODE_BINARY_NAME}`,
      ],
    });
    const { stdout, exitCode } = await readProcessOutput(proc);
    if (typeof exitCode === "number" && exitCode !== 0) return "";
    return firstLookupResult(stdout);
  } catch {
    return "";
  }
}

function buildCommonCandidates(): string[] {
  const info = getRuntimePlatformInfo();
  const home = getHomeDir();
  const candidates: string[] = [];
  if (home) {
    candidates.push(
      joinLocalPath(home, ".npm-global", "bin", OPENCODE_BINARY_NAME),
      joinLocalPath(home, ".local", "bin", OPENCODE_BINARY_NAME),
      joinLocalPath(home, ".bun", "bin", OPENCODE_BINARY_NAME),
      joinLocalPath(home, "bin", OPENCODE_BINARY_NAME),
    );
  }
  if (info.platform !== "windows") {
    candidates.push(
      `/opt/homebrew/bin/${OPENCODE_BINARY_NAME}`,
      `/usr/local/bin/${OPENCODE_BINARY_NAME}`,
    );
  }
  return candidates;
}

export async function resolveOpenCodeBinaryPath(
  explicitPath?: string,
): Promise<string> {
  const explicit = explicitPath?.trim();
  if (explicit) return resolveWindowsExecutablePath(explicit);

  const configured = getRuntimeEnvValue("OPENCODE_PATH");
  if (configured) return resolveWindowsExecutablePath(configured);

  const fromPath = await lookupWithShell();
  if (fromPath) return resolveWindowsExecutablePath(fromPath);

  for (const candidate of buildCommonCandidates()) {
    const resolved = await resolveWindowsExecutablePath(candidate);
    if (resolved !== candidate || (await pathExists(resolved))) return resolved;
  }

  return OPENCODE_BINARY_NAME;
}
