import { getString } from "../utils/locale";
import { runtimeT } from "../utils/runtimeLocale";

export type NoteFormatActionType =
  | "fix-math"
  | "downgrade-headings"
  | "upgrade-headings"
  | "remove-extra-line-breaks";

export interface NoteFormatActionDefinition {
  id: NoteFormatActionType;
  label: string;
  description: string;
}

export interface NoteFormatResult {
  html: string;
  changed: boolean;
  stats: { [key: string]: number };
  warnings: string[];
  message: string;
}

interface MathFixStats {
  inlineFixed: number;
  blockFixed: number;
  riskySkipped: number;
  unsupportedWarnings: number;
}

interface SplitExtraLineBreakStats {
  removedEmptyBlocks: number;
  mergedParagraphs: number;
  removedBreaks: number;
}

interface HeadingStats {
  headingCount: number;
  changedHeadings: number;
}

interface FormulaCandidate {
  kind: "inline" | "block";
  text: string;
  risky?: boolean;
}

interface TextSegment {
  type: "text" | "inline-math";
  content: string;
}

const LOG_PREFIX = "[AiNote][NoteFormatter]";
const SUPPORTED_BLOCK_ENVS = new Set(["equation", "align"]);
const BLOCK_FORMULA_CONTAINER_SELECTOR =
  "p, div, li, td, th, blockquote, h1, h2, h3, h4, h5, h6";
const SKIP_MATH_SELECTOR =
  "pre, code, a, .math, .katex, script, style, textarea";
const SKIP_CLEANUP_SELECTOR = "pre, code, table, blockquote, .math";
const ELEMENT_NODE = 1;
const TEXT_NODE = 3;
const SHOW_TEXT = 0x4;

export const NOTE_FORMAT_ACTIONS: NoteFormatActionDefinition[] = [
  {
    id: "fix-math",
    label: runtimeT({
      "en-US": "Fix Math Formulas",
      "zh-CN": "公式自动修复",
      "zh-TW": "公式自動修復",
    }),
    description: runtimeT({
      "en-US": "Fix common Markdown/LaTeX formulas to Zotero-renderable format",
      "zh-CN": "修复常见 Markdown/LaTeX 公式为 Zotero 可渲染格式",
      "zh-TW": "修復常見 Markdown/LaTeX 公式為 Zotero 可渲染格式",
    }),
  },
  {
    id: "downgrade-headings",
    label: runtimeT({
      "en-US": "Downgrade All Headings",
      "zh-CN": "降级所有标题",
      "zh-TW": "降級所有標題",
    }),
    description: runtimeT({
      "en-US": "Downgrade h1-h6 headings by one level, h6 remains unchanged",
      "zh-CN": "将 h1-h6 标题整体降一级，h6 保持不变",
      "zh-TW": "將 h1-h6 標題整體降一級，h6 保持不變",
    }),
  },
  {
    id: "upgrade-headings",
    label: runtimeT({
      "en-US": "Upgrade All Headings",
      "zh-CN": "升级所有标题",
      "zh-TW": "升級所有標題",
    }),
    description: runtimeT({
      "en-US": "Upgrade h1-h6 headings by one level, h1 remains unchanged",
      "zh-CN": "将 h1-h6 标题整体升一级，h1 保持不变",
      "zh-TW": "將 h1-h6 標題整體升一級，h1 保持不變",
    }),
  },
  {
    id: "remove-extra-line-breaks",
    label: runtimeT({
      "en-US": "Remove Extra Line Breaks",
      "zh-CN": "删除多余换行",
      "zh-TW": "刪除多餘換行",
    }),
    description: runtimeT({
      "en-US": "Clean empty paragraphs, extra br tags, and broken list lines",
      "zh-CN": "清理空段落、多余 br 和常见列表断行",
      "zh-TW": "清理空段落、多餘 br 和常見列表斷行",
    }),
  },
];

export async function formatSelectedNote(
  actionType: NoteFormatActionType,
): Promise<NoteFormatResult> {
  const note = getSingleSelectedNote();
  const action = getNoteFormatAction(actionType);
  const originalNoteHtml = note.getNote() || "";

  ztoolkit.log(`${LOG_PREFIX} 开始执行操作: ${action.label}`, {
    noteID: note.id,
  });

  if (isNoteHtmlEmpty(originalNoteHtml)) {
    const message = getString("note-format-empty-note");
    showResultNotification(message, "warning");
    return {
      html: originalNoteHtml,
      changed: false,
      stats: {},
      warnings: [],
      message,
    };
  }

  const result = applyNoteFormatAction(originalNoteHtml, actionType);

  if (!result.changed) {
    showResultNotification(result.message, "warning");
    ztoolkit.log(`${LOG_PREFIX} 未发生改动: ${action.label}`, {
      noteID: note.id,
      stats: result.stats,
      warnings: result.warnings,
    });
    return result;
  }

  try {
    note.setNote(result.html);
    await note.saveTx();
    showResultNotification(result.message, "success");
    ztoolkit.log(`${LOG_PREFIX} 操作完成: ${action.label}`, {
      noteID: note.id,
      stats: result.stats,
      warnings: result.warnings,
    });
    return result;
  } catch (error) {
    ztoolkit.log(`${LOG_PREFIX} 写回笔记失败，准备回滚`, error);
    try {
      note.setNote(originalNoteHtml);
      await note.saveTx();
      ztoolkit.log(`${LOG_PREFIX} 回滚成功`, { noteID: note.id });
    } catch (rollbackError) {
      ztoolkit.log(`${LOG_PREFIX} 回滚失败`, rollbackError);
    }
    showResultNotification(getString("note-format-error"), "error");
    throw error;
  }
}

export function applyNoteFormatAction(
  noteHtml: string,
  actionType: NoteFormatActionType,
): NoteFormatResult {
  switch (actionType) {
    case "fix-math":
      return fixMathInNoteHtml(noteHtml);
    case "downgrade-headings":
      return downgradeHeadings(noteHtml);
    case "upgrade-headings":
      return upgradeHeadings(noteHtml);
    case "remove-extra-line-breaks":
      return removeExtraLineBreaks(noteHtml);
    default: {
      const exhaustiveCheck: never = actionType;
      throw new Error(
        `${getString("note-format-unknown-action", { args: { action: String(exhaustiveCheck) } })}`,
      );
    }
  }
}

export function fixMathInNoteHtml(noteHtml: string): NoteFormatResult {
  const doc = parseHtmlDocument(noteHtml);
  const body = getDocumentBody(doc);
  const warnings: string[] = [];
  const stats: MathFixStats = {
    inlineFixed: 0,
    blockFixed: 0,
    riskySkipped: 0,
    unsupportedWarnings: 0,
  };

  fixMathFenceCodeBlocks(body, stats);
  fixStandaloneBlockFormulas(body, stats, warnings);
  fixInlineMathInTextNodes(body, stats);

  const html = serializeDocumentBody(doc);
  const changed = html !== noteHtml;
  const totalFixed = stats.inlineFixed + stats.blockFixed;
  const summaryParts: string[] = [];

  if (totalFixed > 0) {
    summaryParts.push(
      getString("note-format-result-fix-math", {
        args: { inline: String(stats.inlineFixed), block: String(stats.blockFixed) },
      }),
    );
  }
  if (stats.riskySkipped > 0) {
    summaryParts.push(
      getString("note-format-result-fix-math-risky", {
        args: { count: String(stats.riskySkipped) },
      }),
    );
  }
  if (stats.unsupportedWarnings > 0) {
    summaryParts.push(
      getString("note-format-result-fix-math-unsupported", {
        args: { count: String(stats.unsupportedWarnings) },
      }),
    );
  }

  return {
    html,
    changed,
    stats: { ...stats },
    warnings,
    message: changed || totalFixed > 0
      ? summaryParts.join("，")
      : getString("note-format-no-fixable-formula"),
  };
}

export function downgradeHeadings(noteHtml: string): NoteFormatResult {
  return transformHeadings(noteHtml, "down");
}

export function upgradeHeadings(noteHtml: string): NoteFormatResult {
  return transformHeadings(noteHtml, "up");
}

export function removeExtraLineBreaks(noteHtml: string): NoteFormatResult {
  const doc = parseHtmlDocument(noteHtml);
  const body = getDocumentBody(doc);
  const stats: SplitExtraLineBreakStats = {
    removedEmptyBlocks: 0,
    mergedParagraphs: 0,
    removedBreaks: 0,
  };

  removeEmptyBlocks(body, stats);
  collapseRedundantBreaks(body, stats);
  mergeBrokenListParagraphs(body, stats);
  removeEmptyBlocks(body, stats);

  const html = serializeDocumentBody(doc);
  const changed = html !== noteHtml;

  return {
    html,
    changed,
    stats: { ...stats },
    warnings: [],
    message: changed
      ? getString("note-format-result-remove-line-breaks", {
          args: {
            count: String(stats.removedEmptyBlocks),
            merged: String(stats.mergedParagraphs),
            breaks: String(stats.removedBreaks),
          },
        })
      : getString("note-format-no-cleanable-breaks"),
  };
}

function transformHeadings(
  noteHtml: string,
  direction: "up" | "down",
): NoteFormatResult {
  const doc = parseHtmlDocument(noteHtml);
  const body = getDocumentBody(doc);
  const headingElements = Array.from(
    body.querySelectorAll("h1, h2, h3, h4, h5, h6"),
  ) as HTMLElement[];
  const stats: HeadingStats = {
    headingCount: headingElements.length,
    changedHeadings: 0,
  };

  if (headingElements.length === 0) {
    return {
      html: noteHtml,
      changed: false,
      stats: { ...stats },
      warnings: [],
      message: getString("note-format-no-headings"),
    };
  }

  for (const heading of headingElements) {
    const currentLevel = parseInt(heading.tagName.slice(1), 10);
    const nextLevel =
      direction === "down"
        ? Math.min(currentLevel + 1, 6)
        : Math.max(currentLevel - 1, 1);

    if (currentLevel === nextLevel) {
      continue;
    }

    const replacement = doc.createElement(`h${nextLevel}`);
    for (const attr of Array.from(heading.attributes) as Attr[]) {
      replacement.setAttribute(attr.name, attr.value);
    }
    while (heading.firstChild) {
      replacement.appendChild(heading.firstChild);
    }
    heading.replaceWith(replacement);
    stats.changedHeadings++;
  }

  const html = serializeDocumentBody(doc);
  return {
    html,
    changed: html !== noteHtml,
    stats: { ...stats },
    warnings: [],
    message:
      direction === "down"
        ? getString("note-format-result-downgrade-headings", {
            args: { count: String(stats.changedHeadings) },
          })
        : getString("note-format-result-upgrade-headings", {
            args: { count: String(stats.changedHeadings) },
          }),
  };
}

function fixStandaloneBlockFormulas(
  root: HTMLElement,
  stats: MathFixStats,
  warnings: string[],
) {
  const blockContainers = Array.from(
    root.querySelectorAll(BLOCK_FORMULA_CONTAINER_SELECTOR),
  ) as HTMLElement[];

  for (const element of blockContainers) {
    if (shouldSkipMathProcessing(element) || element.querySelector(".math")) {
      continue;
    }

    const text = getElementTextWithLineBreaks(element).trim();
    if (!text) {
      continue;
    }

    const candidate = parseStandaloneBlockFormula(text);
    if (!candidate) {
      continue;
    }

    if (candidate.risky) {
      stats.riskySkipped++;
      continue;
    }

    if (candidate.text.startsWith("__UNSUPPORTED_ENV__")) {
      const envName = candidate.text.replace("__UNSUPPORTED_ENV__", "");
      const warning = `检测到未支持的公式环境: ${envName}，已保留原文`;
      warnings.push(warning);
      stats.unsupportedWarnings++;
      ztoolkit.log(`${LOG_PREFIX} ${warning}`);
      continue;
    }

    const replacement = getOwnerDocument(root).createElement("pre");
    replacement.className = "math";
    replacement.textContent = `$$${normalizeFormulaBody(candidate.text)}$$`;
    element.replaceWith(replacement);
    stats.blockFixed++;
  }
}

function fixInlineMathInTextNodes(root: HTMLElement, stats: MathFixStats) {
  const doc = getOwnerDocument(root);
  const walker = doc.createTreeWalker(root, SHOW_TEXT);
  const textNodes: Text[] = [];
  let currentNode = walker.nextNode();

  while (currentNode) {
    const textNode = currentNode as Text;
    if (!shouldSkipTextNode(textNode) && textNode.nodeValue) {
      textNodes.push(textNode);
    }
    currentNode = walker.nextNode();
  }

  for (const textNode of textNodes) {
    const text = textNode.nodeValue || "";
    const segments = splitTextByInlineMath(text, stats);
    if (!segments.some((segment) => segment.type === "inline-math")) {
      continue;
    }

    const fragment = doc.createDocumentFragment();
    for (const segment of segments) {
      if (!segment.content) {
        continue;
      }
      if (segment.type === "text") {
        fragment.appendChild(doc.createTextNode(segment.content));
        continue;
      }
      const span = doc.createElement("span");
      span.className = "math";
      span.textContent = `$${normalizeInlineFormulaBody(segment.content)}$`;
      fragment.appendChild(span);
      stats.inlineFixed++;
    }

    textNode.replaceWith(fragment);
  }
}

function fixMathFenceCodeBlocks(root: HTMLElement, stats: MathFixStats) {
  const codeBlocks = Array.from(
    root.querySelectorAll("pre > code"),
  ) as HTMLElement[];

  for (const codeBlock of codeBlocks) {
    const preElement = codeBlock.parentElement;
    if (!preElement || preElement.classList.contains("math")) {
      continue;
    }

    const codeText = normalizeText(codeBlock.textContent || "");
    const formula = extractMathFenceContent(codeText);
    if (!formula) {
      continue;
    }

    const replacement = getOwnerDocument(root).createElement("pre");
    replacement.className = "math";
    replacement.textContent = `$$${normalizeFormulaBody(formula)}$$`;
    preElement.replaceWith(replacement);
    stats.blockFixed++;
  }
}

function splitTextByInlineMath(
  text: string,
  stats: MathFixStats,
): TextSegment[] {
  const segments: TextSegment[] = [];
  let cursor = 0;

  while (cursor < text.length) {
    const inlineParenStart = text.indexOf("\\(", cursor);
    const inlineDoubleDollarStart = findNextInlineDoubleDollarStart(
      text,
      cursor,
    );
    const inlineDollarStart = findNextInlineDollarStart(text, cursor);
    const candidates = [
      inlineParenStart,
      inlineDoubleDollarStart,
      inlineDollarStart,
    ].filter((index) => index >= 0);

    if (!candidates.length) {
      segments.push({ type: "text", content: text.slice(cursor) });
      break;
    }

    const start = Math.min(...candidates);
    if (start > cursor) {
      segments.push({ type: "text", content: text.slice(cursor, start) });
    }

    if (start === inlineParenStart) {
      const end = findClosingInlineParenthesis(text, start + 2);
      if (end < 0) {
        segments.push({ type: "text", content: text.slice(start) });
        break;
      }

      const formulaBody = normalizeInlineFormulaBody(
        text.slice(start + 2, end),
      );
      if (!formulaBody) {
        segments.push({ type: "text", content: text.slice(start, end + 2) });
      } else {
        segments.push({ type: "inline-math", content: formulaBody });
      }
      cursor = end + 2;
      continue;
    }

    if (start === inlineDoubleDollarStart) {
      const end = findClosingInlineDoubleDollar(text, start + 2);
      if (end < 0) {
        segments.push({ type: "text", content: text.slice(start) });
        break;
      }

      const candidate = text.slice(start + 2, end);
      if (!isSafeInlineDoubleDollarFormula(candidate)) {
        stats.riskySkipped++;
        segments.push({ type: "text", content: text.slice(start, end + 2) });
        cursor = end + 2;
        continue;
      }

      segments.push({
        type: "inline-math",
        content: normalizeInlineFormulaBody(candidate),
      });
      cursor = end + 2;
      continue;
    }

    const end = findClosingInlineDollar(text, start + 1);
    if (end < 0) {
      segments.push({ type: "text", content: text.slice(start) });
      break;
    }

    const candidate = text.slice(start + 1, end);
    if (!isSafeInlineDollarFormula(candidate, text, start, end)) {
      stats.riskySkipped++;
      segments.push({ type: "text", content: text.slice(start, end + 1) });
      cursor = end + 1;
      continue;
    }

    segments.push({
      type: "inline-math",
      content: normalizeInlineFormulaBody(candidate),
    });
    cursor = end + 1;
  }

  return mergeAdjacentTextSegments(segments);
}

function removeEmptyBlocks(root: HTMLElement, stats: SplitExtraLineBreakStats) {
  const blocks = Array.from(root.querySelectorAll("p, div")) as HTMLElement[];
  for (const block of blocks) {
    if (shouldSkipCleanupNode(block)) {
      continue;
    }
    if (!block.parentElement) {
      continue;
    }
    if (isEmptyBlock(block)) {
      block.remove();
      stats.removedEmptyBlocks++;
    }
  }
}

function collapseRedundantBreaks(
  root: HTMLElement,
  stats: SplitExtraLineBreakStats,
) {
  const elements = Array.from(root.querySelectorAll("*")) as HTMLElement[];
  for (const element of elements) {
    if (shouldSkipCleanupNode(element)) {
      continue;
    }

    let previousWasBreak = false;
    const childNodes = Array.from(element.childNodes);
    for (const child of childNodes) {
      if (!child) {
        continue;
      }
      if (child.nodeType === TEXT_NODE) {
        if ((child.nodeValue || "").trim()) {
          previousWasBreak = false;
        }
        continue;
      }

      if (!isHtmlElement(child)) {
        previousWasBreak = false;
        continue;
      }

      if (child.tagName === "BR") {
        if (previousWasBreak) {
          child.remove();
          stats.removedBreaks++;
          continue;
        }
        previousWasBreak = true;
        continue;
      }

      if (!isElementWhitespaceOnly(child)) {
        previousWasBreak = false;
      }
    }
  }
}

function mergeBrokenListParagraphs(
  root: HTMLElement,
  stats: SplitExtraLineBreakStats,
) {
  const candidates = Array.from(
    root.querySelectorAll("p, div"),
  ) as HTMLElement[];
  for (const current of candidates) {
    if (
      !current.parentElement ||
      shouldSkipCleanupNode(current) ||
      !isListMarkerOnlyBlock(current)
    ) {
      continue;
    }

    const next = current.nextElementSibling;
    if (
      !next ||
      !isHtmlElement(next) ||
      next.parentElement !== current.parentElement ||
      shouldSkipCleanupNode(next) ||
      !isMergeableFollowingBlock(next)
    ) {
      continue;
    }

    const marker = normalizeText(current.textContent || "");
    const shouldKeepMarker = !current.closest("li");
    while (current.firstChild) {
      current.removeChild(current.firstChild);
    }
    if (shouldKeepMarker) {
      current.appendChild(getOwnerDocument(root).createTextNode(`${marker} `));
    }
    while (next.firstChild) {
      current.appendChild(next.firstChild);
    }
    next.remove();
    stats.mergedParagraphs++;
  }
}

function parseStandaloneBlockFormula(text: string): FormulaCandidate | null {
  const normalized = normalizeText(text);
  const mathFence = extractMathFenceContent(normalized);
  if (mathFence) {
    return {
      kind: "block",
      text: normalizeFormulaBody(mathFence),
    };
  }

  const blockDollarMatch = normalized.match(/^\$\$([\s\S]*?)\$\$$/);
  if (blockDollarMatch) {
    return {
      kind: "block",
      text: normalizeFormulaBody(blockDollarMatch[1]),
    };
  }

  const blockBracketMatch = normalized.match(/^\\\[([\s\S]*?)\\\]$/);
  if (blockBracketMatch) {
    return {
      kind: "block",
      text: normalizeFormulaBody(blockBracketMatch[1]),
    };
  }

  const envMatch = normalized.match(
    /^\\begin\{([a-zA-Z*]+)\}([\s\S]*?)\\end\{\1\}$/,
  );
  if (envMatch) {
    const envName = envMatch[1];
    const formulaBody = normalizeFormulaBody(envMatch[2]);
    if (SUPPORTED_BLOCK_ENVS.has(envName)) {
      return {
        kind: "block",
        text: formulaBody,
      };
    }
    return {
      kind: "block",
      text: `__UNSUPPORTED_ENV__${envName}`,
    };
  }

  return null;
}

function extractMathFenceContent(text: string): string | null {
  const normalized = text.replace(/\r\n?/g, "\n").trim();
  const match = normalized.match(/^```math\s*\n([\s\S]*?)\n```$/i);
  if (!match) {
    return null;
  }
  return match[1];
}

function findNextInlineDoubleDollarStart(
  text: string,
  fromIndex: number,
): number {
  for (let index = fromIndex; index < text.length - 1; index++) {
    if (text[index] !== "$" || text[index + 1] !== "$") {
      continue;
    }
    if (text[index - 1] === "\\") {
      continue;
    }
    return index;
  }
  return -1;
}

function findNextInlineDollarStart(text: string, fromIndex: number): number {
  for (let index = fromIndex; index < text.length; index++) {
    if (text[index] !== "$") {
      continue;
    }
    if (text[index - 1] === "\\") {
      continue;
    }
    if (text[index + 1] === "$") {
      index++;
      continue;
    }
    return index;
  }
  return -1;
}

function findClosingInlineDoubleDollar(
  text: string,
  fromIndex: number,
): number {
  for (let index = fromIndex; index < text.length - 1; index++) {
    if (text[index] !== "$" || text[index + 1] !== "$") {
      continue;
    }
    if (text[index - 1] === "\\") {
      continue;
    }
    return index;
  }
  return -1;
}

function findClosingInlineDollar(text: string, fromIndex: number): number {
  for (let index = fromIndex; index < text.length; index++) {
    if (text[index] !== "$") {
      continue;
    }
    if (text[index - 1] === "\\") {
      continue;
    }
    if (text[index + 1] === "$") {
      continue;
    }
    return index;
  }
  return -1;
}

function findClosingInlineParenthesis(text: string, fromIndex: number): number {
  for (let index = fromIndex; index < text.length - 1; index++) {
    if (text[index] === "\\" && text[index + 1] === ")") {
      return index;
    }
  }
  return -1;
}

function isSafeInlineDollarFormula(
  candidate: string,
  fullText: string,
  startIndex: number,
  endIndex: number,
): boolean {
  const trimmed = normalizeInlineFormulaBody(candidate);
  if (!trimmed || trimmed.includes("\n")) {
    return false;
  }

  if (/^[\d\s.,%+-]+$/.test(trimmed)) {
    return false;
  }

  const previousChar = fullText[startIndex - 1] || "";
  const nextChar = fullText[endIndex + 1] || "";
  if (/\w/.test(previousChar) && /\w/.test(trimmed[0] || "")) {
    return false;
  }
  if (/\w/.test(nextChar) && /\w/.test(trimmed[trimmed.length - 1] || "")) {
    return false;
  }

  return looksLikeMathFormula(trimmed);
}

function isSafeInlineDoubleDollarFormula(candidate: string): boolean {
  const trimmed = normalizeInlineFormulaBody(candidate);
  if (!trimmed || trimmed.includes("\n")) {
    return false;
  }
  return looksLikeMathFormula(trimmed);
}

function looksLikeMathFormula(content: string): boolean {
  if (!content) {
    return false;
  }

  if (/\\[a-zA-Z]+/.test(content)) {
    return true;
  }

  if (/[=^_{}]/.test(content)) {
    return true;
  }

  if (/[A-Za-z]\s*[+\-*/=<>]\s*[A-Za-z0-9]/.test(content)) {
    return true;
  }

  if (/^[A-Za-z]$/.test(content)) {
    return true;
  }

  if (/^[A-Za-z][A-Za-z0-9]*\([^)]*\)$/.test(content)) {
    return true;
  }

  return false;
}

function mergeAdjacentTextSegments(segments: TextSegment[]): TextSegment[] {
  const merged: TextSegment[] = [];
  for (const segment of segments) {
    const previous = merged[merged.length - 1];
    if (previous && previous.type === "text" && segment.type === "text") {
      previous.content += segment.content;
    } else {
      merged.push({ ...segment });
    }
  }
  return merged;
}

function getSingleSelectedNote(): Zotero.Item {
  const selectedItems = Zotero.getActiveZoteroPane().getSelectedItems();
  if (selectedItems.length !== 1 || !selectedItems[0].isNote()) {
    throw new Error(getString("note-format-please-select-note"));
  }
  return selectedItems[0];
}

function getNoteFormatAction(
  actionType: NoteFormatActionType,
): NoteFormatActionDefinition {
  const action = NOTE_FORMAT_ACTIONS.find((item) => item.id === actionType);
  if (!action) {
    throw new Error(
      getString("note-format-unknown-action", { args: { action: actionType } }),
    );
  }
  return action;
}

function parseHtmlDocument(noteHtml: string): Document {
  return new DOMParser().parseFromString(noteHtml, "text/html");
}

function serializeDocumentBody(doc: Document): string {
  return String(getDocumentBody(doc).innerHTML);
}

function getElementTextWithLineBreaks(element: Element): string {
  const parts: string[] = [];
  for (const node of Array.from(element.childNodes)) {
    if (!node) {
      continue;
    }
    if (node.nodeType === TEXT_NODE) {
      parts.push(node.nodeValue || "");
      continue;
    }
    if (!isHtmlElement(node)) {
      continue;
    }
    if (node.tagName === "BR") {
      parts.push("\n");
      continue;
    }
    parts.push(getElementTextWithLineBreaks(node));
  }
  return parts.join("");
}

function shouldSkipMathProcessing(element: Element): boolean {
  return !!element.closest(SKIP_MATH_SELECTOR);
}

function shouldSkipTextNode(node: Text): boolean {
  const parentElement = node.parentElement;
  if (!parentElement) {
    return true;
  }
  return shouldSkipMathProcessing(parentElement);
}

function shouldSkipCleanupNode(node: Element): boolean {
  return !!node.closest(SKIP_CLEANUP_SELECTOR);
}

function normalizeFormulaBody(content: string): string {
  const lineBreakNormalized = content.replace(/\r\n?/g, "\n");
  const withoutEdgeBlankLines = lineBreakNormalized
    .replace(/^\s*\n+/g, "")
    .replace(/\n+\s*$/g, "");
  return withoutEdgeBlankLines.trim();
}

function normalizeInlineFormulaBody(content: string): string {
  return content.replace(/\r\n?/g, "\n").trim();
}

function normalizeText(text: string): string {
  return text
    .replace(/\u00a0/g, " ")
    .replace(/\r\n?/g, "\n")
    .trim();
}

function isEmptyBlock(element: HTMLElement): boolean {
  if (element.querySelector("img, table, pre, .math")) {
    return false;
  }

  const cloned = element.cloneNode(true) as HTMLElement;
  cloned.querySelectorAll("br").forEach((br: Element) => br.remove());
  const text = normalizeText(cloned.textContent || "");
  return !text;
}

function isElementWhitespaceOnly(element: HTMLElement): boolean {
  if (element.tagName === "BR") {
    return true;
  }
  return !normalizeText(element.textContent || "");
}

function isListMarkerOnlyBlock(element: HTMLElement): boolean {
  if (element.children.length > 0) {
    const nonBrChildren = Array.from(element.children).filter(
      (child) => child.tagName !== "BR",
    );
    if (nonBrChildren.length > 0) {
      return false;
    }
  }

  return /^(\d+\.|[-*•])$/.test(normalizeText(element.textContent || ""));
}

function isMergeableFollowingBlock(element: HTMLElement): boolean {
  if (element.tagName !== "P" && element.tagName !== "DIV") {
    return false;
  }
  if (isEmptyBlock(element) || isListMarkerOnlyBlock(element)) {
    return false;
  }
  if (element.querySelector(SKIP_CLEANUP_SELECTOR)) {
    return false;
  }
  return true;
}

function isHtmlElement(
  node: Node | Element | null | undefined,
): node is HTMLElement {
  return !!node && node.nodeType === ELEMENT_NODE;
}

function getDocumentBody(doc: Document): HTMLElement {
  if (!doc.body) {
    throw new Error("Failed to parse note HTML content");
  }
  return doc.body as HTMLElement;
}

function getOwnerDocument(node: Node): Document {
  if (!node.ownerDocument) {
    throw new Error("Current node has no ownerDocument");
  }
  return node.ownerDocument;
}

function isNoteHtmlEmpty(noteHtml: string): boolean {
  const doc = parseHtmlDocument(noteHtml);
  return !normalizeText(getDocumentBody(doc).textContent || "");
}

function showResultNotification(
  text: string,
  type: "success" | "warning" | "error",
) {
  new ztoolkit.ProgressWindow("AiNote", {
    closeOnClick: true,
    closeTime: 4000,
  })
    .createLine({
      text,
      type: type === "warning" ? "default" : type,
    })
    .show();
}
