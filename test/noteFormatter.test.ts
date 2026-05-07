import { assert } from "chai";
import {
  downgradeHeadings,
  fixMathInNoteHtml,
  removeExtraLineBreaks,
  upgradeHeadings,
} from "../src/modules/noteFormatter";

describe("noteFormatter", function () {
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

  it("should fix common math patterns without losing normal text", function () {
    const input = [
      "<p>变化量定义为 $D = T - R$，其中 T 表示目标时相。</p>",
      "<p>$$<br>D = T - R<br>$$</p>",
      "<p>\\[ Z = \\frac{x-\\mu}{\\sigma} \\]</p>",
      "<p>\\begin{equation} F = ma \\end{equation}</p>",
    ].join("");

    const result = fixMathInNoteHtml(input);

    assert.isTrue(result.changed);
    assert.include(result.html, '<span class="math">$D = T - R$</span>');
    assert.include(result.html, '<pre class="math">$$D = T - R$$</pre>');
    assert.include(
      result.html,
      '<pre class="math">$$Z = \\frac{x-\\mu}{\\sigma}$$</pre>',
    );
    assert.include(result.html, '<pre class="math">$$F = ma$$</pre>');
    assert.include(result.html, "变化量定义为 ");
    assert.equal(result.stats.inlineFixed, 1);
    assert.equal(result.stats.blockFixed, 3);
  });

  it("should not re-wrap existing math or touch price and code blocks", function () {
    const input = [
      "<p>价格约为 $100，不应被错误转换。</p>",
      '<p>已有公式 <span class="math">$x$</span> 保持不变。</p>',
      "<pre><code>const price = '$200';</code></pre>",
    ].join("");

    const result = fixMathInNoteHtml(input);

    assert.include(result.html, "价格约为 $100，不应被错误转换。");
    assert.include(result.html, '<span class="math">$x$</span>');
    assert.include(result.html, "<code>const price = '$200';</code>");
    assert.equal(result.stats.inlineFixed, 0);
    assert.equal(result.stats.blockFixed, 0);
  });

  it("should fix inline double-dollar formulas inside normal text", function () {
    const input = [
      "<p>行内双美元公式 $$E = mc^2$$ 应被修复。</p>",
      "<p>另一个例子是 $$x_i = y_i + 1$$。</p>",
    ].join("");

    const result = fixMathInNoteHtml(input);

    assert.include(result.html, '<span class="math">$E = mc^2$</span>');
    assert.include(result.html, '<span class="math">$x_i = y_i + 1$</span>');
    assert.equal(result.stats.inlineFixed, 2);
  });

  it("should fix markdown math fences in raw text and code blocks", function () {
    const input = [
      "<p>```math<br>F = ma<br>```</p>",
      "<pre><code>```math\nE = mc^2\n```</code></pre>",
      "<pre><code>const price = 100;</code></pre>",
    ].join("");

    const result = fixMathInNoteHtml(input);

    assert.include(result.html, '<pre class="math">$$F = ma$$</pre>');
    assert.include(result.html, '<pre class="math">$$E = mc^2$$</pre>');
    assert.include(result.html, "<pre><code>const price = 100;</code></pre>");
    assert.isAtLeast(result.stats.blockFixed, 2);
  });

  it("should downgrade headings while preserving child nodes", function () {
    const input = [
      "<h1>论文总结</h1>",
      "<h2>研究背景</h2>",
      "<h3><strong>方法流程</strong></h3>",
    ].join("");

    const result = downgradeHeadings(input);

    assert.equal(
      result.html,
      "<h2>论文总结</h2><h3>研究背景</h3><h4><strong>方法流程</strong></h4>",
    );
    assert.equal(result.stats.changedHeadings, 3);
  });

  it("should upgrade headings while preserving child nodes", function () {
    const input = [
      "<h1>论文总结</h1>",
      "<h2>研究背景</h2>",
      "<h3><strong>方法流程</strong></h3>",
    ].join("");

    const result = upgradeHeadings(input);

    assert.equal(
      result.html,
      "<h1>论文总结</h1><h1>研究背景</h1><h2><strong>方法流程</strong></h2>",
    );
    assert.equal(result.stats.changedHeadings, 2);
  });

  it("should clean extra line breaks and merge broken list paragraphs", function () {
    const input = [
      "<p>1.</p>",
      "<p><strong>研究背景</strong></p>",
      "<p></p>",
      "<p><br></p>",
      "<p>本文提出了一种方法。</p>",
      "<p><br></p>",
      "<p><br></p>",
      "<p>2.</p>",
      "<p><strong>方法流程</strong></p>",
    ].join("");

    const result = removeExtraLineBreaks(input);

    assert.equal(
      result.html,
      "<p>1. <strong>研究背景</strong></p><p>本文提出了一种方法。</p><p>2. <strong>方法流程</strong></p>",
    );
    assert.isAtLeast(result.stats.removedEmptyBlocks, 2);
    assert.equal(result.stats.mergedParagraphs, 2);
  });

  it("should leave blockquote and math blocks unchanged when cleaning line breaks", function () {
    const input = [
      "<blockquote><p>保留引用分段。</p><p>第二段。</p></blockquote>",
      '<pre class="math">$$a \\\\ b$$</pre>',
      "<p><br></p>",
    ].join("");

    const result = removeExtraLineBreaks(input);

    assert.include(
      result.html,
      "<blockquote><p>保留引用分段。</p><p>第二段。</p></blockquote>",
    );
    assert.include(result.html, '<pre class="math">$$a \\\\ b$$</pre>');
  });

  it("should merge broken marker paragraphs inside list items", function () {
    const input = [
      "<ol>",
      "<li><p>1.</p><p><strong>研究背景</strong></p></li>",
      "<li><p>2.</p><p>方法流程</p></li>",
      "</ol>",
      "<ul>",
      "<li><p>•</p><p>关键发现</p></li>",
      "</ul>",
    ].join("");

    const result = removeExtraLineBreaks(input);

    assert.include(
      result.html,
      "<ol><li><p><strong>研究背景</strong></p></li><li><p>方法流程</p></li></ol>",
    );
    assert.include(result.html, "<ul><li><p>关键发现</p></li></ul>");
    assert.isAtLeast(result.stats.mergedParagraphs, 3);
  });
});
