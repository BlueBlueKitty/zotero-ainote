export interface MathNormalizeStats {
  inlineFixed: number;
  blockFixed: number;
  riskySkipped: number;
  unsupportedWarnings: number;
}

export interface MathNormalizeResult {
  warnings: string[];
  stats: MathNormalizeStats;
}

interface FormulaCandidate {
  text: string;
}

type MathDelimiter = "$" | "$$" | "\\(" | "\\[" | "env";

interface MathCandidate {
  kind: "inline" | "display";
  delimiter: MathDelimiter;
  raw: string;
  content: string;
  start: number;
  end: number;
  before: string;
  after: string;
}

interface TextSegment {
  type: "text" | "inline-math";
  content: string;
}

const SUPPORTED_BLOCK_ENVS = new Set([
  "equation",
  "align",
  "aligned",
  "gather",
  "matrix",
  "multline",
  "cases",
]);
const BLOCK_FORMULA_CONTAINER_SELECTOR =
  "p, div, li, td, th, blockquote, h1, h2, h3, h4, h5, h6";
const SKIP_MATH_SELECTOR =
  "pre, code, a, input, .math, .math-inline, .math-display, .katex, script, style, textarea";
const TEXT_NODE = 3;
const SHOW_TEXT = 0x4;

export function normalizeMathInMarkdown(markdown: string): string {
  let normalized = markdown.replace(/\r\n?/g, "\n");

  normalized = unwrapBacktickWrappedPureFormulas(normalized);
  normalized = normalizeTextMathFences(normalized);
  normalized = normalizeBlockFormulaTexts(normalized);

  return normalized;
}

export function normalizeMathInHtmlDom(root: HTMLElement): MathNormalizeResult {
  const warnings: string[] = [];
  const stats: MathNormalizeStats = {
    inlineFixed: 0,
    blockFixed: 0,
    riskySkipped: 0,
    unsupportedWarnings: 0,
  };

  unwrapInlineCodeWrappedPureFormulas(root);
  fixFragmentedBlockFormulas(root, stats);
  fixMathFenceCodeBlocks(root, stats);
  fixPlainPreFormulaBlocks(root, stats);
  fixStandaloneBlockFormulas(root, stats, warnings);
  fixInlineMathInTextNodes(root, stats);

  return { warnings, stats };
}

function fixFragmentedBlockFormulas(root: HTMLElement, stats: MathNormalizeStats) {
  const containers = Array.from(
    root.querySelectorAll(BLOCK_FORMULA_CONTAINER_SELECTOR),
  ) as HTMLElement[];
  let index = 0;

  while (index < containers.length) {
    const startElement = containers[index];
    if (
      !startElement.isConnected ||
      shouldSkipMathProcessing(startElement) ||
      startElement.querySelector(".math")
    ) {
      index++;
      continue;
    }

    const startText = getElementTextWithLineBreaks(startElement);
    const startTokenIndex = startText.indexOf("$$");
    if (startTokenIndex < 0) {
      index++;
      continue;
    }
    if (normalizeText(startText.slice(0, startTokenIndex))) {
      index++;
      continue;
    }

    let buffer = startText.slice(startTokenIndex + 2);
    let endElement = startElement;
    let cursor = index;
    let closed = false;
    let suffixAfterClose = "";

    while (!closed) {
      const closeTokenIndex = buffer.indexOf("$$");
      if (closeTokenIndex >= 0) {
        suffixAfterClose = normalizeText(buffer.slice(closeTokenIndex + 2));
        buffer = buffer.slice(0, closeTokenIndex);
        closed = true;
        break;
      }

      cursor++;
      if (cursor >= containers.length) {
        break;
      }
      const nextElement = containers[cursor];
      if (
        !nextElement.isConnected ||
        shouldSkipMathProcessing(nextElement) ||
        nextElement.querySelector(".math")
      ) {
        break;
      }
      endElement = nextElement;
      buffer += `\n${getElementTextWithLineBreaks(nextElement)}`;
    }

    if (!closed) {
      index++;
      continue;
    }
    if (suffixAfterClose) {
      index++;
      continue;
    }

    const normalizedBody = normalizeFormulaBody(buffer);
    if (!normalizedBody) {
      index = cursor + 1;
      continue;
    }

    const replacement = getOwnerDocument(root).createElement("pre");
    replacement.className = "math";
    replacement.textContent = `$$${normalizedBody}$$`;
    replaceNodeRange(startElement, endElement, replacement);
    stats.blockFixed++;
    index = cursor + 1;
  }
}

function unwrapBacktickWrappedPureFormulas(markdown: string): string {
  return markdown.replace(/(^|[^\w\\])`([^`\n]+)`(?=[^\w]|$)/g, (match, prefix: string, content: string) => {
    const trimmed = normalizeText(content);
    if (!isPureFormulaText(trimmed)) {
      return match;
    }
    return `${prefix}${trimmed}`;
  });
}

function unwrapInlineCodeWrappedPureFormulas(root: HTMLElement) {
  const inlineCodes = Array.from(root.querySelectorAll("code")) as HTMLElement[];
  for (const codeElement of inlineCodes) {
    if (codeElement.closest("pre")) {
      continue;
    }
    const raw = normalizeText(codeElement.textContent || "");
    if (!raw || !isPureFormulaText(raw)) {
      continue;
    }
    codeElement.replaceWith(getOwnerDocument(root).createTextNode(raw));
  }
}

function fixPlainPreFormulaBlocks(root: HTMLElement, stats: MathNormalizeStats) {
  const preBlocks = Array.from(root.querySelectorAll("pre")) as HTMLElement[];
  for (const preElement of preBlocks) {
    if (
      preElement.classList.contains("math") ||
      preElement.querySelector("code")
    ) {
      continue;
    }

    const text = normalizeText(preElement.textContent || "");
    if (!text) {
      continue;
    }

    const candidate = parseStandaloneBlockFormula(text);
    if (!candidate || candidate.text.startsWith("__UNSUPPORTED_ENV__")) {
      continue;
    }

    const replacement = getOwnerDocument(root).createElement("pre");
    replacement.className = "math";
    replacement.textContent = `$$${normalizeFormulaBody(candidate.text)}$$`;
    preElement.replaceWith(replacement);
    stats.blockFixed++;
  }
}

function normalizeTextMathFences(markdown: string): string {
  return markdown.replace(
    /^```text\s*\n([\s\S]*?)\n```$/gim,
    (match, content: string) => {
      const normalizedContent = normalizeText(content);
      const candidate = parseStandaloneBlockFormula(normalizedContent);
      if (!candidate) {
        if (containsBlockFormula(content)) {
          return normalizeMixedTextFenceContent(content);
        }
        return match;
      }
      return `\`\`\`math\n${candidate.text}\n\`\`\``;
    },
  );
}

function normalizeMixedTextFenceContent(content: string): string {
  return content.replace(/\r\n?/g, "\n").trim();
}

function containsBlockFormula(text: string): boolean {
  if (/\$\$[\s\S]*?\$\$/.test(text)) {
    return true;
  }
  if (/\\\[[\s\S]*?\\\]/.test(text)) {
    return true;
  }
  return /\\begin\{([a-zA-Z*]+)\}[\s\S]*?\\end\{\1\}/.test(text);
}

function isPureFormulaText(text: string): boolean {
  if (!text) {
    return false;
  }
  if (/^\$\$[\s\S]*\$\$$/.test(text)) {
    return true;
  }
  if (/^\\\[[\s\S]*\\\]$/.test(text)) {
    return true;
  }
  if (/^\\\([\s\S]*\\\)$/.test(text)) {
    return true;
  }
  if (/^\$[^\$\n]+?\$$/.test(text)) {
    return true;
  }
  return /^\\begin\{([a-zA-Z*]+)\}[\s\S]*\\end\{\1\}$/.test(text);
}

function normalizeBlockFormulaTexts(markdown: string): string {
  return markdown
    .replace(/\\\[([\s\S]*?)\\\]/g, (_match, formula: string) => {
      return `\\[${normalizeFormulaBody(formula)}\\]`;
    })
    .replace(/\$\$([\s\S]*?)\$\$/g, (_match, formula: string) => {
      return `$$${normalizeFormulaBody(formula)}$$`;
    });
}

function fixStandaloneBlockFormulas(
  root: HTMLElement,
  stats: MathNormalizeStats,
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

    if (candidate.text.startsWith("__UNSUPPORTED_ENV__")) {
      const envName = candidate.text.replace("__UNSUPPORTED_ENV__", "");
      warnings.push(`检测到未支持的公式环境: ${envName}，已保留原文`);
      stats.unsupportedWarnings++;
      continue;
    }

    const replacement = getOwnerDocument(root).createElement("pre");
    replacement.className = "math";
    replacement.textContent = `$$${normalizeFormulaBody(candidate.text)}$$`;
    element.replaceWith(replacement);
    stats.blockFixed++;
  }
}

function fixInlineMathInTextNodes(root: HTMLElement, stats: MathNormalizeStats) {
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

function fixMathFenceCodeBlocks(root: HTMLElement, stats: MathNormalizeStats) {
  const codeBlocks = Array.from(root.querySelectorAll("pre > code")) as HTMLElement[];

  for (const codeBlock of codeBlocks) {
    const preElement = codeBlock.parentElement;
    if (!preElement || preElement.classList.contains("math")) {
      continue;
    }

    const codeText = normalizeText(codeBlock.textContent || "");
    const formulaFromFence = extractMathFenceContent(codeText);
    const formulaFromStandalone = parseStandaloneBlockFormula(codeText);
    const formulaFromMathLanguageBlock = isMathLanguageCodeBlock(codeBlock)
      ? normalizeFormulaBody(codeText)
      : null;
    const formula =
      formulaFromFence ||
      formulaFromStandalone?.text ||
      formulaFromMathLanguageBlock ||
      null;
    if (!formula || formula.startsWith("__UNSUPPORTED_ENV__")) {
      continue;
    }

    const replacement = getOwnerDocument(root).createElement("pre");
    replacement.className = "math";
    replacement.textContent = `$$${normalizeFormulaBody(formula)}$$`;
    preElement.replaceWith(replacement);
    stats.blockFixed++;
  }
}

function isMathLanguageCodeBlock(codeBlock: HTMLElement): boolean {
  const classNames = `${codeBlock.className || ""} ${
    codeBlock.getAttribute("data-language") || ""
  }`.trim();
  if (!classNames) {
    return false;
  }
  return /\b(?:language-|lang-)?math\b/i.test(classNames);
}

function splitTextByInlineMath(
  text: string,
  stats: MathNormalizeStats,
): TextSegment[] {
  const segments: TextSegment[] = [];
  let cursor = 0;

  while (cursor < text.length) {
    const inlineParenStart = text.indexOf("\\(", cursor);
    const inlineDoubleDollarStart = findNextInlineDoubleDollarStart(text, cursor);
    const inlineDollarStart = findNextInlineDollarStart(text, cursor);
    const candidates = [inlineParenStart, inlineDoubleDollarStart, inlineDollarStart].filter(
      (index) => index >= 0,
    );

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
      const candidate = createMathCandidate(text, {
        kind: "inline",
        delimiter: "\\(",
        start,
        contentStart: start + 2,
        contentEnd: end,
        end: end + 2,
      });
      if (!shouldConvertMath(candidate)) {
        stats.riskySkipped++;
        segments.push({ type: "text", content: text.slice(start, end + 2) });
      } else {
        segments.push({
          type: "inline-math",
          content: normalizeInlineFormulaBody(candidate.content),
        });
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

      const candidate = createMathCandidate(text, {
        kind: "inline",
        delimiter: "$$",
        start,
        contentStart: start + 2,
        contentEnd: end,
        end: end + 2,
      });
      if (!shouldConvertMath(candidate)) {
        stats.riskySkipped++;
        segments.push({ type: "text", content: text.slice(start, end + 2) });
        cursor = end + 2;
        continue;
      }

      segments.push({
        type: "inline-math",
        content: normalizeInlineFormulaBody(candidate.content),
      });
      cursor = end + 2;
      continue;
    }

    const end = findClosingInlineDollar(text, start + 1);
    if (end < 0) {
      segments.push({ type: "text", content: text.slice(start) });
      break;
    }

    const candidate = createMathCandidate(text, {
      kind: "inline",
      delimiter: "$",
      start,
      contentStart: start + 1,
      contentEnd: end,
      end: end + 1,
    });
    if (!shouldConvertMath(candidate)) {
      stats.riskySkipped++;
      segments.push({ type: "text", content: text.slice(start, start + 1) });
      cursor = start + 1;
      continue;
    }

    segments.push({
      type: "inline-math",
      content: normalizeInlineFormulaBody(candidate.content),
    });
    cursor = end + 1;
  }

  return mergeAdjacentTextSegments(segments);
}

function parseStandaloneBlockFormula(text: string): FormulaCandidate | null {
  const normalized = normalizeText(text);
  const mathFence = extractMathFenceContent(normalized);
  if (mathFence) {
    return { text: normalizeFormulaBody(mathFence) };
  }

  const blockDollarMatch = normalized.match(/^\$\$([\s\S]*?)\$\$$/);
  if (blockDollarMatch) {
    return { text: normalizeFormulaBody(blockDollarMatch[1]) };
  }

  const blockBracketMatch = normalized.match(/^\\\[([\s\S]*?)\\\]$/);
  if (blockBracketMatch) {
    return { text: normalizeFormulaBody(blockBracketMatch[1]) };
  }

  const envMatch = normalized.match(/^\\begin\{([a-zA-Z*]+)\}([\s\S]*?)\\end\{\1\}$/);
  if (envMatch) {
    const envName = envMatch[1];
    const formulaBody = normalizeFormulaBody(envMatch[2]);
    if (SUPPORTED_BLOCK_ENVS.has(envName)) {
      return { text: formulaBody };
    }
    return { text: `__UNSUPPORTED_ENV__${envName}` };
  }

  return null;
}

function extractMathFenceContent(text: string): string | null {
  const normalized = text.replace(/\r\n?/g, "\n").trim();
  const mathMatch = normalized.match(/^```math\s*\n([\s\S]*?)\n```$/i);
  if (mathMatch) {
    return mathMatch[1];
  }
  const textMatch = normalized.match(/^```text\s*\n([\s\S]*?)\n```$/i);
  if (!textMatch) {
    return null;
  }
  const mixedContent = textMatch[1];
  const candidate = parseStandaloneBlockFormula(mixedContent);
  if (candidate) {
    return candidate.text;
  }
  return extractFirstBlockFormula(mixedContent);
}

function extractFirstBlockFormula(text: string): string | null {
  const dollarMatch = text.match(/\$\$([\s\S]*?)\$\$/);
  if (dollarMatch) {
    return normalizeFormulaBody(dollarMatch[1]);
  }
  const bracketMatch = text.match(/\\\[([\s\S]*?)\\\]/);
  if (bracketMatch) {
    return normalizeFormulaBody(bracketMatch[1]);
  }
  const envMatch = text.match(/\\begin\{([a-zA-Z*]+)\}([\s\S]*?)\\end\{\1\}/);
  if (!envMatch) {
    return null;
  }
  const envName = envMatch[1];
  if (!SUPPORTED_BLOCK_ENVS.has(envName)) {
    return null;
  }
  return normalizeFormulaBody(envMatch[2]);
}

function stripFormulaSeparatorLines(content: string): string {
  return content
    .split("\n")
    .filter((line) => !/^\s*(={3,}|-{3,})\s*$/.test(line))
    .join("\n");
}

function normalizeFormulaBody(content: string): string {
  const lineBreakNormalized = content.replace(/\r\n?/g, "\n");
  const commandNormalized = normalizeDoubleEscapedLatexCommands(lineBreakNormalized);
  const withoutSeparators = stripFormulaSeparatorLines(commandNormalized);
  const withoutEdgeBlankLines = withoutSeparators
    .replace(/^\s*\n+/g, "")
    .replace(/\n+\s*$/g, "");
  return withoutEdgeBlankLines.trim();
}

function normalizeInlineFormulaBody(content: string): string {
  return normalizeDoubleEscapedLatexCommands(content.replace(/\r\n?/g, "\n")).trim();
}

function normalizeText(text: string): string {
  return text.replace(/\u00a0/g, " ").replace(/\r\n?/g, "\n").trim();
}

function normalizeDoubleEscapedLatexCommands(content: string): string {
  // Only collapse accidental double-escaping for LaTeX control sequences.
  // Keep semantic line-break markers (e.g. "\\") unchanged.
  return content.replace(/\\\\([A-Za-z]+)\b/g, "\\$1");
}

function containsDangerousHtml(content: string): boolean {
  return /<\/?(script|style|iframe|object|embed|link|meta)\b/i.test(content);
}

function createMathCandidate(
  text: string,
  params: {
    kind: "inline" | "display";
    delimiter: MathDelimiter;
    start: number;
    contentStart: number;
    contentEnd: number;
    end: number;
  },
): MathCandidate {
  return {
    kind: params.kind,
    delimiter: params.delimiter,
    raw: text.slice(params.start, params.end),
    content: text.slice(params.contentStart, params.contentEnd),
    start: params.start,
    end: params.end,
    before: text.slice(Math.max(0, params.start - 32), params.start),
    after: text.slice(params.end, Math.min(text.length, params.end + 32)),
  };
}

function shouldConvertMath(candidate: MathCandidate): boolean {
  const content = candidate.content.trim();
  if (!content) {
    return false;
  }
  if (containsDangerousHtml(content)) {
    return false;
  }

  if (
    candidate.delimiter === "$$" ||
    candidate.delimiter === "\\(" ||
    candidate.delimiter === "\\[" ||
    candidate.delimiter === "env"
  ) {
    return true;
  }

  if (candidate.delimiter === "$") {
    return shouldConvertSingleDollarMath(candidate);
  }

  return false;
}

function shouldConvertSingleDollarMath(candidate: MathCandidate): boolean {
  const content = candidate.content;
  if (!content.trim()) {
    return false;
  }
  if (content.includes("$")) {
    return false;
  }
  if (content.includes("\n")) {
    return false;
  }
  if (/^\s|\s$/.test(content)) {
    return false;
  }
  if (containsDangerousHtml(content)) {
    return false;
  }
  if (looksLikeCurrency(candidate)) {
    return false;
  }
  if (isPlainTextInline(content)) {
    return false;
  }

  const trimmed = normalizeInlineFormulaBody(content);
  const previousChar = candidate.before.slice(-1);
  const nextChar = candidate.after[0] || "";
  if (/\w/.test(previousChar) && /\w/.test(trimmed[0] || "")) {
    return false;
  }
  if (/\w/.test(nextChar) && /\w/.test(trimmed[trimmed.length - 1] || "")) {
    return false;
  }

  return looksLikeMathFormula(trimmed);
}

function isPlainTextInline(content: string): boolean {
  const normalized = normalizeInlineFormulaBody(content);
  if (/^[A-Za-z]+(\s+[A-Za-z]+)+$/.test(normalized)) {
    return true;
  }
  return /^(OK|Ok|ok|Note|NOTE|Yes|No|TODO|Done|Error|Warning|Success|Failed)$/i.test(
    normalized,
  );
}

function looksLikeCurrency(candidate: MathCandidate): boolean {
  const normalized = normalizeInlineFormulaBody(candidate.content);
  const before = candidate.before;
  const after = candidate.after;

  if (/^\d+(\.\d{1,2})?$/.test(normalized)) {
    return true;
  }
  if (/^\d{1,3}(,\d{3})+(\.\d{1,2})?$/.test(normalized)) {
    return true;
  }
  if (/^\d+(\.\d{1,2})?\s*[-–—]\s*\$?\s*\d+(\.\d{1,2})?$/.test(normalized)) {
    return true;
  }
  if (
    /(USD|US|HKD|AUD|CAD|SGD|RMB|CNY|JPY|EUR|GBP)\s*$/i.test(before) &&
    /^\d/.test(normalized)
  ) {
    return true;
  }
  if (/(US|HK|AU|CA|SG|CN|JP|EU|UK)$/i.test(before) && /^\d/.test(normalized)) {
    return true;
  }
  if (/^\d/.test(after)) {
    return true;
  }
  if (
    /\b(price|cost|fee|paid|pay|dollar|dollars|usd|amount|budget|charge)\s*$/i.test(
      before,
    ) &&
    /^\d/.test(normalized)
  ) {
    return true;
  }

  return false;
}

function isEscaped(text: string, index: number): boolean {
  let slashCount = 0;
  let cursor = index - 1;
  while (cursor >= 0 && text[cursor] === "\\") {
    slashCount++;
    cursor--;
  }
  return slashCount % 2 === 1;
}

function findNextUnescaped(text: string, token: string, from: number): number {
  let cursor = from;
  while (cursor < text.length) {
    const index = text.indexOf(token, cursor);
    if (index < 0) {
      return -1;
    }
    if (!isEscaped(text, index)) {
      return index;
    }
    cursor = index + token.length;
  }
  return -1;
}

function findNextInlineDoubleDollarStart(text: string, fromIndex: number): number {
  return findNextUnescaped(text, "$$", fromIndex);
}

function findNextInlineDollarStart(text: string, fromIndex: number): number {
  for (let index = fromIndex; index < text.length; index++) {
    if (text[index] !== "$") continue;
    if (isEscaped(text, index)) continue;
    if (text[index + 1] === "$") {
      index++;
      continue;
    }
    return index;
  }
  return -1;
}

function findClosingInlineDoubleDollar(text: string, fromIndex: number): number {
  return findNextUnescaped(text, "$$", fromIndex);
}

function findClosingInlineDollar(text: string, fromIndex: number): number {
  return findNextValidSingleDollarEnd(text, fromIndex);
}

function findNextValidSingleDollarEnd(text: string, fromIndex: number): number {
  for (let index = fromIndex; index < text.length; index++) {
    if (text[index] !== "$") continue;
    if (isEscaped(text, index)) continue;
    if (text[index + 1] === "$") continue;
    const previousChar = text[index - 1] || "";
    const nextChar = text[index + 1] || "";
    if (/\s/.test(previousChar)) continue;
    if (/\d/.test(nextChar)) continue;
    return index;
  }
  return -1;
}

function findClosingInlineParenthesis(text: string, fromIndex: number): number {
  return findNextUnescaped(text, "\\)", fromIndex);
}

function looksLikeMathFormula(content: string): boolean {
  const normalized = normalizeInlineFormulaBody(content);
  if (!normalized) return false;
  if (/\\[a-zA-Z]+/.test(normalized)) return true;
  if (/[\^_{}]/.test(normalized)) return true;
  if (/[=<>≤≥≈≠∈∉∑∏√∞∂∇]/.test(normalized)) return true;
  if (/[+\-*/]/.test(normalized) && !/^[A-Za-z]+-[A-Za-z]+$/.test(normalized)) {
    return true;
  }
  if (/^[A-Za-z]$/.test(normalized)) return true;
  if (/^\d+(\.\d+)?[A-Za-z]+$/.test(normalized)) return true;
  if (/^[A-Za-z]+\d+$/.test(normalized)) return true;
  if (/^[A-Za-z_][A-Za-z0-9_]*\s*\(.+\)$/.test(normalized)) return true;
  if (
    /^\(?\s*[A-Za-z_][A-Za-z0-9_]*\s*,\s*[A-Za-z_][A-Za-z0-9_]*\s*\)?$/.test(
      normalized,
    )
  ) {
    return true;
  }
  if (/^[([{]\s*[A-Za-z0-9_\\+\-*/=<>.,\s]+\s*[)\]}]$/.test(normalized)) {
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

function getElementTextWithLineBreaks(element: Element): string {
  const parts: string[] = [];
  for (const node of Array.from(element.childNodes)) {
    if (!node) continue;
    if (node.nodeType === TEXT_NODE) {
      parts.push(node.nodeValue || "");
      continue;
    }
    if (!isHtmlElement(node)) continue;
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
  if (!parentElement) return true;
  return shouldSkipMathProcessing(parentElement);
}

function isHtmlElement(node: Node | Element | null | undefined): node is HTMLElement {
  return !!node && node.nodeType === 1;
}

function getOwnerDocument(node: Node): Document {
  if (!node.ownerDocument) {
    throw new Error("Current node has no ownerDocument");
  }
  return node.ownerDocument;
}

function replaceNodeRange(startNode: Node, endNode: Node, replacement: Node) {
  const parent = startNode.parentNode;
  if (!parent || parent !== endNode.parentNode) {
    if (parent) {
      parent.replaceChild(replacement, startNode);
    }
    return;
  }

  const insertionPoint = endNode.nextSibling;
  let current: Node | null = startNode;
  while (current) {
    const nextNode: Node | null = current.nextSibling;
    parent.removeChild(current);
    if (current === endNode) {
      break;
    }
    current = nextNode;
  }
  parent.insertBefore(replacement, insertionPoint);
}
