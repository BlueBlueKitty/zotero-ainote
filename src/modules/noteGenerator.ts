import { config } from "../../package.json";
import { PDFExtractor } from "./pdfExtractor";
import AIService from "./aiService";
import { OutputWindow } from "./outputWindow";

export class NoteGenerator {
  /**
   * Generate AI summary note for a single item
   * @param item Zotero item
   * @param outputWindow Optional output window for streaming display
   * @param progressCallback Optional progress callback
   * @returns Created note item with final content
   */
  public static async generateNoteForItem(
    item: Zotero.Item,
    outputWindow?: OutputWindow,
    progressCallback?: (message: string, progress: number) => void
  ): Promise<{ note: Zotero.Item; content: string }> {
    const itemTitle = item.getField("title") as string;
    let note: Zotero.Item | null = null;
    let fullContent = "";

    try {
      // Update progress
      progressCallback?.("正在提取PDF文本...", 10);

      // Extract PDF text
      const fullText = await PDFExtractor.extractTextFromItem(item);
      const cleanedText = PDFExtractor.cleanText(fullText);
      const truncatedText = PDFExtractor.truncateText(cleanedText);

      progressCallback?.("正在生成AI总结...", 40);

      // 如果有输出窗口，开始显示这个条目
      if (outputWindow) {
        outputWindow.startItem(itemTitle);
      }

      // 定义流式输出回调
      const onProgress = async (chunk: string) => {
        fullContent += chunk;
        if (outputWindow) {
          outputWindow.appendContent(chunk);
        }
      };

      // 调用 AI 服务生成总结
      const summary = await AIService.generateSummary(
        truncatedText,
        undefined,
        onProgress
      );

      fullContent = summary; // 确保使用完整内容

      progressCallback?.("正在创建笔记...", 80);

      // 创建笔记并保存内容
      const noteContent = this.formatNoteContent(itemTitle, fullContent);
      note = await this.createNote(item, noteContent);
      await note.saveTx();

      // 如果有输出窗口，标记完成
      if (outputWindow) {
        outputWindow.finishItem();
      }

      progressCallback?.("完成！", 100);

      return { note, content: fullContent };
    } catch (error: any) {
      ztoolkit.log(
        `[AiNote] Error generating note for "${itemTitle}":`,
        error
      );

      // 如果出错，仍然尝试创建一个包含错误信息的笔记
      if (!note) {
        const errorMsg = `<h3>AI 总结</h3><p>错误: ${error.message}</p>`;
        note = await this.createNote(item, errorMsg);
        await note.saveTx();
      }

      // 如果有输出窗口，显示错误
      if (outputWindow) {
        outputWindow.showError(itemTitle, error.message);
      }

      throw error;
    }
  }

  /**
   * Format note content with title and summary
   * @param itemTitle Item title
   * @param summary AI generated summary
   * @returns Formatted HTML content
   */
  private static formatNoteContent(
    itemTitle: string,
    summary: string
  ): string {
    const htmlContent = this.convertMarkdownToHTML(summary);
    return `<h2>AI 总结 - ${this.escapeHtml(itemTitle)}</h2>
<div>${htmlContent}</div>`;
  }

  /**
   * Convert Markdown text to simple HTML
   * @param markdown Markdown text
   * @returns HTML string
   */
  private static convertMarkdownToHTML(markdown: string): string {
    let html = markdown;

    // 转换 LaTeX 公式格式为 Zotero 识别的 HTML 格式
    // 块级公式：\[ ... \] → <pre class="math">$$...$$</pre>
    html = html.replace(/\\\[([\s\S]*?)\\\]/g, (match, formula) => {
      return `<pre class="math">$$${formula}$$</pre>`;
    });
    // 块级公式：$$ ... $$ → <pre class="math">$$...$$</pre>
    html = html.replace(/\$\$([\s\S]*?)\$\$/g, (match, formula) => {
      return `<pre class="math">$$${formula}$$</pre>`;
    });

    // 行内公式：\( ... \) → <span class="math">$...$</span>
    html = html.replace(/\\\((.*?)\\\)/g, (match, formula) => {
      return `<span class="math">$${formula}$</span>`;
    });
    // 行内公式：$ ... $ → <span class="math">$...$</span>
    // eslint-disable-next-line no-useless-escape
    html = html.replace(/\$([^\$\n]+?)\$/g, (match, formula) => {
      return `<span class="math">$${formula}$</span>`;
    });

    // 处理转义字符
    html = html
      .replace(/\\\*/g, "&#42;") // 转义的星号
      .replace(/\\_/g, "&#95;"); // 转义的下划线

    // 处理水平分隔线（在处理其他内容之前）
    html = html.replace(/^---+$/gm, "<hr style='border: none; border-top: 2px solid #59c0bc; margin: 20px 0;'>");
    html = html.replace(/^\*\*\*+$/gm, "<hr style='border: none; border-top: 2px solid #59c0bc; margin: 20px 0;'>");
    html = html.replace(/^___+$/gm, "<hr style='border: none; border-top: 2px solid #59c0bc; margin: 20px 0;'>");

    // 处理标题（从长到短，避免误匹配）
    html = html.replace(/^#### (.*$)/gim, "<h4>$1</h4>");
    html = html.replace(/^### (.*$)/gim, "<h3>$1</h3>");
    html = html.replace(/^## (.*$)/gim, "<h2>$1</h2>");
    html = html.replace(/^# (.*$)/gim, "<h1>$1</h1>");

    // 处理粗体（先处理，避免与斜体冲突）
    html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    html = html.replace(/__(.+?)__/g, "<strong>$1</strong>");

    // 处理斜体
    html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");
    html = html.replace(/_(.+?)_/g, "<em>$1</em>");

    // 处理代码块
    html = html.replace(/```[\s\S]*?```/g, (match) => {
      const code = match.replace(/```\w*\n?/, "").replace(/```$/, "");
      return `<pre><code>${this.escapeHtml(code)}</code></pre>`;
    });

    // 处理行内代码
    html = html.replace(/`(.+?)`/g, "<code>$1</code>");

    // 分段处理
    const paragraphs = html.split(/\n\n+/);
    const processedParagraphs = paragraphs.map((para) => {
      para = para.trim();
      if (!para) return "";

      // 已经是 HTML 标签的跳过
      if (
        para.startsWith("<h") ||
        para.startsWith("<pre>") ||
        para.startsWith("<ul>") ||
        para.startsWith("<ol>")
      ) {
        return para;
      }

      // 处理列表
      const lines = para.split("\n");
      let inList = false;
      let listType = "";
      let result = "";

      for (let line of lines) {
        line = line.trim();
        if (!line) continue;

        // 无序列表
        if (line.match(/^[-*+]\s+/)) {
          if (!inList || listType !== "ul") {
            if (inList) result += `</${listType}>`;
            result += "<ul>";
            inList = true;
            listType = "ul";
          }
          result += `<li>${line.replace(/^[-*+]\s+/, "")}</li>`;
        }
        // 有序列表
        else if (line.match(/^\d+\.\s+/)) {
          if (!inList || listType !== "ol") {
            if (inList) result += `</${listType}>`;
            result += "<ol>";
            inList = true;
            listType = "ol";
          }
          result += `<li>${line.replace(/^\d+\.\s+/, "")}</li>`;
        }
        // 普通文本
        else {
          if (inList) {
            result += `</${listType}>`;
            inList = false;
            listType = "";
          }
          // 如果是标题或其他 HTML 标签，直接添加
          if (line.startsWith("<")) {
            result += line;
          } else {
            result += `<p>${line.replace(/\n/g, "<br>")}</p>`;
          }
        }
      }

      if (inList) {
        result += `</${listType}>`;
      }

      return result;
    });

    return processedParagraphs.join("\n");
  }

  /**
   * HTML escape
   */
  private static escapeHtml(text: string): string {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  /**
   * Create a new note for an item
   * @param item Parent item
   * @param initialContent Initial content for the note
   * @returns Created note item
   */
  private static async createNote(
    item: Zotero.Item,
    initialContent: string = ""
  ): Promise<Zotero.Item> {
    const note = new Zotero.Item("note");
    note.parentID = item.id;
    note.setNote(initialContent);
    note.addTag("AI-Generated");
    await note.saveTx();
    return note;
  }

  /**
   * Generate AI summary notes for multiple items
   * @param items Array of Zotero items
   * @param progressCallback Progress callback with (current, total, progress, message)
   */
  public static async generateNotesForItems(
    items: Zotero.Item[],
    progressCallback?: (
      current: number,
      total: number,
      progress: number,
      message: string
    ) => void
  ): Promise<void> {
    const total = items.length;
    let successCount = 0;
    let failedCount = 0;
    let stopped = false; // 标记是否被用户停止

    // 创建并打开输出窗口
    const outputWindow = new OutputWindow();
    await outputWindow.open();

    // 设置停止回调
    outputWindow.setOnStop(() => {
      ztoolkit.log("[AiNote] User stopped processing");
      stopped = true;
    });

    // 等待窗口完全初始化
    await Zotero.Promise.delay(200);

    try {
      for (let i = 0; i < total; i++) {
        // 检查是否被停止
        if (stopped) {
          ztoolkit.log("[AiNote] Processing stopped by user");
          break;
        }

        const item = items[i];
        const current = i + 1;
        const itemTitle = item.getField("title") as string;

        try {
          // 生成笔记（带流式输出）
          await this.generateNoteForItem(
            item,
            outputWindow,
            (message, progress) => {
              progressCallback?.(current, total, progress, message);
            }
          );

          successCount++;
        } catch (error: any) {
          failedCount++;
          ztoolkit.log(`[AiNote] Failed to process "${itemTitle}":`, error);
        }
      }

      // 显示完成消息
      if (stopped) {
        // 如果被停止，显示停止消息和统计
        const notProcessed = total - successCount - failedCount;
        outputWindow.disableStopButton(true); // 传入 true 表示是停止状态
        outputWindow.showStopped(successCount, failedCount, notProcessed);
        progressCallback?.(total, total, 100, `已停止 (已完成 ${successCount} 个，失败 ${failedCount} 个，未处理 ${notProcessed} 个)`);
      } else {
        outputWindow.disableStopButton(false); // 传入 false 表示正常完成
        outputWindow.showComplete(successCount, total);

        // 通知进度回调完成
        if (failedCount === 0) {
          progressCallback?.(total, total, 100, "所有条目处理完成");
        } else if (successCount === 0) {
          progressCallback?.(total, total, 100, "所有条目处理失败");
        } else {
          progressCallback?.(total, total, 100, `${successCount} 个成功，${failedCount} 个失败`);
        }
      }
    } catch (error: any) {
      // 禁用停止按钮
      outputWindow.disableStopButton(false);
      ztoolkit.log("[AiNote] Error in generateNotesForItems:", error);
      throw error;
    }
  }
}
