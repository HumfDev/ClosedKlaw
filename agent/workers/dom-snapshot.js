/**
 * Strip a raw HTML page down to a compact form safe to pass to an LLM.
 * Removes scripts, styles, SVGs, hidden elements, and collapses whitespace.
 * Targets < 8K tokens (approx 32K chars), truncating with a marker if needed.
 */

const STRIP_TAGS_RE =
  /<(script|style|svg|noscript|head)[^>]*>[\s\S]*?<\/\1>/gi;
const HTML_COMMENT_RE = /<!--[\s\S]*?-->/g;
const HIDDEN_INPUT_RE = /<input[^>]+type=["']hidden["'][^>]*\/?>/gi;
const ARIA_HIDDEN_RE = /aria-hidden=["']true["']/i;
const DISPLAY_NONE_RE = /style=["'][^"']*display\s*:\s*none[^"']*["']/i;

const KEEP_TAGS = new Set([
  "form", "fieldset", "label", "input", "select", "option", "textarea",
  "button", "a", "h1", "h2", "h3", "h4", "p", "span", "div", "li",
]);

const MAX_CHARS = 32_000;

export function snapshotDom(html) {
  if (!html) return "";

  let text = html
    .replace(STRIP_TAGS_RE, "")
    .replace(HTML_COMMENT_RE, "")
    .replace(HIDDEN_INPUT_RE, "");

  // Remove elements that are aria-hidden or display:none
  text = text.replace(/<[^>]+(aria-hidden=["']true["']|display\s*:\s*none)[^>]*>[\s\S]*?<\/[a-z]+>/gi, "");

  // Strip all attributes except the ones useful for field mapping
  text = text.replace(
    /<([a-z][a-z0-9]*)\s([^>]*)>/gi,
    (_, tag, attrs) => {
      if (!KEEP_TAGS.has(tag.toLowerCase())) return `<${tag}>`;
      const kept = [];
      const nameM = attrs.match(/\bname=["']([^"']+)["']/i);
      const idM = attrs.match(/\bid=["']([^"']+)["']/i);
      const typeM = attrs.match(/\btype=["']([^"']+)["']/i);
      const placeholderM = attrs.match(/\bplaceholder=["']([^"']+)["']/i);
      const forM = attrs.match(/\bfor=["']([^"']+)["']/i);
      const requiredM = /\brequired\b/i.test(attrs);
      if (nameM) kept.push(`name="${nameM[1]}"`);
      if (idM) kept.push(`id="${idM[1]}"`);
      if (typeM) kept.push(`type="${typeM[1]}"`);
      if (placeholderM) kept.push(`placeholder="${placeholderM[1]}"`);
      if (forM) kept.push(`for="${forM[1]}"`);
      if (requiredM) kept.push("required");
      return kept.length ? `<${tag} ${kept.join(" ")}>` : `<${tag}>`;
    },
  );

  // Collapse whitespace
  text = text.replace(/\s{2,}/g, " ").trim();

  if (text.length > MAX_CHARS) {
    text = text.slice(0, MAX_CHARS) + "\n[... truncated]";
  }

  return text;
}
