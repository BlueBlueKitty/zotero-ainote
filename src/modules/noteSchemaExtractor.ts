export interface NoteSchemaExtractResult {
  displayContent: string;
  searchText: string;
  warnings: string[];
  features: string[];
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function decodeMath(text: string, isBlock: boolean): string {
  const trimmed = text.trim();
  if (isBlock) {
    if (trimmed.startsWith("$$") && trimmed.endsWith("$$") && trimmed.length >= 4) {
      return trimmed.slice(2, -2).trim();
    }
    return trimmed;
  }
  if (trimmed.startsWith("$") && trimmed.endsWith("$") && trimmed.length >= 2) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function joinBlocks(blocks: string[]): string {
  return blocks.filter(Boolean).join("\n\n").trim();
}

export class NoteSchemaExtractor {
  public static extract(noteHTML: string): NoteSchemaExtractResult {
    const warnings: string[] = [];
    const features = new Set<string>();

    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(String(noteHTML || ""), "text/html");
      const root = doc.body as HTMLBodyElement | null;

      const blockToDisplay = (el: Element): string => {
        const tag = el.tagName.toLowerCase();
        if (/^h[1-6]$/.test(tag)) {
          features.add("heading");
          return `${"#".repeat(Number(tag.slice(1)))} ${inlineToText(el)}`.trim();
        }
        if (tag === "p") {
          return inlineToText(el);
        }
        if (tag === "blockquote") {
          features.add("blockquote");
          const inner = Array.from(el.children)
            .map((child) => blockToDisplay(child))
            .filter(Boolean)
            .join("\n");
          const text = inner || inlineToText(el);
          return text
            .split("\n")
            .map((line) => `> ${line}`)
            .join("\n");
        }
        if (tag === "pre" && el.classList.contains("math")) {
          features.add("math_display");
          const expr = decodeMath(el.textContent || "", true);
          return expr ? ["$$", expr, "$$"].join("\n") : "";
        }
        if (tag === "pre") {
          features.add("code_block");
          const code = el.textContent || "";
          return `\`\`\`\n${code.trimEnd()}\n\`\`\``;
        }
        if (tag === "hr") {
          features.add("hr");
          return "---";
        }
        if (tag === "ol" || tag === "ul") {
          features.add("list");
          const ordered = tag === "ol";
          const items = Array.from(el.children)
            .filter((child) => child.tagName.toLowerCase() === "li")
            .map((li, idx) => {
              const body = Array.from(li.children)
                .map((c) => blockToDisplay(c))
                .filter(Boolean)
                .join("\n");
              const itemText = body || inlineToText(li);
              return ordered ? `${idx + 1}. ${itemText}` : `- ${itemText}`;
            });
          return items.join("\n");
        }
        if (tag === "table") {
          features.add("table");
          const rows = Array.from(el.querySelectorAll("tr")) as Element[];
          return rows
            .map((row) =>
              Array.from(row.children)
                .map((cell) => inlineToText(cell))
                .join(" | "),
            )
            .filter(Boolean)
            .join("\n");
        }
        if (tag === "div" || tag === "section" || tag === "article") {
          const childBlocks = Array.from(el.children).map((child) => blockToDisplay(child));
          if (childBlocks.some(Boolean)) return joinBlocks(childBlocks);
          return inlineToText(el);
        }

        warnings.push(`unknown-block:${tag}`);
        return inlineToText(el);
      };

      const inlineToText = (el: Element): string => {
        const out: string[] = [];
        const walk = (node: Node) => {
          if (node.nodeType === Node.TEXT_NODE) {
            out.push(node.textContent || "");
            return;
          }
          if (node.nodeType !== Node.ELEMENT_NODE) return;
          const element = node as Element;
          const tag = element.tagName.toLowerCase();
          if (tag === "br") {
            out.push("\n");
            return;
          }
          if (tag === "span" && element.classList.contains("math")) {
            features.add("math_inline");
            const expr = decodeMath(element.textContent || "", false);
            out.push(expr ? `$${expr}$` : "");
            return;
          }
          if (tag === "span" && element.classList.contains("citation")) {
            features.add("citation");
            out.push(element.textContent || "");
            return;
          }
          if (tag === "span" && element.classList.contains("highlight")) {
            features.add("highlight");
          }
          if (tag === "span" && element.classList.contains("underline")) {
            features.add("underline_annotation");
          }
          if (tag === "img") {
            features.add("image");
            const alt = element.getAttribute("alt") || "";
            out.push(alt ? `[image:${alt}]` : "[image]");
            return;
          }
          if (tag === "a") {
            features.add("link");
            out.push(element.textContent || element.getAttribute("href") || "");
            return;
          }
          if (tag === "code") {
            features.add("code");
            out.push(`\`${element.textContent || ""}\``);
            return;
          }
          for (const child of Array.from(element.childNodes)) {
            if (child) walk(child);
          }
        };

        for (const child of Array.from(el.childNodes)) {
          if (child) walk(child);
        }
        return out.join("").trim();
      };

      if (!root) {
        return {
          displayContent: "",
          searchText: "",
          warnings: ["missing-body"],
          features: [],
        };
      }
      const blocks: string[] = [];
      for (const child of Array.from(root.childNodes)) {
        if (!child) continue;
        if (child.nodeType === Node.TEXT_NODE) {
          const text = normalizeWhitespace(child.textContent || "");
          if (text) blocks.push(text);
          continue;
        }
        if (child.nodeType === Node.ELEMENT_NODE) {
          blocks.push(blockToDisplay(child as Element));
        }
      }
      const displayContent = joinBlocks(blocks);
      const searchText = normalizeWhitespace(displayContent.replace(/[`#>*\-\[\]|]/g, " "));
      return {
        displayContent,
        searchText,
        warnings: Array.from(new Set(warnings)),
        features: Array.from(features),
      };
    } catch (error: any) {
      return {
        displayContent: String(noteHTML || ""),
        searchText: normalizeWhitespace(String(noteHTML || "").replace(/<[^>]+>/g, " ")),
        warnings: [`extract-failed:${error?.message || String(error)}`],
        features: [],
      };
    }
  }
}
