import { config } from "../../package.json";

type PrefStore = {
  get?: (key: string, global?: boolean) => unknown;
  set?: (key: string, value: unknown, global?: boolean) => void;
};

function prefKey(name: string): string {
  return `${config.prefsPrefix}.${name}`;
}

function getPrefStore(): PrefStore | undefined {
  return (globalThis as unknown as { Zotero?: { Prefs?: PrefStore } }).Zotero
    ?.Prefs;
}

export function isOpenCodeModeEnabled(): boolean {
  try {
    const value = getPrefStore()?.get?.(prefKey("enableOpenCodeMode"), true);
    return value === true || `${value || ""}`.toLowerCase() === "true";
  } catch {
    return false;
  }
}

export function setOpenCodeModeEnabled(enabled: boolean): void {
  try {
    getPrefStore()?.set?.(
      prefKey("enableOpenCodeMode"),
      Boolean(enabled),
      true,
    );
  } catch {
    void 0;
  }
}

export function isOpenCodeAutoApproveEnabled(): boolean {
  try {
    const value = getPrefStore()?.get?.(prefKey("openCodeAutoApprove"), true);
    return value === true || `${value || ""}`.toLowerCase() === "true";
  } catch {
    return false;
  }
}

export function setOpenCodeAutoApproveEnabled(enabled: boolean): void {
  try {
    getPrefStore()?.set?.(
      prefKey("openCodeAutoApprove"),
      Boolean(enabled),
      true,
    );
  } catch {
    void 0;
  }
}
