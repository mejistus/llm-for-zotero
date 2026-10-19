import { config } from "../../package.json";
import { getClaudeProfileSignature } from "../claudeCode/projectSkills";

type ZoteroPrefsAPI = {
  get?: (key: string, global?: boolean) => unknown;
  set?: (key: string, value: unknown, global?: boolean) => void;
};

const OPEN_CODE_SESSION_MAP_PREF_KEY = `${config.prefsPrefix}.openCodeSessionMap`;

let cachedStore: Record<string, string> | null = null;
let cachedProfileSignature = "";

function getZoteroPrefs(): ZoteroPrefsAPI | null {
  return (
    (globalThis as typeof globalThis & { Zotero?: { Prefs?: ZoteroPrefsAPI } })
      .Zotero?.Prefs || null
  );
}

function resolveProfileSignature(): string {
  try {
    return getClaudeProfileSignature();
  } catch {
    return "default";
  }
}

function normalizeConversationKey(conversationKey: number): number {
  const key = Math.floor(Number(conversationKey));
  return Number.isFinite(key) && key > 0 ? key : 0;
}

function buildSessionKey(
  profileSignature: string,
  conversationKey: number,
): string {
  return `${profileSignature}:${normalizeConversationKey(conversationKey)}`;
}

function readStore(profileSignature: string): Record<string, string> {
  if (cachedStore && cachedProfileSignature === profileSignature) {
    return cachedStore;
  }
  const prefs = getZoteroPrefs();
  if (!prefs?.get) return {};
  let parsed: unknown;
  try {
    const raw = prefs.get(OPEN_CODE_SESSION_MAP_PREF_KEY);
    parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return {};
  }
  const store: Record<string, string> = {};
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    for (const [key, value] of Object.entries(
      parsed as Record<string, unknown>,
    )) {
      if (typeof value === "string" && value.trim()) {
        store[key] = value.trim();
      }
    }
  }
  cachedStore = store;
  cachedProfileSignature = profileSignature;
  return store;
}

function writeStore(
  profileSignature: string,
  store: Record<string, string>,
): void {
  const prefs = getZoteroPrefs();
  if (!prefs?.set) return;
  try {
    prefs.set(OPEN_CODE_SESSION_MAP_PREF_KEY, JSON.stringify(store));
    cachedStore = store;
    cachedProfileSignature = profileSignature;
  } catch {
    void 0;
  }
}

export function getOpenCodeSessionId(
  conversationKey: number,
): string | undefined {
  const profileSignature = resolveProfileSignature();
  const store = readStore(profileSignature);
  return store[buildSessionKey(profileSignature, conversationKey)];
}

export function setOpenCodeSessionId(
  conversationKey: number,
  sessionID: string,
): void {
  const normalizedSessionID = sessionID.trim();
  if (!normalizedSessionID) {
    clearOpenCodeSessionId(conversationKey);
    return;
  }
  const profileSignature = resolveProfileSignature();
  const store = {
    ...readStore(profileSignature),
    [buildSessionKey(profileSignature, conversationKey)]: normalizedSessionID,
  };
  writeStore(profileSignature, store);
}

export function clearOpenCodeSessionId(conversationKey: number): void {
  const profileSignature = resolveProfileSignature();
  const store = { ...readStore(profileSignature) };
  const key = buildSessionKey(profileSignature, conversationKey);
  if (!(key in store)) return;
  delete store[key];
  writeStore(profileSignature, store);
}

export function resetOpenCodeSessionStoreForTests(): void {
  cachedStore = null;
  cachedProfileSignature = "";
}
