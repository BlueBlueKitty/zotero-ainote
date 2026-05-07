import {
  ActiveNoteEditorContext,
  confirmDeleteCurrentSection,
  readCurrentNoteHtml,
  showSectionActionResult,
  writeCurrentNoteHtml,
} from "./noteEditorAdapter";

export type NoteSectionActionType =
  | "section-upgrade-heading"
  | "section-downgrade-heading"
  | "section-increase-number"
  | "section-decrease-number"
  | "section-delete";

export interface HeadingSectionInfo {
  heading: HTMLElement;
  sectionNodes: HTMLElement[];
  headingLevel: number;
}

export interface HeadingNumberParseResult {
  matched: boolean;
  scheme: string;
  prefix: string;
  parts: number[];
  numberText: string;
  titleText: string;
  separator: string;
  rawLeadingText: string;
  propagateToDescendants: boolean;
}

export interface NoteSectionActionResult {
  html: string;
  changed: boolean;
  stats: { [key: string]: number };
  warnings: string[];
  message: string;
}

interface SectionActionOptions {
  skipDeleteConfirm?: boolean;
}

const LOG_PREFIX = "[AiNote][NoteSectionActions]";
const HTML_HEADING_SELECTOR = "h1, h2, h3, h4, h5, h6";
const MARKDOWN_BLOCK_SELECTOR =
  "p, div, li, blockquote, td, th";
const TEXT_NODE = 3;
const SHOW_TEXT = 0x4;
const ARABIC_NUMBER_PREFIX_REGEX =
  /^(\s*)([\(（\[]?)(\d+(?:\.\d+)*)(\\?\.)?([\)）\]]?)([\s\S]*)$/;
const CHINESE_NUMBER_PREFIX_REGEX =
  /^(\s*)([\(（\[]?)([零〇一二两三四五六七八九十百千]+)(\\?\.)?([\)）\]]?)([\s\S]*)$/;
const CHAPTER_PREFIX_REGEX =
  /^(\s*)第(\d+|[零〇一二两三四五六七八九十百千]+)(章|节|部分|篇|卷|回|单元|模块|篇章)([\s\S]*)$/;
const ENGLISH_PREFIX_REGEX =
  /^(\s*)(Chapter|Section|Part|Unit|Lesson|Module|Appendix)\s+(\d+)([\s\S]*)$/i;
const MARKDOWN_HEADING_REGEX = /^(\s*)(#{1,6})(\s+)([\s\S]*)$/;

export async function runNoteSectionAction(
  action: NoteSectionActionType,
  context: ActiveNoteEditorContext,
): Promise<NoteSectionActionResult> {
  const originalHtml = readCurrentNoteHtml(context.noteItem);
  if (isNoteHtmlEmpty(originalHtml)) {
    const message = "笔记内容为空，未执行修改";
    showSectionActionResult(message, "warning");
    return createUnchangedResult(originalHtml, message);
  }

  const editorHeading =
    getHeadingFromContextEvent(context.lastContextMenuEvent) ||
    getHeadingFromSelection(context.editorRoot);
  if (!editorHeading) {
    const message = "请先将光标放在一个标题中。";
    showSectionActionResult(message, "warning");
    return createUnchangedResult(originalHtml, message);
  }

  const parsedDocument = parseHtmlDocument(originalHtml);
  const body = getDocumentBody(parsedDocument);
  const noteRoot = getNoteContentRoot(body);
  const htmlHeading = resolveHeadingElementInHtml(
    noteRoot,
    context.editorRoot,
    editorHeading,
  );
  if (!htmlHeading || !isHeadingNode(htmlHeading)) {
    const message = "未能定位当前标题，请重试。";
    showSectionActionResult(message, "error");
    return createUnchangedResult(originalHtml, message);
  }

  const result = applySectionAction(noteRoot, htmlHeading, action, context);
  if (!result.changed) {
    showSectionActionResult(result.message, "warning");
    return result;
  }

  try {
    await writeCurrentNoteHtml(context.noteItem, result.html, originalHtml);
    const finalMessage = buildFinalMessage(result.message, result.warnings);
    showSectionActionResult(finalMessage, "success");
    ztoolkit.log(`${LOG_PREFIX} 操作完成`, {
      noteID: context.noteItem.id,
      action,
      stats: result.stats,
      warnings: result.warnings,
    });
    return {
      ...result,
      message: finalMessage,
    };
  } catch (error: any) {
    ztoolkit.log(`${LOG_PREFIX} 写回失败`, error);
    showSectionActionResult("章节操作失败，已尝试回滚原始内容", "error");
    throw error;
  }
}

export function applyNoteSectionActionToHtml(
  noteHtml: string,
  headingIndex: number,
  action: NoteSectionActionType,
  options: SectionActionOptions = {},
): NoteSectionActionResult {
  const parsedDocument = parseHtmlDocument(noteHtml);
  const body = getDocumentBody(parsedDocument);
  const noteRoot = getNoteContentRoot(body);
  const headings = getHeadingNodes(noteRoot);
  const headingEl = headings[headingIndex];
  if (!headingEl) {
    return createUnchangedResult(noteHtml, "未检测到标题");
  }

  const fakeContext = {
    editorWindow:
      body.ownerDocument?.defaultView ||
      (globalThis as typeof globalThis & { window?: Window }).window ||
      Zotero.getMainWindow(),
  } as ActiveNoteEditorContext;
  return applySectionAction(noteRoot, headingEl, action, fakeContext, options);
}

export function getHeadingFromContextEvent(
  event: MouseEvent | null,
): HTMLElement | null {
  if (!event) {
    return null;
  }
  return findClosestHeading(event.target as Node | null);
}

export function getHeadingFromSelection(
  editorRoot: HTMLElement,
): HTMLElement | null {
  const selection = getOwnerDocument(editorRoot).defaultView?.getSelection();
  if (!selection || selection.rangeCount === 0) {
    return null;
  }

  const range = selection.getRangeAt(0);
  return findClosestHeading(range.startContainer);
}

export function findClosestHeading(node: Node | null): HTMLElement | null {
  if (!node) {
    return null;
  }

  let element =
    node.nodeType === TEXT_NODE ? node.parentElement : (node as HTMLElement);
  while (element) {
    if (isHeadingNode(element)) {
      return element;
    }
    element = element.parentElement;
  }
  return null;
}

export function getCurrentHeadingSection(
  root: HTMLElement,
  headingEl: HTMLElement,
): HeadingSectionInfo {
  const headingLevel = getHeadingLevel(headingEl);
  const sectionNodes: HTMLElement[] = [];
  let currentNode: Element | null = headingEl;

  while (currentNode) {
    if (currentNode !== headingEl && isHeadingNode(currentNode as HTMLElement)) {
      const currentLevel = getHeadingLevel(currentNode as HTMLElement);
      if (currentLevel <= headingLevel) {
        break;
      }
    }
    if (currentNode.parentElement === root) {
      sectionNodes.push(currentNode as HTMLElement);
    }
    currentNode = currentNode.nextElementSibling;
  }

  return {
    heading: headingEl,
    sectionNodes,
    headingLevel,
  };
}

function applySectionAction(
  body: HTMLElement,
  headingEl: HTMLElement,
  action: NoteSectionActionType,
  context: ActiveNoteEditorContext,
  options: SectionActionOptions = {},
): NoteSectionActionResult {
  switch (action) {
    case "section-upgrade-heading":
      return transformCurrentSectionHeadings(body, headingEl, "up");
    case "section-downgrade-heading":
      return transformCurrentSectionHeadings(body, headingEl, "down");
    case "section-increase-number":
      return adjustCurrentSectionNumber(body, headingEl, 1);
    case "section-decrease-number":
      return adjustCurrentSectionNumber(body, headingEl, -1);
    case "section-delete":
      return deleteCurrentSection(body, headingEl, context, options);
    default: {
      const exhaustiveCheck: never = action;
      throw new Error(`未知的章节操作: ${exhaustiveCheck}`);
    }
  }
}

function transformCurrentSectionHeadings(
  root: HTMLElement,
  headingEl: HTMLElement,
  direction: "up" | "down",
): NoteSectionActionResult {
  const section = getCurrentHeadingSection(root, headingEl);
  let changedHeadings = 0;

  for (const heading of section.sectionNodes) {
    if (!isHeadingNode(heading)) {
      continue;
    }

    const currentLevel = getHeadingLevel(heading);
    const nextLevel =
      direction === "up"
        ? Math.max(currentLevel - 1, 1)
        : Math.min(currentLevel + 1, 6);
    if (currentLevel === nextLevel) {
      continue;
    }

    if (isHtmlHeadingElement(heading)) {
      replaceHtmlHeadingTag(heading, nextLevel);
    } else if (isMarkdownHeadingElement(heading)) {
      replaceMarkdownHeadingLevel(heading, nextLevel);
    }
    changedHeadings++;
  }

  if (changedHeadings === 0) {
    return createUnchangedResult(
      serializeNoteHtml(root),
      direction === "up"
        ? "当前章节标题已无法继续升级"
        : "当前章节标题已无法继续降级",
      { changedHeadings: 0 },
    );
  }

  return {
    html: serializeNoteHtml(root),
    changed: true,
    stats: { changedHeadings },
    warnings: [],
    message:
      direction === "up"
        ? `当前章节标题升级完成：共处理 ${changedHeadings} 个标题`
        : `当前章节标题降级完成：共处理 ${changedHeadings} 个标题`,
  };
}

function adjustCurrentSectionNumber(
  root: HTMLElement,
  headingEl: HTMLElement,
  delta: 1 | -1,
): NoteSectionActionResult {
  const section = getCurrentHeadingSection(root, headingEl);
  const headingText = getHeadingContentText(headingEl);
  const currentHeadingNumber = parseHeadingNumberPrefix(headingText);
  if (!currentHeadingNumber.matched) {
    return createUnchangedResult(
      serializeNoteHtml(root),
      "当前标题未检测到可调整的数字序号",
    );
  }

  const nextParts = [...currentHeadingNumber.parts];
  const lastIndex = nextParts.length - 1;
  if (delta === -1 && nextParts[lastIndex] <= 1) {
    return createUnchangedResult(
      serializeNoteHtml(root),
      "当前标题序号已为 1，不能继续减少。",
    );
  }
  nextParts[lastIndex] += delta;

  const oldPrefix = currentHeadingNumber.prefix;
  const newPrefix = nextParts.join(".");
  const warnings: string[] = [];
  let changedHeadings = 0;

  for (const node of section.sectionNodes) {
    if (!isHeadingNode(node)) {
      continue;
    }

    const parsedNumber = parseHeadingNumberPrefix(getHeadingContentText(node));
    if (
      !parsedNumber.matched ||
      !shouldUpdateNumberedHeading(
        node,
        headingEl,
        parsedNumber,
        currentHeadingNumber,
      )
    ) {
      continue;
    }

    const suffixParts = parsedNumber.parts.slice(
      shouldPropagateNumberChange(currentHeadingNumber)
        ? currentHeadingNumber.parts.length
        : parsedNumber.parts.length,
    );
    const replacedParts = shouldPropagateNumberChange(currentHeadingNumber)
      ? [...nextParts, ...suffixParts]
      : [...nextParts];
    const replacedPrefix = formatPartsForScheme(
      parsedNumber,
      replacedParts,
    );
    const replacementLeadingText = parsedNumber.rawLeadingText.replace(
      parsedNumber.numberText,
      replacedPrefix,
    );

    if (
      replaceHeadingLeadingText(
        node,
        parsedNumber.rawLeadingText,
        replacementLeadingText,
      )
    ) {
      changedHeadings++;
    }
  }

  if (changedHeadings === 0) {
    return createUnchangedResult(
      serializeNoteHtml(root),
      "未检测到可更新的标题序号",
    );
  }

  if (hasPotentialNumberConflict(root, section.heading, oldPrefix, newPrefix)) {
    warnings.push("当前操作可能造成标题编号重复，请检查后续标题编号。");
  }

  return {
    html: serializeNoteHtml(root),
    changed: true,
    stats: { changedHeadings },
    warnings,
    message:
      delta > 0
        ? `当前章节序号 +1 完成：共更新 ${changedHeadings} 个标题`
        : `当前章节序号 -1 完成：共更新 ${changedHeadings} 个标题`,
  };
}

function deleteCurrentSection(
  root: HTMLElement,
  headingEl: HTMLElement,
  context: ActiveNoteEditorContext,
  options: SectionActionOptions = {},
): NoteSectionActionResult {
  const section = getCurrentHeadingSection(root, headingEl);
  if (!section.sectionNodes.length) {
    return createUnchangedResult(serializeNoteHtml(root), "未检测到可删除的章节内容");
  }

  const confirmed = options.skipDeleteConfirm
    ? true
    : confirmDeleteCurrentSection(
        context.editorWindow,
        "确认删除当前章节吗？\n这将删除当前标题及其下级内容。",
      );
  if (!confirmed) {
    return createUnchangedResult(serializeNoteHtml(root), "已取消删除当前章节");
  }

  const removedCount = section.sectionNodes.length;
  for (const node of section.sectionNodes) {
    node.remove();
  }

  return {
    html: serializeNoteHtml(root),
    changed: true,
    stats: { removedNodes: removedCount },
    warnings: [],
    message: `已删除当前章节，共删除 ${removedCount} 个节点。`,
  };
}

function resolveHeadingElementInHtml(
  root: HTMLElement,
  editorRoot: HTMLElement,
  editorHeading: HTMLElement,
): HTMLElement | null {
  const editorChildren = Array.from(editorRoot.children);
  const childIndex = editorChildren.indexOf(editorHeading);
  const bodyChildren = Array.from(root.children) as HTMLElement[];

  if (childIndex >= 0) {
    const target = bodyChildren[childIndex];
    if (target && isHeadingNode(target)) {
      return target;
    }
  }

  const rawHeadingText = normalizeText(editorHeading.textContent || "");
  const contentHeadingText = normalizeText(getHeadingContentText(editorHeading));
  return (
    getHeadingNodes(root).find(
      (heading) =>
        getHeadingLevel(heading) === getHeadingLevel(editorHeading) &&
        (normalizeText(heading.textContent || "") === rawHeadingText ||
          normalizeText(getHeadingContentText(heading)) === contentHeadingText),
    ) || null
  );
}

function getHeadingNodes(root: HTMLElement): HTMLElement[] {
  const nodes = Array.from(root.children) as HTMLElement[];
  return nodes.filter((node) => isHeadingNode(node));
}

function isHeadingNode(node: HTMLElement | Element | null): node is HTMLElement {
  if (!node || node.nodeType !== 1) {
    return false;
  }
  return isHtmlHeadingElement(node as HTMLElement) || isMarkdownHeadingElement(node as HTMLElement);
}

function isHtmlHeadingElement(node: HTMLElement): boolean {
  return /^H[1-6]$/.test(node.tagName);
}

function isMarkdownHeadingElement(node: HTMLElement): boolean {
  if (!node.matches(MARKDOWN_BLOCK_SELECTOR)) {
    return false;
  }
  return MARKDOWN_HEADING_REGEX.test(normalizeText(node.textContent || ""));
}

function getHeadingLevel(heading: HTMLElement): number {
  if (isHtmlHeadingElement(heading)) {
    return Number(heading.tagName.slice(1));
  }

  const markdownMatch = normalizeText(heading.textContent || "").match(
    MARKDOWN_HEADING_REGEX,
  );
  if (markdownMatch) {
    return markdownMatch[2].length;
  }
  throw new Error("当前节点不是标题");
}

function getHeadingContentText(heading: HTMLElement): string {
  const text = normalizeText(heading.textContent || "");
  const markdownMatch = text.match(MARKDOWN_HEADING_REGEX);
  if (markdownMatch) {
    return markdownMatch[4].trim();
  }
  return text;
}

function replaceHtmlHeadingTag(heading: HTMLElement, nextLevel: number) {
  const ownerDocument = getOwnerDocument(heading);
  const replacement = ownerDocument.createElement(`h${nextLevel}`);
  for (const attr of Array.from(heading.attributes) as Attr[]) {
    replacement.setAttribute(attr.name, attr.value);
  }
  while (heading.firstChild) {
    replacement.appendChild(heading.firstChild);
  }
  heading.replaceWith(replacement);
}

function replaceMarkdownHeadingLevel(heading: HTMLElement, nextLevel: number) {
  const normalizedText = normalizeText(heading.textContent || "");
  const match = normalizedText.match(MARKDOWN_HEADING_REGEX);
  if (!match) {
    return;
  }

  const leadingText = `${match[1]}${match[2]}${match[3]}`;
  const replacementLeadingText = `${match[1]}${"#".repeat(nextLevel)}${match[3]}`;
  replaceLeadingTextContentPreserveStructure(
    heading,
    leadingText,
    replacementLeadingText,
  );
}

function replaceHeadingLeadingText(
  heading: HTMLElement,
  oldLeadingText: string,
  newLeadingText: string,
): boolean {
  if (isHtmlHeadingElement(heading)) {
    return replaceLeadingTextContentPreserveStructure(
      heading,
      oldLeadingText,
      newLeadingText,
    );
  }

  const normalizedText = normalizeText(heading.textContent || "");
  const match = normalizedText.match(MARKDOWN_HEADING_REGEX);
  if (!match) {
    return false;
  }
  const markdownLeadingText = `${match[1]}${match[2]}${match[3]}`;
  return replaceLeadingTextContentPreserveStructure(
    heading,
    `${markdownLeadingText}${oldLeadingText}`,
    `${markdownLeadingText}${newLeadingText}`,
  );
}

function replaceLeadingTextContentPreserveStructure(
  root: HTMLElement,
  oldLeadingText: string,
  newLeadingText: string,
): boolean {
  if (oldLeadingText === newLeadingText) {
    return false;
  }
  if (!(root.textContent || "").startsWith(oldLeadingText)) {
    return false;
  }

  const textNodes = collectTextNodes(root);
  let remaining = oldLeadingText.length;
  let inserted = false;

  for (const textNode of textNodes) {
    if (remaining <= 0) {
      break;
    }

    const text = textNode.nodeValue || "";
    if (!text.length) {
      continue;
    }

    const consumeLength = Math.min(remaining, text.length);
    const tail = text.slice(consumeLength);
    if (!inserted) {
      textNode.nodeValue = `${newLeadingText}${tail}`;
      inserted = true;
    } else {
      textNode.nodeValue = tail;
    }
    remaining -= consumeLength;
  }

  if (!inserted) {
    root.textContent = (root.textContent || "").replace(
      oldLeadingText,
      newLeadingText,
    );
  }
  return true;
}

function collectTextNodes(root: HTMLElement): Text[] {
  const textNodes: Text[] = [];
  const walker = getOwnerDocument(root).createTreeWalker(root, SHOW_TEXT);
  let currentNode = walker.nextNode();
  while (currentNode) {
    textNodes.push(currentNode as Text);
    currentNode = walker.nextNode();
  }
  return textNodes;
}

function hasPotentialNumberConflict(
  body: HTMLElement,
  currentHeading: HTMLElement,
  oldPrefix: string,
  newPrefix: string,
): boolean {
  if (oldPrefix === newPrefix) {
    return false;
  }

  return getHeadingNodes(body).some((heading) => {
    if (heading === currentHeading) {
      return false;
    }
    const parsedNumber = parseHeadingNumberPrefix(getHeadingContentText(heading));
    return (
      parsedNumber.matched &&
      parsedNumber.prefix === newPrefix &&
      parsedNumber.scheme === parseHeadingNumberPrefix(getHeadingContentText(currentHeading)).scheme
    );
  });
}

function isNumberPrefixWithinSection(
  candidate: number[],
  current: number[],
): boolean {
  if (candidate.length < current.length) {
    return false;
  }
  return current.every((part, index) => candidate[index] === part);
}

function parseHtmlDocument(noteHtml: string): Document {
  return new DOMParser().parseFromString(noteHtml, "text/html");
}

function getDocumentBody(doc: Document): HTMLElement {
  if (!doc.body) {
    throw new Error("无法解析笔记 HTML 内容");
  }
  return doc.body as HTMLElement;
}

function getNoteContentRoot(body: HTMLElement): HTMLElement {
  const schemaContainer = body.querySelector(
    ":scope > div[data-schema-version]",
  ) as HTMLElement | null;
  if (schemaContainer) {
    return schemaContainer;
  }

  const singleChild = body.children.length === 1 ? body.firstElementChild : null;
  if (
    singleChild instanceof HTMLElement &&
    singleChild.tagName === "DIV" &&
    getHeadingNodes(singleChild).length > 0
  ) {
    return singleChild;
  }

  return body;
}

function serializeNoteHtml(root: HTMLElement): string {
  return String(getDocumentBody(getOwnerDocument(root)).innerHTML);
}

function getOwnerDocument(node: Node): Document {
  if (!node.ownerDocument) {
    throw new Error("当前节点缺少 ownerDocument");
  }
  return node.ownerDocument;
}

function isNoteHtmlEmpty(noteHtml: string): boolean {
  const body = getDocumentBody(parseHtmlDocument(noteHtml));
  return !normalizeText(body.textContent || "");
}

function normalizeText(text: string): string {
  return text.replace(/\u00a0/g, " ").replace(/\r\n?/g, "\n").trim();
}

function splitHeadingTitleSeparator(
  trailingText: string,
  hasClosingWrapper: boolean,
): { separator: string; titleText: string } | null {
  if (!trailingText) {
    return {
      separator: "",
      titleText: "",
    };
  }

  const whitespaceMatch = trailingText.match(/^(\s+)([\s\S]+)$/);
  if (whitespaceMatch) {
    return {
      separator: whitespaceMatch[1],
      titleText: whitespaceMatch[2],
    };
  }

  const punctuationMatch = trailingText.match(/^([、:：\-–—]\s*)([\s\S]+)$/);
  if (punctuationMatch) {
    return {
      separator: punctuationMatch[1],
      titleText: punctuationMatch[2],
    };
  }

  if (hasClosingWrapper && trailingText.trim()) {
    return {
      separator: "",
      titleText: trailingText,
    };
  }

  return null;
}

function buildMatchedHeadingNumberResult(
  data: Omit<HeadingNumberParseResult, "matched">,
): HeadingNumberParseResult {
  return {
    matched: true,
    ...data,
  };
}

export function parseHeadingNumberPrefix(text: string): HeadingNumberParseResult {
  const normalizedText = normalizeText(text);
  return (
    parseArabicHeadingNumberPrefix(normalizedText) ||
    parseChineseHeadingNumberPrefix(normalizedText) ||
    parseChapterHeadingNumberPrefix(normalizedText) ||
    parseEnglishHeadingNumberPrefix(normalizedText) ||
    {
      matched: false,
      scheme: "none",
      prefix: "",
      parts: [],
      numberText: "",
      titleText: normalizedText.trim(),
      separator: "",
      rawLeadingText: "",
      propagateToDescendants: false,
    }
  );
}

function parseArabicHeadingNumberPrefix(
  normalizedText: string,
): HeadingNumberParseResult | null {
  const matched = normalizedText.match(ARABIC_NUMBER_PREFIX_REGEX);
  if (!matched) {
    return null;
  }

  const [
    ,
    leadingWhitespace,
    openingWrapper = "",
    numberText,
    trailingDot = "",
    closingWrapper = "",
    trailingText = "",
  ] = matched;
  const separatorResult = splitHeadingTitleSeparator(
    trailingText,
    Boolean(closingWrapper),
  );
  if (!separatorResult) {
    return null;
  }

  return buildMatchedHeadingNumberResult({
    scheme:
      openingWrapper || closingWrapper ? "arabic-wrapped" : "arabic",
    prefix: numberText,
    parts: numberText.split(".").map((item) => Number(item)),
    numberText,
    titleText: separatorResult.titleText.trim(),
    separator: separatorResult.separator,
    rawLeadingText: `${leadingWhitespace}${openingWrapper}${numberText}${trailingDot}${closingWrapper}${separatorResult.separator}`,
    propagateToDescendants: true,
  });
}

function parseChineseHeadingNumberPrefix(
  normalizedText: string,
): HeadingNumberParseResult | null {
  const matched = normalizedText.match(CHINESE_NUMBER_PREFIX_REGEX);
  if (!matched) {
    return null;
  }

  const [
    ,
    leadingWhitespace,
    openingWrapper = "",
    numberText,
    trailingDot = "",
    closingWrapper = "",
    trailingText = "",
  ] = matched;
  const parts = [convertChineseNumberToArabic(numberText)];
  if (!parts[0]) {
    return null;
  }
  const separatorResult = splitHeadingTitleSeparator(
    trailingText,
    Boolean(closingWrapper),
  );
  if (!separatorResult) {
    return null;
  }

  return buildMatchedHeadingNumberResult({
    scheme:
      openingWrapper || closingWrapper ? "chinese-wrapped" : "chinese",
    prefix: String(parts[0]),
    parts,
    numberText,
    titleText: separatorResult.titleText.trim(),
    separator: separatorResult.separator,
    rawLeadingText: `${leadingWhitespace}${openingWrapper}${numberText}${trailingDot}${closingWrapper}${separatorResult.separator}`,
    propagateToDescendants: true,
  });
}

function parseChapterHeadingNumberPrefix(
  normalizedText: string,
): HeadingNumberParseResult | null {
  const matched = normalizedText.match(CHAPTER_PREFIX_REGEX);
  if (!matched) {
    return null;
  }

  const [, leadingWhitespace, rawNumberText, unit, trailingText = ""] = matched;
  const isChineseNumber = /[零〇一二两三四五六七八九十百千]/.test(rawNumberText);
  const numericValue = isChineseNumber
    ? convertChineseNumberToArabic(rawNumberText)
    : Number(rawNumberText);
  if (!numericValue) {
    return null;
  }

  const separatorResult = splitHeadingTitleSeparator(trailingText, true);
  if (!separatorResult) {
    return null;
  }

  return buildMatchedHeadingNumberResult({
    scheme: isChineseNumber ? "chapter-chinese" : "chapter-arabic",
    prefix: String(numericValue),
    parts: [numericValue],
    numberText: rawNumberText,
    titleText: separatorResult.titleText.trim(),
    separator: separatorResult.separator,
    rawLeadingText: `${leadingWhitespace}第${rawNumberText}${unit}${separatorResult.separator}`,
    propagateToDescendants: true,
  });
}

function parseEnglishHeadingNumberPrefix(
  normalizedText: string,
): HeadingNumberParseResult | null {
  const matched = normalizedText.match(ENGLISH_PREFIX_REGEX);
  if (!matched) {
    return null;
  }

  const [, leadingWhitespace, keyword, rawNumberText, trailingText = ""] = matched;
  const numericValue = Number(rawNumberText);
  if (!numericValue) {
    return null;
  }

  const separatorResult = splitHeadingTitleSeparator(trailingText, true);
  if (!separatorResult) {
    return null;
  }

  return buildMatchedHeadingNumberResult({
    scheme: "english-prefixed",
    prefix: String(numericValue),
    parts: [numericValue],
    numberText: rawNumberText,
    titleText: separatorResult.titleText.trim(),
    separator: separatorResult.separator,
    rawLeadingText: `${leadingWhitespace}${keyword} ${rawNumberText}${separatorResult.separator}`,
    propagateToDescendants: true,
  });
}

function formatPartsForScheme(
  parsedNumber: HeadingNumberParseResult,
  parts: number[],
): string {
  switch (parsedNumber.scheme) {
    case "arabic":
    case "arabic-wrapped":
      return parts.join(".");
    case "chinese":
    case "chinese-wrapped":
    case "chapter-chinese":
      return convertArabicNumberToChinese(parts[parts.length - 1]);
    case "chapter-arabic":
    case "english-prefixed":
      return String(parts[parts.length - 1]);
    default:
      return parts.join(".");
  }
}

function shouldUpdateNumberedHeading(
  node: HTMLElement,
  currentHeading: HTMLElement,
  candidate: HeadingNumberParseResult,
  current: HeadingNumberParseResult,
): boolean {
  if (node === currentHeading) {
    return true;
  }
  if (!shouldPropagateNumberChange(current)) {
    return false;
  }
  if (candidate.scheme !== "arabic" && candidate.scheme !== "arabic-wrapped") {
    return false;
  }
  return isNumberPrefixWithinSection(candidate.parts, current.parts);
}

function shouldPropagateNumberChange(current: HeadingNumberParseResult): boolean {
  if (!current.propagateToDescendants) {
    return false;
  }
  return current.parts.length === 1;
}

function convertChineseNumberToArabic(text: string): number {
  const normalized = text.replace(/兩/g, "两");
  const digitMap: Record<string, number> = {
    零: 0,
    〇: 0,
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
  };
  const unitMap: Record<string, number> = {
    十: 10,
    百: 100,
    千: 1000,
  };

  if (/^[零〇一二两三四五六七八九]$/.test(normalized)) {
    return digitMap[normalized] || 0;
  }

  let total = 0;
  let current = 0;
  let hasUnit = false;
  for (const char of normalized) {
    if (digitMap[char] !== undefined) {
      current = digitMap[char];
      continue;
    }
    const unit = unitMap[char];
    if (!unit) {
      return 0;
    }
    hasUnit = true;
    total += (current || 1) * unit;
    current = 0;
  }

  return hasUnit ? total + current : 0;
}

function convertArabicNumberToChinese(value: number): string {
  if (value <= 0) {
    return String(value);
  }
  const digits = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
  const units = ["", "十", "百", "千"];
  const chars = String(value).split("").map(Number);
  let result = "";

  for (let index = 0; index < chars.length; index++) {
    const digit = chars[index];
    const unitIndex = chars.length - index - 1;
    if (digit === 0) {
      if (!result.endsWith("零") && index !== chars.length - 1) {
        result += "零";
      }
      continue;
    }
    if (!(digit === 1 && unitIndex === 1 && result === "")) {
      result += digits[digit];
    }
    result += units[unitIndex];
  }

  return result.replace(/零+$/g, "").replace(/零+/g, "零");
}

function createUnchangedResult(
  html: string,
  message: string,
  stats: { [key: string]: number } = {},
): NoteSectionActionResult {
  return {
    html,
    changed: false,
    stats,
    warnings: [],
    message,
  };
}

function buildFinalMessage(message: string, warnings: string[]): string {
  if (!warnings.length) {
    return message;
  }
  return `${message} ${warnings.join(" ")}`;
}
