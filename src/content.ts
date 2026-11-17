import { buildTextMap, locate } from "./textmap";
import type { CheckResponse, LtMatch, Request } from "./types";

type Field = HTMLTextAreaElement | HTMLElement;

const DEBOUNCE_MS = 900;

const MIRROR_PROPS = [
  "box-sizing",
  "width",
  "height",
  "overflow-x",
  "overflow-y",
  "border-top-width",
  "border-right-width",
  "border-bottom-width",
  "border-left-width",
  "border-top-style",
  "border-right-style",
  "border-bottom-style",
  "border-left-style",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "font-family",
  "font-size",
  "font-style",
  "font-variant",
  "font-weight",
  "font-stretch",
  "line-height",
  "letter-spacing",
  "word-spacing",
  "text-align",
  "text-transform",
  "text-indent",
  "tab-size",
  "white-space",
  "word-wrap",
  "overflow-wrap",
  "word-break",
  "direction",
  "writing-mode",
];

const CSS = `
.clip { position: fixed; overflow: hidden; pointer-events: none; }
.ul { position: absolute; height: 2px; border-radius: 1px; opacity: .8; }
.ul.sel { height: 3px; opacity: 1; }
.mirror { position: fixed; top: 0; left: 0; visibility: hidden; pointer-events: none; border-color: transparent; }
.badge {
  position: fixed; width: 20px; height: 20px; border-radius: 50%;
  font: 600 11px/20px system-ui, sans-serif; text-align: center; color: #fff;
  background: #30a46c; cursor: pointer; user-select: none; opacity: .9;
  box-shadow: 0 1px 3px rgba(0,0,0,.3); pointer-events: auto;
}
.badge[data-state=errors] { background: #e5484d; }
.badge[data-state=checking] { background: #8b8d98; }
.badge[data-state=error] { background: #6e56cf; }
.card {
  position: fixed; min-width: 220px; max-width: 340px; padding: 12px; box-sizing: border-box;
  background: #fff; color: #1c2024; border-radius: 10px; pointer-events: auto;
  box-shadow: 0 6px 24px rgba(0,0,0,.18), 0 0 0 1px rgba(0,0,0,.06);
  font: 13px/1.45 system-ui, sans-serif; text-align: left;
}
.cat { display: flex; align-items: center; gap: 6px; margin-bottom: 4px;
  font-size: 11px; letter-spacing: .04em; text-transform: uppercase; color: #60646c; }
.dot { width: 8px; height: 8px; border-radius: 50%; }
.msg { margin: 0 0 8px; }
.reps { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
.rep { border: 0; border-radius: 6px; padding: 4px 10px; background: #3e63dd; color: #fff;
  font: 600 13px system-ui, sans-serif; cursor: pointer; }
.rep:hover { background: #3358d4; }
.acts { display: flex; gap: 12px; padding-top: 8px; border-top: 1px solid #e8e8ec; }
.act { border: 0; background: none; padding: 0; color: #60646c; font: 12px system-ui, sans-serif; cursor: pointer; }
.act:hover { color: #1c2024; text-decoration: underline; }
[hidden] { display: none !important; }
@media (prefers-color-scheme: dark) {
  .card { background: #212225; color: #edeef0; box-shadow: 0 6px 24px rgba(0,0,0,.5), 0 0 0 1px #363a3f; }
  .cat, .act { color: #b0b4ba; }
  .act:hover { color: #edeef0; }
  .acts { border-color: #363a3f; }
}
`;

function send<T>(msg: Request): Promise<T> {
  return chrome.runtime.sendMessage(msg) as Promise<T>;
}

function colorFor(m: LtMatch): string {
  const t = m.rule.issueType ?? "";
  if (t === "misspelling") return "#e5484d";
  if (t === "style" || t === "register" || t === "locale-violation") return "#3e63dd";
  return "#f5a524";
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string) {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** Shifts matches after an edit and drops the ones the edit touched. Mutates in place. */
function rebase(matches: LtMatch[], oldText: string, newText: string): LtMatch[] {
  const max = Math.min(oldText.length, newText.length);
  let p = 0;
  while (p < max && oldText[p] === newText[p]) p++;
  let s = 0;
  while (s < max - p && oldText[oldText.length - 1 - s] === newText[newText.length - 1 - s]) s++;
  const oldEnd = oldText.length - s;
  const delta = newText.length - oldText.length;
  return matches.filter((m) => {
    if (m.offset + m.length < p) return true;
    if (m.offset > oldEnd) {
      m.offset += delta;
      return true;
    }
    return false;
  });
}

// ---------------------------------------------------------------- UI shell

const ui = (() => {
  const host = document.createElement("lt-checker-ui");
  host.style.cssText =
    "all: initial !important; position: fixed !important; top: 0 !important; left: 0 !important; width: 0 !important; height: 0 !important; z-index: 2147483647 !important;";
  const root = host.attachShadow({ mode: "closed" });
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(CSS);
  root.adoptedStyleSheets = [sheet];
  const mirror = el("div", "mirror");
  const clip = el("div", "clip");
  const badge = el("div", "badge");
  const card = el("div", "card");
  badge.hidden = card.hidden = true;
  root.append(mirror, clip, badge, card);
  // Keep focus in the page field when clicking our UI.
  for (const e of [badge, card]) e.addEventListener("mousedown", (ev) => ev.preventDefault());
  return {
    host,
    mirror,
    clip,
    badge,
    card,
    mount() {
      if (!host.isConnected) document.documentElement.append(host);
    },
  };
})();

// ---------------------------------------------------------------- Checker

class Checker {
  matches: LtMatch[] = [];
  text: string;
  selected: LtMatch | null = null;
  private state: "idle" | "checking" | "ok" | "errors" | "error" = "idle";
  private info = "";
  private hits: { m: LtMatch; r: DOMRect }[] = [];
  private timer = 0;
  private seq = 0;
  private readonly ro: ResizeObserver;
  private readonly isTextarea: boolean;
  readonly field: Field;

  constructor(field: Field) {
    this.field = field;
    this.isTextarea = field instanceof HTMLTextAreaElement;
    this.text = this.getText();
    field.addEventListener("input", this.onInput);
    this.ro = new ResizeObserver(scheduleRender);
    this.ro.observe(field);
    void this.check();
  }

  destroy(): void {
    clearTimeout(this.timer);
    this.seq++;
    this.field.removeEventListener("input", this.onInput);
    this.ro.disconnect();
  }

  private getText(): string {
    return this.isTextarea
      ? (this.field as HTMLTextAreaElement).value
      : buildTextMap(this.field).text;
  }

  private onInput = () => {
    this.sync();
    scheduleRender();
  };

  /** Brings matches in line with the current field text; schedules a recheck on change. */
  private sync(): void {
    const t = this.getText();
    if (t === this.text) return;
    this.matches = rebase(this.matches, this.text, t);
    this.text = t;
    if (this.selected && !this.matches.includes(this.selected)) hideCard();
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => void this.check(), DEBOUNCE_MS);
  }

  async check(): Promise<void> {
    clearTimeout(this.timer);
    const text = this.getText();
    const id = ++this.seq;
    if (!text.trim()) {
      this.matches = [];
      this.text = text;
      this.state = "idle";
      scheduleRender();
      return;
    }
    this.state = "checking";
    scheduleRender();
    let res: CheckResponse;
    try {
      res = (await send<CheckResponse>({ type: "check", text })) ?? {
        ok: false,
        error: "No response from extension",
      };
    } catch (e) {
      res = { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
    if (id !== this.seq) return;
    if (!res.ok) {
      this.state = "error";
      this.info = `LanguageTool error: ${res.error}`;
      scheduleRender();
      return;
    }
    const now = this.getText();
    const matches = res.matches.toSorted((a, b) => a.offset - b.offset);
    this.matches = now === text ? matches : rebase(matches, text, now);
    this.text = now;
    this.selected = null;
    this.state = this.matches.length ? "errors" : "ok";
    this.info = res.language ? `Language: ${res.language}` : "";
    scheduleRender();
  }

  private textareaRects(): DOMRect[][] {
    const ta = this.field as HTMLTextAreaElement;
    const cs = getComputedStyle(ta);
    const m = ui.mirror;
    for (const p of MIRROR_PROPS) m.style.setProperty(p, cs.getPropertyValue(p));
    const r = ta.getBoundingClientRect();
    m.style.left = `${r.left}px`;
    m.style.top = `${r.top}px`;
    m.textContent = "";
    const spans: (HTMLSpanElement | null)[] = [];
    let pos = 0;
    for (const match of this.matches) {
      if (match.offset < pos) {
        spans.push(null);
        continue;
      }
      m.append(this.text.slice(pos, match.offset));
      const span = el("span", "", this.text.slice(match.offset, match.offset + match.length));
      m.append(span);
      spans.push(span);
      pos = match.offset + match.length;
    }
    m.append(`${this.text.slice(pos)}​`);
    m.scrollTop = ta.scrollTop;
    m.scrollLeft = ta.scrollLeft;
    const rects = spans.map((s) => (s ? Array.from(s.getClientRects()) : []));
    m.textContent = "";
    return rects;
  }

  private rangeFor(map: ReturnType<typeof buildTextMap>, m: LtMatch): Range | null {
    const a = locate(map, m.offset, false);
    const b = locate(map, m.offset + m.length, true);
    if (!a || !b) return null;
    const range = document.createRange();
    try {
      range.setStart(a.node, a.offset);
      range.setEnd(b.node, b.offset);
    } catch {
      return null;
    }
    return range;
  }

  private editableRects(): DOMRect[][] {
    const map = buildTextMap(this.field);
    return this.matches.map((m) => {
      const range = this.rangeFor(map, m);
      return range ? Array.from(range.getClientRects()).filter((r) => r.width > 0) : [];
    });
  }

  render(): void {
    if (!this.field.isConnected) {
      setActive(null);
      return;
    }
    this.sync();
    const f = this.field;
    const r = f.getBoundingClientRect();
    const cl = r.left + f.clientLeft;
    const ct = r.top + f.clientTop;
    const clip = ui.clip;
    clip.style.left = `${cl}px`;
    clip.style.top = `${ct}px`;
    clip.style.width = `${f.clientWidth}px`;
    clip.style.height = `${f.clientHeight}px`;
    clip.textContent = "";
    this.hits = [];
    const all = this.isTextarea ? this.textareaRects() : this.editableRects();
    this.matches.forEach((m, i) => {
      for (const rr of all[i] ?? []) {
        const u = el("div", m === this.selected ? "ul sel" : "ul");
        u.style.left = `${rr.left - cl}px`;
        u.style.top = `${rr.bottom - ct - 2}px`;
        u.style.width = `${rr.width}px`;
        u.style.background = colorFor(m);
        clip.append(u);
        if (rr.bottom > ct && rr.top < ct + f.clientHeight) this.hits.push({ m, r: rr });
      }
    });

    const b = ui.badge;
    if (this.state === "idle" || r.height < 28 || r.width < 80) {
      b.hidden = true;
      return;
    }
    b.hidden = false;
    b.style.left = `${Math.min(r.right, innerWidth) - 26}px`;
    b.style.top = `${Math.min(r.bottom, innerHeight) - 26}px`;
    b.dataset.state = this.state;
    const n = this.matches.length;
    b.textContent =
      this.state === "errors"
        ? n > 99
          ? "99+"
          : String(n)
        : this.state === "checking"
          ? "…"
          : this.state === "error"
            ? "!"
            : "✓";
    b.title =
      this.state === "errors"
        ? `${n} issue${n === 1 ? "" : "s"}. ${this.info}\nClick to recheck.`
        : this.state === "ok"
          ? `No issues. ${this.info}`
          : this.state === "error"
            ? `${this.info}\nClick to retry.`
            : "Checking…";
  }

  hitTest(x: number, y: number): { m: LtMatch; r: DOMRect } | null {
    return (
      this.hits.find(({ r }) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom + 3) ??
      null
    );
  }

  word(m: LtMatch): string {
    return this.text.slice(m.offset, m.offset + m.length);
  }

  remove(pred: (m: LtMatch) => boolean): void {
    this.matches = this.matches.filter((m) => !pred(m));
    if (!this.matches.length && this.state === "errors") this.state = "ok";
    hideCard();
  }

  apply(m: LtMatch, value: string): void {
    this.sync();
    if (!this.matches.includes(m)) return;
    const start = m.offset;
    const end = m.offset + m.length;
    const cmd = value ? "insertText" : "delete";
    this.field.focus();
    if (this.isTextarea) {
      const ta = this.field as HTMLTextAreaElement;
      ta.setSelectionRange(start, end);
      if (!document.execCommand(cmd, false, value)) {
        ta.setRangeText(value, start, end, "end");
        ta.dispatchEvent(new Event("input", { bubbles: true }));
      }
    } else {
      const range = this.rangeFor(buildTextMap(this.field), m);
      const sel = getSelection();
      if (!range || !sel) return;
      sel.removeAllRanges();
      sel.addRange(range);
      if (!document.execCommand(cmd, false, value)) {
        range.deleteContents();
        if (value) range.insertNode(document.createTextNode(value));
        this.field.dispatchEvent(
          new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }),
        );
      }
    }
    hideCard();
    this.sync();
    scheduleRender();
  }
}

// ---------------------------------------------------------------- Card

function hideCard(): void {
  if (ui.card.hidden) return;
  ui.card.hidden = true;
  if (active) active.selected = null;
  scheduleRender();
}

function showCard(m: LtMatch, anchor: DOMRect): void {
  const checker = active;
  if (!checker) return;
  checker.selected = m;
  const c = ui.card;
  c.textContent = "";

  const cat = el("div", "cat");
  const dot = el("span", "dot");
  dot.style.background = colorFor(m);
  cat.append(dot, m.rule.category.name);
  c.append(cat, el("p", "msg", m.message));

  if (m.replacements.length) {
    const reps = el("div", "reps");
    for (const { value } of m.replacements.slice(0, 6)) {
      const btn = el("button", "rep", value || "(delete)");
      btn.addEventListener("click", () => checker.apply(m, value));
      reps.append(btn);
    }
    c.append(reps);
  }

  const acts = el("div", "acts");
  const action = (label: string, title: string, fn: () => void) => {
    const btn = el("button", "act", label);
    btn.title = title;
    btn.addEventListener("click", fn);
    acts.append(btn);
  };
  if (m.rule.issueType === "misspelling") {
    const word = checker.word(m);
    action("Add to dictionary", `Never flag "${word}" again`, () => {
      void send({ type: "addWord", word }).catch(() => {});
      checker.remove((x) => x.rule.issueType === "misspelling" && checker.word(x) === word);
    });
  }
  action("Ignore", "Ignore this occurrence", () => checker.remove((x) => x === m));
  action("Disable rule", `Disable ${m.rule.id} everywhere (re-enable in options)`, () => {
    void send({ type: "disableRule", ruleId: m.rule.id }).catch(() => {});
    checker.remove((x) => x.rule.id === m.rule.id);
  });
  c.append(acts);

  c.hidden = false;
  const w = c.offsetWidth;
  const h = c.offsetHeight;
  let top = anchor.bottom + 6;
  if (top + h > innerHeight - 8) top = Math.max(8, anchor.top - h - 6);
  c.style.top = `${top}px`;
  c.style.left = `${Math.max(8, Math.min(anchor.left, innerWidth - w - 8))}px`;
  scheduleRender();
}

// ---------------------------------------------------------------- Wiring

let enabled = true;
let active: Checker | null = null;
let raf = 0;

function scheduleRender(): void {
  if (raf) return;
  raf = requestAnimationFrame(() => {
    raf = 0;
    if (active) active.render();
    else {
      ui.clip.textContent = "";
      ui.badge.hidden = true;
    }
  });
}

function editableFrom(target: EventTarget | null): Field | null {
  let f: Field | null = null;
  if (target instanceof HTMLTextAreaElement) {
    if (!target.readOnly && !target.disabled) f = target;
  } else if (target instanceof HTMLElement && target.isContentEditable) {
    f = target;
    while (f.parentElement?.isContentEditable) f = f.parentElement;
  }
  // Code editors and opted-out fields.
  if (
    f &&
    (f.getAttribute("spellcheck") === "false" ||
      f.dataset.gramm === "false" ||
      f.dataset.enableGrammarly === "false")
  ) {
    return null;
  }
  return f;
}

function setActive(field: Field | null): void {
  if (active?.field === field) return;
  hideCard();
  active?.destroy();
  active = null;
  if (field && enabled) {
    ui.mount();
    active = new Checker(field);
  }
  scheduleRender();
}

document.addEventListener(
  "focusin",
  (e) => {
    const f = editableFrom(e.composedPath()[0] ?? null);
    if (f) setActive(f);
  },
  true,
);

window.addEventListener(
  "click",
  (e) => {
    if (!active) return;
    if (e.composedPath().includes(ui.host)) return;
    const hit = active.hitTest(e.clientX, e.clientY);
    if (hit) showCard(hit.m, hit.r);
    else hideCard();
  },
  true,
);

ui.badge.addEventListener("click", () => void active?.check());

window.addEventListener(
  "scroll",
  () => {
    hideCard();
    scheduleRender();
  },
  { capture: true, passive: true },
);
window.addEventListener("resize", scheduleRender);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") hideCard();
});

const site = location.hostname;

function applyEnabled(disabledSites: string[] | undefined): void {
  enabled = !(disabledSites ?? []).includes(site);
  if (window === window.top) void send({ type: "status", enabled }).catch(() => {});
  setActive(enabled ? editableFrom(document.activeElement) : null);
}

chrome.storage.local
  .get("disabledSites")
  .then((s) => applyEnabled(s.disabledSites as string[] | undefined))
  .catch(() => {});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.disabledSites) applyEnabled(changes.disabledSites.newValue as string[] | undefined);
  if (changes.dictionary || changes.disabledRules || changes.language || changes.picky) {
    void active?.check();
  }
});
