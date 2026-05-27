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

  it("should fix inline identifier formulas wrapped by double-dollar", function () {
    const input = [
      "<p>$$F$$ 表示 flood，即洪水状态；</p>",
      "<p>$$NF$$ 或 $$N$$ 表示 non-flood，即非洪水状态；</p>",
    ].join("");

    const result = fixMathInNoteHtml(input);

    assert.include(result.html, '<span class="math">$F$</span> 表示 flood');
    assert.include(
      result.html,
      '<span class="math">$NF$</span> 或 <span class="math">$N$</span> 表示 non-flood',
    );
    assert.equal(result.stats.inlineFixed, 3);
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

  it("should fix pure text-fenced formulas and extract formulas from mixed fences", function () {
    const input = [
      "<pre><code>```text\n$$\n\\Delta\\gamma_t=\\gamma_{t,co}-\\gamma_{t,pre}\n$$\n```</code></pre>",
      "<pre><code>```text\n公式如下：\n$$E=mc^2$$\n```</code></pre>",
    ].join("");

    const result = fixMathInNoteHtml(input);

    assert.include(
      result.html,
      '<pre class="math">$$\\Delta\\gamma_t=\\gamma_{t,co}-\\gamma_{t,pre}$$</pre>',
    );
    assert.include(result.html, '<pre class="math">$$E=mc^2$$</pre>');
  });

  it("should support gather multline and cases environments", function () {
    const input = [
      "<p>\\begin{gather} a=b \\\\ c=d \\end{gather}</p>",
      "<p>\\begin{multline} x+y+z \\\\ = k \\end{multline}</p>",
      "<p>\\begin{cases} x^2,&x>0 \\\\ 0,&x\\le 0 \\end{cases}</p>",
    ].join("");

    const result = fixMathInNoteHtml(input);

    assert.include(result.html, '<pre class="math">$$a=b \\\\ c=d$$</pre>');
    assert.include(result.html, '<pre class="math">$$x+y+z \\\\ = k$$</pre>');
    assert.include(
      result.html,
      '<pre class="math">$$x^2,&amp;x&gt;0 \\\\ 0,&amp;x\\le 0$$</pre>',
    );
  });

  it("should normalize double-escaped latex commands inside formulas", function () {
    const input = [
      "<p>$$Z = \\\\frac{x-\\\\mu}{\\\\sigma}$$</p>",
      "<p>行内公式 $\\\\alpha + \\\\beta$ 也应修复。</p>",
    ].join("");

    const result = fixMathInNoteHtml(input);

    assert.include(
      result.html,
      '<pre class="math">$$Z = \\frac{x-\\mu}{\\sigma}$$</pre>',
    );
    assert.include(
      result.html,
      '<span class="math">$\\alpha + \\beta$</span> 也应修复。',
    );
  });

  it("should keep latex line-break markers while normalizing commands", function () {
    const input = ["<p>$$a \\\\ b$$</p>"].join("");
    const result = fixMathInNoteHtml(input);
    assert.include(result.html, '<pre class="math">$$a \\\\ b$$</pre>');
  });

  it("should remove separator-only lines inside block formulas", function () {
    const input = [
      "<p>$$<br>\\mu_1^{i+1}(x)<br>==============<br>\\tilde{\\mu}_1^i(x) * K_1(x)<br>$$</p>",
      "<p>\\[<br>a-b<br>------<br>c+d<br>\\]</p>",
    ].join("");

    const result = fixMathInNoteHtml(input);

    assert.include(
      result.html,
      '<pre class="math">$$\\mu_1^{i+1}(x)\n\\tilde{\\mu}_1^i(x) * K_1(x)$$</pre>',
    );
    assert.include(result.html, '<pre class="math">$$a-b\nc+d$$</pre>');
  });

  it("should convert code-block wrapped standalone block formula", function () {
    const input = [
      "<pre><code>$$\n\\Delta\\gamma_t=\\gamma_{t,co}-\\gamma_{t,pre}\n$$</code></pre>",
    ].join("");

    const result = fixMathInNoteHtml(input);

    assert.include(
      result.html,
      '<pre class="math">$$\\Delta\\gamma_t=\\gamma_{t,co}-\\gamma_{t,pre}$$</pre>',
    );
    assert.equal(result.stats.blockFixed, 1);
  });

  it("should convert plain pre wrapped standalone block formula", function () {
    const input = [
      "<pre>$$\n\\Delta\\gamma_t=\\gamma_{t,co}-\\gamma_{t,pre}\n$$</pre>",
    ].join("");

    const result = fixMathInNoteHtml(input);

    assert.include(
      result.html,
      '<pre class="math">$$\\Delta\\gamma_t=\\gamma_{t,co}-\\gamma_{t,pre}$$</pre>',
    );
    assert.equal(result.stats.blockFixed, 1);
  });

  it("should unwrap backtick-wrapped pure formulas before fixing", function () {
    const input = [
      "<p><code>$$Var(\\hat{\\gamma})\\geq\\frac{1-|\\gamma|^2}{2m}$$</code></p>",
    ].join("");

    const result = fixMathInNoteHtml(input);

    assert.include(
      result.html,
      '<pre class="math">$$Var(\\hat{\\gamma})\\geq\\frac{1-|\\gamma|^2}{2m}$$</pre>',
    );
    assert.equal(result.stats.blockFixed, 1);
  });

  it("should recover block formulas fragmented into heading and paragraphs", function () {
    const input = [
      "<p>$$</p>",
      "<h1>\\hat{\\mathbf{d}}</h1>",
      "<p>\\arg\\min_{\\mathbf{d}}</p>",
      "<p>\\left[</p>",
      "<p>\\sum_x D_x(d(x))</p>",
      "<p>+</p>",
      "<p>\\beta \\sum_{x\\sim y}\\psi(d(x),d(y))</p>",
      "<p>\\right]</p>",
      "<p>$$</p>",
    ].join("");

    const result = fixMathInNoteHtml(input);

    assert.include(
      result.html,
      '<pre class="math">$$\\hat{\\mathbf{d}}\n\\arg\\min_{\\mathbf{d}}\n\\left[\n\\sum_x D_x(d(x))\n+\n\\beta \\sum_{x\\sim y}\\psi(d(x),d(y))\n\\right]$$</pre>',
    );
    assert.equal(result.stats.blockFixed, 1);
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
