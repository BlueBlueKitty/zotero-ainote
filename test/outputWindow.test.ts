import { assert } from "chai";
import { OutputWindow } from "../src/modules/outputWindow";

describe("outputWindow", function () {
  it("should escape restored display formulas in preview html", function () {
    const html = OutputWindow.convertMarkdownToDisplayHTML(
      [
        "下面的公式",
        "",
        "$$M(i,j)=",
        "\\begin{cases}",
        "1, & I(i,j)\\geq t \\\\",
        "0, & I(i,j)<t",
        "\\end{cases}$$",
      ].join("\n"),
    );

    assert.match(html, /<div[^>]*class="[^"]*\bainote-display-math\b[^"]*"[^>]*>/);
    assert.include(
      html,
      "$$M(i,j)=\n\\begin{cases}\n1, &amp; I(i,j)\\geq t \\\\\n0, &amp; I(i,j)&lt;t\n\\end{cases}$$",
    );
    assert.notInclude(html, "<t");
  });

  it("should preserve html-sensitive characters across common display math shapes", function () {
    const cases = [
      {
        markdown: [
          "$$\\begin{align}",
          "a &< b \\\\",
          "c &> d",
          "\\end{align}$$",
        ].join("\n"),
        expected:
          "$$\\begin{align}\na &amp;&lt; b \\\\\nc &amp;&gt; d\n\\end{align}$$",
      },
      {
        markdown: [
          "$$\\begin{matrix}",
          "1 & 2 \\\\",
          "3 & 4",
          "\\end{matrix}$$",
        ].join("\n"),
        expected:
          "$$\\begin{matrix}\n1 &amp; 2 \\\\\n3 &amp; 4\n\\end{matrix}$$",
      },
      {
        markdown: String.raw`\[f(x) < g(y) \text{"quoted" & value}\]`,
        expected: String.raw`$$f(x) &lt; g(y) \text{&quot;quoted&quot; &amp; value}$$`,
      },
    ];

    for (const testCase of cases) {
      const html = OutputWindow.convertMarkdownToDisplayHTML(testCase.markdown);

      assert.match(html, /<div[^>]*class="[^"]*\bainote-display-math\b[^"]*"[^>]*>/);
      assert.include(html, testCase.expected);
      assert.notMatch(html, /<div[^>]*>\$\$[\s\S]*<[^/!$]/);
    }
  });

  it("should escape restored inline formulas in preview html", function () {
    const html = OutputWindow.convertMarkdownToDisplayHTML(
      String.raw`其中 \(x < y\)、\(a > b\) 与 \(\text{"quoted" & value}\) 都应正常预览。`,
    );

    assert.include(html, "$x &lt; y$");
    assert.include(html, "$a &gt; b$");
    assert.include(html, String.raw`$\text{&quot;quoted&quot; &amp; value}$`);
    assert.notInclude(html, "< y");
    assert.notInclude(html, "< value");
  });

  it("should not restore explicit inline delimiters that wrap plain chinese prose", function () {
    const html = OutputWindow.convertMarkdownToDisplayHTML(
      String.raw`说明：\(其中，T 表示像元值\)；以及 $$其中，D 表示变化量$$。`,
    );

    assert.notInclude(html, '<span class="math">$其中，T 表示像元值$</span>');
    assert.notInclude(html, '<span class="math">$其中，D 表示变化量$</span>');
    assert.include(html, "说明：(其中，T 表示像元值)");
    assert.include(html, String.raw`$$其中，D 表示变化量$$`);
  });
});
