import { assert } from "chai";
import { buildNoteHtmlFromMarkdown } from "../src/modules/noteHtmlBuilder";
import { NoteSchemaExtractor } from "../src/modules/noteSchemaExtractor";

describe("noteHtmlBuilder", function () {
  it("should build zotero note html from markdown", function () {
    const html = buildNoteHtmlFromMarkdown(
      "AI全文总结：示例论文",
      "ChatGPT Web",
      "这是一个段落。\n\n- 要点一\n- 要点二\n\n公式 $E=mc^2$",
    );

    assert.include(html, "<h2>AI全文总结：示例论文</h2>");
    assert.include(html, "<strong>模型：</strong>ChatGPT Web");
    assert.include(html, "<li>要点一</li>");
    assert.include(html, '<span class="math">$E=mc^2$</span>');
  });

  it("should unwrap backtick-wrapped pure block formula in markdown", function () {
    const html = buildNoteHtmlFromMarkdown(
      "AI全文总结：示例论文",
      "ChatGPT Web",
      "`$$Var(\\hat{\\gamma})\\geq\\frac{1-|\\gamma|^2}{2m}$$`",
    );

    assert.notInclude(html, "<code>");
    assert.include(
      html,
      '<pre class="math">$$Var(\\hat{\\gamma})\\geq\\frac{1-|\\gamma|^2}{2m}$$</pre>',
    );
  });

  it("should convert text-fenced web summary math into zotero renderable math blocks", function () {
    const html = buildNoteHtmlFromMarkdown(
      "AI全文总结：示例论文",
      "ChatGPT Web",
      [
        "```text",
        "$$M(i,j)=",
        "\\begin{cases}",
        "1, & I(i,j)\\geq t \\\\",
        "0, & I(i,j)<t",
        "\\end{cases}$$",
        "```",
      ].join("\n"),
    );

    assert.notInclude(html, "<code>");
    assert.include(
      html,
      '<pre class="math">$$M(i,j)=\n\\begin{cases}\n1, &amp; I(i,j)\\geq t \\\\\n0, &amp; I(i,j)&lt;t\n\\end{cases}$$</pre>',
    );
  });

  it("should convert language-math code blocks emitted by web summaries into math blocks", function () {
    const formulas = [
      String.raw`$$F_1(x_{ij},y_{ij})=F_0(x_{ij},y_{ij})+\sum_{c=1}^{N}W_c \times \left(r(x_{ij},y_{ij})+\Delta F_k\right)$$`,
      String.raw`$$I_{SDWI}=\ln\left(10 \times \sigma_{co-pol} \times \sigma_{cross-pol}\right)$$`,
      [
        String.raw`$$M(i,j)=`,
        String.raw`\begin{cases}`,
        String.raw`1, & I(i,j)\geq t \\`,
        String.raw`0, & I(i,j)<t`,
        String.raw`\end{cases}$$`,
      ].join("\n"),
    ];

    const expectedFragments = [
      String.raw`<pre class="math">$$F_1(x_{ij},y_{ij})=F_0(x_{ij},y_{ij})+\sum_{c=1}^{N}W_c \times \left(r(x_{ij},y_{ij})+\Delta F_k\right)$$</pre>`,
      String.raw`<pre class="math">$$I_{SDWI}=\ln\left(10 \times \sigma_{co-pol} \times \sigma_{cross-pol}\right)$$</pre>`,
      [
        String.raw`<pre class="math">$$M(i,j)=`,
        String.raw`\begin{cases}`,
        String.raw`1, &amp; I(i,j)\geq t \\`,
        String.raw`0, &amp; I(i,j)&lt;t`,
        String.raw`\end{cases}$$</pre>`,
      ].join("\n"),
    ];

    for (let index = 0; index < formulas.length; index++) {
      const html = buildNoteHtmlFromMarkdown(
        "AI全文总结：示例论文",
        "ChatGPT Web",
        ["```text", formulas[index], "```"].join("\n"),
      );

      assert.notInclude(html, "<code>");
      assert.include(html, expectedFragments[index]);
    }
  });

  it("should apply the shared math repair rules when building note html", function () {
    const html = buildNoteHtmlFromMarkdown(
      "AI全文总结：示例论文",
      "ChatGPT Web",
      [
        "显式公式 $$ (i,j) $$ 与 $$Note$$ 应直接转换。",
        "行内数学 $x$、$(i,j)$、$2x$、$10^{-3}$ 应转换。",
        "金额 $100、USD $100、$1,234.56 与普通文本 $OK$ 不应转换。",
      ].join("\n\n"),
    );

    assert.include(html, '<span class="math">$(i,j)$</span>');
    assert.include(html, '<span class="math">$Note$</span>');
    assert.include(html, '<span class="math">$x$</span>');
    assert.include(html, '<span class="math">$(i,j)$</span>');
    assert.include(html, '<span class="math">$2x$</span>');
    assert.include(html, '<span class="math">$10^{-3}$</span>');
    assert.include(html, "金额 $100、USD $100、$1,234.56 与普通文本 $OK$ 不应转换。");
  });

  it("should extract math-aware display and search text from note html", function () {
    const html = `
      <h2>Title</h2>
      <p>inline <span class="math">$a+b$</span> text</p>
      <pre class="math">$$E=mc^2$$</pre>
    `;
    const result = NoteSchemaExtractor.extract(html);
    assert.include(result.displayContent, "## Title");
    assert.include(result.displayContent, "$a+b$");
    assert.include(result.displayContent, "$$\nE=mc^2\n$$");
    assert.include(result.searchText.toLowerCase(), "e=mc^2");
  });
});
