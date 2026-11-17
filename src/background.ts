import { apiUrl, authHeaders, loadSettings, saveSettings } from "./settings";
import type { CheckResponse, LtMatch, Request } from "./types";

interface LtResponse {
  matches: LtMatch[];
  language?: { name?: string; detectedLanguage?: { name?: string } };
}

async function check(text: string): Promise<CheckResponse> {
  const s = await loadSettings();
  const body = new URLSearchParams({ text, language: s.language || "auto" });
  if (s.motherTongue) body.set("motherTongue", s.motherTongue);
  if (body.get("language") === "auto" && s.preferredVariants.trim()) {
    body.set("preferredVariants", s.preferredVariants.replace(/\s+/g, ""));
  }
  if (s.picky) body.set("level", "picky");
  if (s.disabledRules.length) body.set("disabledRules", s.disabledRules.join(","));

  const res = await fetch(apiUrl(s.serverUrl, "check"), {
    method: "POST",
    body,
    headers: authHeaders(s.apiToken),
  });
  if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as LtResponse;

  const dict = new Set(s.dictionary.map((w) => w.toLowerCase()));
  const matches = data.matches.filter(
    (m) =>
      !(
        m.rule.issueType === "misspelling" &&
        dict.has(text.slice(m.offset, m.offset + m.length).toLowerCase())
      ),
  );
  return {
    ok: true,
    matches,
    language: data.language?.detectedLanguage?.name ?? data.language?.name,
  };
}

async function addUnique(key: "dictionary" | "disabledRules", value: string): Promise<void> {
  const s = await loadSettings();
  if (!s[key].includes(value)) await saveSettings({ [key]: [...s[key], value] });
}

function setBadge(tabId: number, enabled: boolean): void {
  void chrome.action.setBadgeText({ tabId, text: enabled ? "" : "OFF" });
  void chrome.action.setBadgeBackgroundColor({ tabId, color: "#888" });
}

async function handle(msg: Request, sender: chrome.runtime.MessageSender): Promise<unknown> {
  switch (msg.type) {
    case "check":
      return check(msg.text);
    case "addWord":
      return addUnique("dictionary", msg.word);
    case "disableRule":
      return addUnique("disabledRules", msg.ruleId);
    case "status":
      if (sender.tab?.id !== undefined && sender.frameId === 0)
        setBadge(sender.tab.id, msg.enabled);
      return null;
  }
}

chrome.runtime.onMessage.addListener((msg: Request, sender, sendResponse) => {
  handle(msg, sender).then(sendResponse, (e: unknown) =>
    sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) }),
  );
  return true;
});

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.url || tab.id === undefined) return;
  let host: string;
  try {
    host = new URL(tab.url).hostname;
  } catch {
    return;
  }
  const s = await loadSettings();
  const disabled = s.disabledSites.includes(host);
  await saveSettings({
    disabledSites: disabled
      ? s.disabledSites.filter((h) => h !== host)
      : [...s.disabledSites, host],
  });
  setBadge(tab.id, disabled);
});
