import { OutputWindow } from "./outputWindow";

/**
 * 统一处理 Markdown -> Zotero Note HTML 的转换逻辑，供 API 总结与网页总结共用。
 */
export function buildNoteHtmlFromMarkdown(
  summaryHeading: string,
  modelLabel: string,
  markdown: string,
): string {
  const htmlContent = convertMarkdownToNoteHTML(markdown);
  return `<h2>${escapeHtml(summaryHeading)}</h2>
<p><strong>模型：</strong>${escapeHtml(modelLabel)}</p>
<div>${htmlContent}</div>`;
}

/**
 * 将 Markdown 转换为适合 Zotero 笔记的 HTML 格式。
 */
export function convertMarkdownToNoteHTML(markdown: string): string {
  let html = OutputWindow.convertMarkdownToHTMLCore(markdown);

  html = html.replace(/\s+style="[^"]*"/g, "");

  html = html.replace(
    /\$\$([\s\S]*?)\$\$/g,
    (_match: string, formula: string) => {
      return `<pre class="math">$$${formula}$$</pre>`;
    },
  );

  // eslint-disable-next-line no-useless-escape
  html = html.replace(/\$([^\$\n]+?)\$/g, (_match: string, formula: string) => {
    return `<span class="math">$${formula}$</span>`;
  });

  return html;
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
