import { assert } from "chai";
import {
  applyNoteSectionActionToHtml,
  getCurrentHeadingSection,
  parseHeadingNumberPrefix,
} from "../src/modules/noteSectionActions";

describe("noteSectionActions", function () {
  before(function () {
    if (typeof DOMParser !== "undefined") {
      return;
    }

    const mainWindow = Zotero.getMainWindows()[0] as Window | undefined;
    if (mainWindow?.DOMParser) {
      // @ts-expect-error 为测试环境补充 DOMParser
      globalThis.DOMParser = mainWindow.DOMParser;
    }
  });

  it("should parse heading number prefixes", function () {
    const plain = parseHeadingNumberPrefix("1 标题");
    const dotted = parseHeadingNumberPrefix("1. 标题");
    const escapedDotted = parseHeadingNumberPrefix("3\\. ADFI 洪水制图流程");
    const commaSeparated = parseHeadingNumberPrefix("1、研究背景");
    const halfWrapped = parseHeadingNumberPrefix("(1) Background");
    const fullWrapped = parseHeadingNumberPrefix("（2）方法流程");
    const rightParen = parseHeadingNumberPrefix("3) Results");
    const chineseComma = parseHeadingNumberPrefix("一、标题");
    const chineseWrapped = parseHeadingNumberPrefix("（一）标题");
    const chineseChapter = parseHeadingNumberPrefix("第一章 标题");
    const arabicChapter = parseHeadingNumberPrefix("第1章 标题");
    const englishChapter = parseHeadingNumberPrefix("Chapter 1 Introduction");
    const englishSection = parseHeadingNumberPrefix("Section 2 Background");
    const nested = parseHeadingNumberPrefix("1.1.1 标题");

    assert.isTrue(plain.matched);
    assert.equal(plain.prefix, "1");
    assert.deepEqual(plain.parts, [1]);

    assert.isTrue(dotted.matched);
    assert.equal(dotted.prefix, "1");
    assert.equal(dotted.separator, " ");

    assert.isTrue(escapedDotted.matched);
    assert.equal(escapedDotted.prefix, "3");
    assert.equal(escapedDotted.rawLeadingText, "3\\. ");

    assert.isTrue(commaSeparated.matched);
    assert.equal(commaSeparated.prefix, "1");
    assert.equal(commaSeparated.rawLeadingText, "1、");

    assert.isTrue(halfWrapped.matched);
    assert.equal(halfWrapped.prefix, "1");
    assert.equal(halfWrapped.rawLeadingText, "(1) ");

    assert.isTrue(fullWrapped.matched);
    assert.equal(fullWrapped.prefix, "2");
    assert.equal(fullWrapped.rawLeadingText, "（2）");

    assert.isTrue(rightParen.matched);
    assert.equal(rightParen.prefix, "3");
    assert.equal(rightParen.rawLeadingText, "3) ");

    assert.isTrue(chineseComma.matched);
    assert.equal(chineseComma.scheme, "chinese");
    assert.equal(chineseComma.prefix, "1");
    assert.equal(chineseComma.rawLeadingText, "一、");

    assert.isTrue(chineseWrapped.matched);
    assert.equal(chineseWrapped.scheme, "chinese-wrapped");
    assert.equal(chineseWrapped.prefix, "1");
    assert.equal(chineseWrapped.rawLeadingText, "（一）");

    assert.isTrue(chineseChapter.matched);
    assert.equal(chineseChapter.scheme, "chapter-chinese");
    assert.equal(chineseChapter.prefix, "1");
    assert.equal(chineseChapter.rawLeadingText, "第一章 ");

    assert.isTrue(arabicChapter.matched);
    assert.equal(arabicChapter.scheme, "chapter-arabic");
    assert.equal(arabicChapter.prefix, "1");
    assert.equal(arabicChapter.rawLeadingText, "第1章 ");

    assert.isTrue(englishChapter.matched);
    assert.equal(englishChapter.scheme, "english-prefixed");
    assert.equal(englishChapter.prefix, "1");
    assert.equal(englishChapter.rawLeadingText, "Chapter 1 ");

    assert.isTrue(englishSection.matched);
    assert.equal(englishSection.scheme, "english-prefixed");
    assert.equal(englishSection.prefix, "2");
    assert.equal(englishSection.rawLeadingText, "Section 2 ");

    assert.isTrue(nested.matched);
    assert.equal(nested.prefix, "1.1.1");
    assert.deepEqual(nested.parts, [1, 1, 1]);
  });

  it("should get the current heading section with correct stop boundary", function () {
    const doc = new DOMParser().parseFromString(
      [
        "<h2>1 研究背景</h2>",
        "<p>背景正文</p>",
        "<h3>1.1 问题来源</h3>",
        "<p>问题来源正文</p>",
        "<h2>2 方法流程</h2>",
      ].join(""),
      "text/html",
    );
    const body = doc.body as HTMLElement;
    const heading = body.querySelector("h2") as HTMLElement;
    const result = getCurrentHeadingSection(body, heading);

    assert.equal(result.headingLevel, 2);
    assert.equal(result.sectionNodes.length, 4);
    assert.equal(result.sectionNodes[0].tagName, "H2");
    assert.equal(result.sectionNodes[3].tagName, "P");
  });

  it("should upgrade only the current section headings", function () {
    const input = [
      "<h2>1 研究背景</h2>",
      "<p>背景正文</p>",
      "<h3>1.1 <strong>问题来源</strong></h3>",
      "<p>问题来源正文</p>",
      "<h3>1.2 研究意义</h3>",
      "<h2>2 方法流程</h2>",
    ].join("");

    const result = applyNoteSectionActionToHtml(
      input,
      0,
      "section-upgrade-heading",
    );

    assert.isTrue(result.changed);
    assert.include(result.html, "<h1>1 研究背景</h1>");
    assert.include(result.html, "<h2>1.1 <strong>问题来源</strong></h2>");
    assert.include(result.html, "<h2>1.2 研究意义</h2>");
    assert.include(result.html, "<h2>2 方法流程</h2>");
  });

  it("should downgrade only the current section headings", function () {
    const input = [
      "<h2>1 研究背景</h2>",
      "<p>背景正文</p>",
      "<h3>1.1 问题来源</h3>",
      "<h2>2 方法流程</h2>",
    ].join("");

    const result = applyNoteSectionActionToHtml(
      input,
      0,
      "section-downgrade-heading",
    );

    assert.equal(
      result.html,
      "<h3>1 研究背景</h3><p>背景正文</p><h4>1.1 问题来源</h4><h2>2 方法流程</h2>",
    );
  });

  it("should increase heading numbers for current section and descendants", function () {
    const input = [
      "<h2>1 研究背景</h2>",
      "<h3>1.1 <span>问题来源</span></h3>",
      "<h4>1.1.1 方法流程</h4>",
      "<h2>2 方法流程</h2>",
    ].join("");

    const result = applyNoteSectionActionToHtml(
      input,
      0,
      "section-increase-number",
    );

    assert.isTrue(result.changed);
    assert.include(result.html, "<h2>2 研究背景</h2>");
    assert.include(result.html, "<h3>2.1 <span>问题来源</span></h3>");
    assert.include(result.html, "<h4>2.1.1 方法流程</h4>");
    assert.include(result.warnings.join(" "), "标题编号重复");
  });

  it("should decrease heading numbers and refuse to create zero", function () {
    const input = [
      "<h2>2 研究背景</h2>",
      "<h3>2.1 问题来源</h3>",
      "<h2>3 方法流程</h2>",
    ].join("");

    const result = applyNoteSectionActionToHtml(
      input,
      0,
      "section-decrease-number",
    );
    assert.include(result.html, "<h2>1 研究背景</h2>");
    assert.include(result.html, "<h3>1.1 问题来源</h3>");

    const blocked = applyNoteSectionActionToHtml(
      "<h2>1.1 问题来源</h2>",
      0,
      "section-decrease-number",
    );
    assert.isFalse(blocked.changed);
    assert.equal(blocked.message, "当前标题序号已为 1，不能继续减少。");
  });

  it("should leave unnumbered headings unchanged for number actions", function () {
    const result = applyNoteSectionActionToHtml(
      "<h2>研究背景</h2><p>正文</p>",
      0,
      "section-increase-number",
    );

    assert.isFalse(result.changed);
    assert.equal(result.message, "当前标题未检测到可调整的数字序号");
  });

  it("should delete current section without touching next same level heading", function () {
    const input = [
      "<h2>1 研究背景</h2>",
      "<p>背景正文</p>",
      '<p><img data-attachment-key="ABC" src="img.png"></p>',
      "<blockquote><p>引用</p></blockquote>",
      "<h3>1.1 问题来源</h3>",
      "<table><tbody><tr><td>表格</td></tr></tbody></table>",
      "<h2>2 方法流程</h2>",
      "<p>方法正文</p>",
    ].join("");

    const result = applyNoteSectionActionToHtml(
      input,
      0,
      "section-delete",
      { skipDeleteConfirm: true },
    );

    assert.isTrue(result.changed);
    assert.equal(result.html, "<h2>2 方法流程</h2><p>方法正文</p>");
    assert.equal(result.stats.removedNodes, 6);
  });

  it("should support markdown style headings for level transform", function () {
    const input = [
      "<p>## 1 研究背景</p>",
      "<p>正文</p>",
      "<p>### 1.1 问题来源</p>",
      "<p>## 2 方法流程</p>",
    ].join("");

    const result = applyNoteSectionActionToHtml(
      input,
      0,
      "section-upgrade-heading",
    );

    assert.include(result.html, "<p># 1 研究背景</p>");
    assert.include(result.html, "<p>## 1.1 问题来源</p>");
    assert.include(result.html, "<p>## 2 方法流程</p>");
  });

  it("should support markdown style headings for number updates", function () {
    const input = [
      "<p>## 1 研究背景</p>",
      "<p>### 1.1 问题来源</p>",
      "<p>#### 1.1.1 方法流程</p>",
    ].join("");

    const result = applyNoteSectionActionToHtml(
      input,
      0,
      "section-increase-number",
    );

    assert.include(result.html, "<p>## 2 研究背景</p>");
    assert.include(result.html, "<p>### 2.1 问题来源</p>");
    assert.include(result.html, "<p>#### 2.1.1 方法流程</p>");
  });

  it("should support escaped dot numbering in markdown headings", function () {
    const input = [
      "<p>## 3\\. ADFI 洪水制图流程</p>",
      "<p>### 3.1 数据准备</p>",
      "<p>## 4\\. 其他章节</p>",
    ].join("");

    const result = applyNoteSectionActionToHtml(
      input,
      0,
      "section-increase-number",
    );

    assert.include(result.html, "<p>## 4\\. ADFI 洪水制图流程</p>");
    assert.include(result.html, "<p>### 4.1 数据准备</p>");
  });

  it("should support wrapped and comma separated heading numbering updates", function () {
    const input = [
      "<p>## （2）方法流程</p>",
      "<p>### 2.1 数据准备</p>",
      "<p>## 3、其他章节</p>",
    ].join("");

    const result = applyNoteSectionActionToHtml(
      input,
      0,
      "section-increase-number",
    );

    assert.include(result.html, "<p>## （3）方法流程</p>");
    assert.include(result.html, "<p>### 3.1 数据准备</p>");
  });

  it("should support chinese and chapter style heading numbering updates", function () {
    const chineseInput = [
      "<p>## 一、研究背景</p>",
      "<p>### 1.1 问题来源</p>",
      "<p>## 二、其他章节</p>",
    ].join("");

    const chineseResult = applyNoteSectionActionToHtml(
      chineseInput,
      0,
      "section-increase-number",
    );

    assert.include(chineseResult.html, "<p>## 二、研究背景</p>");
    assert.include(chineseResult.html, "<p>### 2.1 问题来源</p>");

    const chapterInput = [
      "<p>## 第1章 研究背景</p>",
      "<p>### 1.1 问题来源</p>",
      "<p>## 第2章 其他章节</p>",
    ].join("");

    const chapterResult = applyNoteSectionActionToHtml(
      chapterInput,
      0,
      "section-increase-number",
    );

    assert.include(chapterResult.html, "<p>## 第2章 研究背景</p>");
    assert.include(chapterResult.html, "<p>### 2.1 问题来源</p>");
  });

  it("should support english prefixed heading numbering updates", function () {
    const input = [
      "<p>## Chapter 1 Introduction</p>",
      "<p>### 1.1 Background</p>",
      "<p>## Chapter 2 Methods</p>",
    ].join("");

    const result = applyNoteSectionActionToHtml(
      input,
      0,
      "section-increase-number",
    );

    assert.include(result.html, "<p>## Chapter 2 Introduction</p>");
    assert.include(result.html, "<p>### 2.1 Background</p>");
  });

  it("should preserve Zotero note schema container when editing markdown headings", function () {
    const input = [
      '<div data-schema-version="9">',
      "<p>## 1 研究背景</p>",
      "<p>正文</p>",
      "<p>### 1.1 问题来源</p>",
      "<p>## 2 方法流程</p>",
      "</div>",
    ].join("");

    const result = applyNoteSectionActionToHtml(
      input,
      0,
      "section-increase-number",
    );

    assert.include(result.html, '<div data-schema-version="9">');
    assert.include(result.html, "<p>## 2 研究背景</p>");
    assert.include(result.html, "<p>### 2.1 问题来源</p>");
    assert.include(result.html, "<p>## 2 方法流程</p>");
  });
});
