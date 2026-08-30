import { marked } from "marked";

/**
 * Converts a stage output (Markdown or ready HTML) to clean HTML
 * suitable for pasting into Google Docs / Word.
 */
export function outputToHtml(output: string): string {
  const trimmed = (output ?? "").trim();
  const looksLikeHtml =
    trimmed.startsWith("<") && /<\/(p|h[1-6]|ul|ol|table|div|blockquote)>/i.test(trimmed);
  const html = looksLikeHtml ? trimmed : (marked.parse(trimmed, { async: false }) as string);
  // basic hygiene: no scripts/styles/event handlers in the copied fragment
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/\son\w+="[^"]*"/gi, "");
}

/**
 * Copies rich text (text/html + text/plain fallback) to the clipboard.
 * Pasting into Google Docs keeps headings, bold, lists and tables.
 */
export async function copyRichText(html: string, plain: string): Promise<void> {
  if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([plain], { type: "text/plain" }),
        }),
      ]);
      return;
    } catch {
      // brak uprawnień / starsza przeglądarka — spróbuj metody legacy poniżej
    }
  }
  // Fallback: select a hidden node and use the legacy copy command
  const container = document.createElement("div");
  container.innerHTML = html;
  container.style.position = "fixed";
  container.style.left = "-9999px";
  document.body.appendChild(container);
  const range = document.createRange();
  range.selectNodeContents(container);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  document.execCommand("copy");
  selection?.removeAllRanges();
  container.remove();
}
