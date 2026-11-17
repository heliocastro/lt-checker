import { apiUrl, authHeaders, loadSettings, saveSettings, type Settings } from "./settings";

const input = (id: string) => document.getElementById(id) as HTMLInputElement;
const area = (id: string) => document.getElementById(id) as HTMLTextAreaElement;
const statusEl = document.getElementById("status") as HTMLSpanElement;

const lines = (s: string) =>
  s
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean);

function status(msg: string, ok = true): void {
  statusEl.textContent = msg;
  statusEl.dataset.ok = String(ok);
}

function read(): Settings {
  return {
    serverUrl: input("serverUrl").value.trim(),
    apiToken: input("apiToken").value.trim(),
    language: input("language").value.trim() || "auto",
    motherTongue: input("motherTongue").value.trim(),
    preferredVariants: input("preferredVariants").value.trim(),
    picky: input("picky").checked,
    dictionary: lines(area("dictionary").value),
    disabledRules: lines(area("disabledRules").value),
    disabledSites: lines(area("disabledSites").value),
  };
}

/** Requests host permission for the server; must run inside the click handler. */
async function grant(serverUrl: string): Promise<boolean> {
  let u: URL;
  try {
    u = new URL(serverUrl);
  } catch {
    status("Invalid server URL", false);
    return false;
  }
  const ok = await chrome.permissions.request({ origins: [`${u.protocol}//${u.hostname}/*`] });
  if (!ok) status("Permission to contact the server was denied", false);
  return ok;
}

async function fetchLanguages(
  serverUrl: string,
  token: string,
): Promise<{ name: string; longCode: string }[]> {
  const res = await fetch(apiUrl(serverUrl, "languages"), { headers: authHeaders(token) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as { name: string; longCode: string }[];
}

async function fillLanguages(serverUrl: string, token: string): Promise<number> {
  const langs = await fetchLanguages(serverUrl, token);
  const list = document.getElementById("langs") as HTMLDataListElement;
  list.replaceChildren(
    ...[{ name: "Auto-detect", longCode: "auto" }, ...langs].map((l) => {
      const o = document.createElement("option");
      o.value = l.longCode;
      o.label = l.name;
      return o;
    }),
  );
  return langs.length;
}

async function load(): Promise<void> {
  const s = await loadSettings();
  input("serverUrl").value = s.serverUrl;
  input("apiToken").value = s.apiToken;
  input("language").value = s.language;
  input("motherTongue").value = s.motherTongue;
  input("preferredVariants").value = s.preferredVariants;
  input("picky").checked = s.picky;
  area("dictionary").value = s.dictionary.join("\n");
  area("disabledRules").value = s.disabledRules.join("\n");
  area("disabledSites").value = s.disabledSites.join("\n");
  fillLanguages(s.serverUrl, s.apiToken).catch(() => {});
}

document.getElementById("save")!.addEventListener("click", async () => {
  const s = read();
  if (!(await grant(s.serverUrl))) return;
  await saveSettings(s);
  status("Saved");
});

document.getElementById("test")!.addEventListener("click", async () => {
  const url = input("serverUrl").value.trim();
  if (!(await grant(url))) return;
  status("Testing…");
  try {
    status(
      `Connected: ${await fillLanguages(url, input("apiToken").value.trim())} languages available`,
    );
  } catch (e) {
    status(`Failed: ${e instanceof Error ? e.message : String(e)}`, false);
  }
});

void load();
