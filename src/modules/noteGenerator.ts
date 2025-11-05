import { config } from "../../package.json";
import { PDFExtractor } from "./pdfExtractor";
import AIService from "./aiService";
import { OutputWindow } from "./outputWindow";
import { getPref } from "../utils/prefs";

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
      
      // 获取用户配置的截断长度（单位：万字符）
      const truncateLengthStr = (getPref("truncateLength") as string) || "10";
      const truncateLengthInWan = parseInt(truncateLengthStr) || 10;
      const truncateLength = truncateLengthInWan * 10000; // 转换为实际字符数
      
      const truncatedText = PDFExtractor.truncateText(cleanedText, truncateLength);

      // 检查文本是否被截断并提示用户
      if (cleanedText.length > truncateLength) {
        const truncationMessage = `文献内容过长（${cleanedText.length} 字符），已截断至前 ${truncateLength.toLocaleString()} 字符（${truncateLengthInWan} 万字符）进行处理`;
        ztoolkit.log(`[AiNote] ${truncationMessage}`);
        
        // 在输出窗口显示提示
        if (outputWindow) {
          outputWindow.appendContent(`\n\n> **注意**: ${truncationMessage}\n\n`);
        }
        
        // 添加弹出窗口提醒
        new ztoolkit.ProgressWindow("AiNote - 内容截断提醒", { closeTime: 5000 })
          .createLine({ text: truncationMessage, type: "fail" })
          .show();
        
        // 进度回调提示
        progressCallback?.(truncationMessage, 30);
      }

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

      // 如果有输出窗口，显示错误
      if (outputWindow) {
        outputWindow.showError(itemTitle, error.message);
      }

      // 不创建包含错误的笔记，直接抛出错误
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
    // 转换为笔记格式
    const htmlContent = this.convertMarkdownToNoteHTML(summary);
    return `<h2>AI 总结 - ${this.escapeHtml(itemTitle)}</h2>
<div>${htmlContent}</div>`;
  }

    /**
   * 将 Markdown 转换为适合 Zotero 笔记的 HTML 格式
   * @param markdown Markdown 文本
   * @returns 转换后的 HTML（无样式，公式格式适配 Zotero）
   */
  private static convertMarkdownToNoteHTML(markdown: string): string {
    // 复用 OutputWindow 的转换方法（会保护公式并转换 Markdown）
    let html = OutputWindow.convertMarkdownToHTMLCore(markdown);
    
    // 移除所有内联样式
    html = html.replace(/\s+style="[^"]*"/g, '');
    
    // 将 MathJax 格式的公式转换为 Zotero 笔记格式
    // 块级公式：$$...$$ → <pre class="math">$$...$$</pre>
    html = html.replace(/\$\$([\s\S]*?)\$\$/g, (_match: string, formula: string) => {
      return `<pre class="math">$$${formula}$$</pre>`;
    });
    
    // 行内公式：$...$ → <span class="math">$...$</span>
    // eslint-disable-next-line no-useless-escape
    html = html.replace(/\$([^\$\n]+?)\$/g, (_match: string, formula: string) => {
      return `<span class="math">$${formula}$</span>`;
    });
    
    return html;
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
    let windowClosed = false; // 标记输出窗口是否被关闭

    // 创建并打开输出窗口
    const outputWindow = new OutputWindow();
    await outputWindow.open();

    // 设置停止回调
    outputWindow.setOnStop(() => {
      stopped = true;
    });

    // 设置窗口关闭回调
    outputWindow.setOnClose(() => {
      windowClosed = true;
      // 显示后台继续处理的通知
      new ztoolkit.ProgressWindow("AiNote", { closeTime: 3000 })
        .createLine({
          text: "输出窗口已关闭,AI 生成将在后台继续进行",
          type: "default",
        })
        .show();
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
