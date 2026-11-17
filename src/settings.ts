export interface Settings {
  serverUrl: string;
  apiToken: string;
  language: string;
  motherTongue: string;
  preferredVariants: string;
  picky: boolean;
  dictionary: string[];
  disabledRules: string[];
  disabledSites: string[];
}

export const DEFAULTS: Settings = {
  serverUrl: "https://lt.example.info",
  apiToken: "",
  language: "auto",
  motherTongue: "",
  preferredVariants: "en-US,de-DE,pt-BR",
  picky: false,
  dictionary: [],
  disabledRules: [],
  disabledSites: [],
};

export async function loadSettings(): Promise<Settings> {
  const stored = (await chrome.storage.local.get(DEFAULTS)) as Partial<Settings>;
  return { ...DEFAULTS, ...stored };
}

export async function saveSettings(patch: Partial<Settings>): Promise<void> {
  await chrome.storage.local.set(patch);
}

export function authHeaders(token: string): Record<string, string> {
  return token.trim() ? { Authorization: `Bearer ${token.trim()}` } : {};
}

export function apiUrl(serverUrl: string, path: string): string {
  return `${serverUrl.trim().replace(/\/+$/, "").replace(/\/v2$/, "")}/v2/${path}`;
}
