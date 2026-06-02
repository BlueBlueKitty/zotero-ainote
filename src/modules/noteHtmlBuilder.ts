import { OutputWindow } from "./outputWindow";
import { runtimeT } from "../utils/runtimeLocale";
import { normalizeMathInHtmlDom, normalizeMathInMarkdown } from "./mathFormulaKernel";

/**
 * 统一处理 Markdown -> Zotero Note HTML 的转换逻辑，供 API 总结与网页总结共用。
 */
export function buildNoteHtmlFromMarkdown(
  summaryHeading: string,
  modelLabel: string,
  markdown: string,
  completedAt?: Date,
): string {
  const htmlContent = convertMarkdownToNoteHTML(markdown);
  const completedAtText = formatCompletedAt(completedAt || new Date());
  const completedAtLabel = runtimeT({
    "zh-CN": "总结完成时间",
    "zh-TW": "總結完成時間",
    "en-US": "Summary Completed At",
  });
  return `<h2>${escapeHtml(summaryHeading)}</h2>
<p><strong>模型：</strong>${escapeHtml(modelLabel)}</p>
<p><strong>${escapeHtml(completedAtLabel)}：</strong>${escapeHtml(completedAtText)}</p>
<div>${htmlContent}</div>`;
}

function formatCompletedAt(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day} ${hour}:${minute}`;
}

/**
 * 将 Markdown 转换为适合 Zotero 笔记的 HTML 格式。
 */
export function convertMarkdownToNoteHTML(markdown: string): string {
  let html = OutputWindow.convertMarkdownToHTMLCore(normalizeMathInMarkdown(markdown));

  html = html.replace(/\s+style="[^"]*"/g, "");

  return normalizeNoteHtmlMath(html);
}

function normalizeNoteHtmlMath(html: string): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(`<body>${html}</body>`, "text/html");
  const body = doc.body;
  normalizeMathInHtmlDom(body);
  return body.innerHTML;
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
