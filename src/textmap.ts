/** Maps the plain text of a contenteditable element back to DOM text nodes. */
export interface TextMap {
  text: string;
  segments: { node: Text; start: number }[];
}

const BLOCK =
  /^(ADDRESS|ARTICLE|ASIDE|BLOCKQUOTE|DD|DIV|DL|DT|FIELDSET|FIGCAPTION|FIGURE|FOOTER|FORM|H[1-6]|HEADER|HR|LI|MAIN|NAV|OL|P|PRE|SECTION|TABLE|TBODY|TD|TH|TR|UL)$/;
const SKIP = /^(SCRIPT|STYLE|TEMPLATE|NOSCRIPT)$/;

export function buildTextMap(root: Node): TextMap {
  let text = "";
  const segments: TextMap["segments"] = [];
  const newline = () => {
    if (text && !text.endsWith("\n")) text += "\n";
  };
  const walk = (node: Node) => {
    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        const t = child as Text;
        segments.push({ node: t, start: text.length });
        // NBSP is common in contenteditable; LanguageTool treats it oddly. Same length, safe.
        text += t.data.replace(/ /g, " ");
      } else if (child instanceof Element) {
        if (SKIP.test(child.tagName)) continue;
        if (child.tagName === "BR") {
          text += "\n";
          continue;
        }
        const block = BLOCK.test(child.tagName);
        if (block) newline();
        walk(child);
        if (block) newline();
      }
    }
  };
  walk(root);
  return { text, segments };
}

/** Finds the text node/offset for a text offset. `isEnd` prefers the earlier node at boundaries. */
export function locate(
  map: TextMap,
  offset: number,
  isEnd: boolean,
): { node: Text; offset: number } | null {
  const { segments } = map;
  for (let i = 0; i < segments.length; i++) {
    const { node, start } = segments[i];
    const end = start + node.data.length;
    if (offset < start) {
      // Offset fell on a synthetic newline between segments.
      return isEnd && i > 0
        ? { node: segments[i - 1].node, offset: segments[i - 1].node.data.length }
        : { node, offset: 0 };
    }
    if (offset < end || (offset === end && (isEnd || i === segments.length - 1))) {
      return { node, offset: offset - start };
    }
  }
  const last = segments.at(-1);
  return last ? { node: last.node, offset: last.node.data.length } : null;
}
