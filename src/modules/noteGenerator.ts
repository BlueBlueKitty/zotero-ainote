import { config } from "../../package.json";
import { PDFExtractor } from "./pdfExtractor";
import AIService from "./aiService";
import { getNoteEditorWindowByNoteId } from "../utils/window";

export class NoteGenerator {
  // 为每个笔记维护一个内容缓冲区
  private static noteContentBuffers = new Map<number, string>();
  // 为每个笔记维护一个防抖定时器
  private static updateTimers = new Map<number, any>();
  // 更新间隔（毫秒）- 减少保存频率避免闪烁
  private static UPDATE_INTERVAL = 500;

  /**
   * Generate AI summary note for a single item
   * @param item Zotero item
   * @param progressCallback Optional progress callback
   * @returns Created note item
   */
  public static async generateNoteForItem(
    item: Zotero.Item,
    progressCallback?: (message: string, progress: number) => void
  ): Promise<Zotero.Item> {
    const itemTitle = item.getField("title") as string;
    let note: Zotero.Item | null = null;

    try {
      // Update progress
      progressCallback?.("正在提取PDF文本...", 10);

      // Extract PDF text
      const fullText = await PDFExtractor.extractTextFromItem(item);
      const cleanedText = PDFExtractor.cleanText(fullText);
      const truncatedText = PDFExtractor.truncateText(cleanedText);

      progressCallback?.("正在创建笔记并生成AI总结...", 40);

      // 1. 先创建一个空笔记
      note = await this.createNote(item, "<h3>AI 总结</h3><p></p>");
      await note.saveTx(); // 保存以获取ID
      
      // 初始化内容缓冲区
      this.noteContentBuffers.set(note.id, "");

      // 2. 定义 onProgress 回调（使用防抖减少保存频率）
      const onProgress = async (chunk: string) => {
        if (!note) return;
        
        // 将内容追加到缓冲区
        const currentBuffer = this.noteContentBuffers.get(note.id) || "";
        this.noteContentBuffers.set(note.id, currentBuffer + chunk);
        
        // 清除之前的定时器
        const existingTimer = this.updateTimers.get(note.id);
        if (existingTimer) {
          clearTimeout(existingTimer);
        }
        
        // 设置新的防抖定时器
        const timer = setTimeout(async () => {
          await this.updateNoteContent(note!);
          this.updateTimers.delete(note!.id);
        }, this.UPDATE_INTERVAL);
        
        this.updateTimers.set(note.id, timer);
      };

      // 3. 调用AI服务并传入回调
      await AIService.generateSummary(
        truncatedText,
        undefined,
        onProgress
      );

      // AI生成完成，清除所有定时器并执行最终保存
      if (note) {
        const existingTimer = this.updateTimers.get(note.id);
        if (existingTimer) {
          clearTimeout(existingTimer);
          this.updateTimers.delete(note.id);
        }
        
        // 最终保存
        await this.updateNoteContent(note, true);
        await note.saveTx();
        this.noteContentBuffers.delete(note.id);
      }

      progressCallback?.("完成！", 100);

      return note;
    } catch (error: any) {
      ztoolkit.log(`[AiNote] Error generating note for "${itemTitle}":`, error);

      // 如果出错，清理定时器并保存错误信息
      if (note) {
        const existingTimer = this.updateTimers.get(note.id);
        if (existingTimer) {
          clearTimeout(existingTimer);
          this.updateTimers.delete(note.id);
        }
        
        const errorMsg = `\n\n---\n**错误**: 为条目"${itemTitle}"生成笔记失败:\n${error.message}`;
        const currentBuffer = this.noteContentBuffers.get(note.id) || "";
        this.noteContentBuffers.set(note.id, currentBuffer + errorMsg);
        await this.updateNoteContent(note, true);
        await note.saveTx();
        this.noteContentBuffers.delete(note.id);
      }
      throw error;
    }
  }

  /**
   * Update note content from buffer
   * @param noteItem The note item to update
   * @param isFinal Whether this is the final update
   */
  private static async updateNoteContent(
    noteItem: Zotero.Item,
    isFinal: boolean = false
  ) {
    const buffer = this.noteContentBuffers.get(noteItem.id) || "";
    if (!buffer) return;
    
    // 将Markdown文本转换为HTML
    const htmlContent = this.convertMarkdownToHTML(buffer);
    const fullHTML = `<h3>AI 总结</h3>${htmlContent}`;
    
    noteItem.setNote(fullHTML);
    
    // 只在非最终更新时保存（最终更新由调用者保存）
    if (!isFinal) {
      await noteItem.saveTx();
    }
  }

  /**
   * Convert Markdown text to simple HTML
   * @param markdown Markdown text
   * @returns HTML string
   */
  private static convertMarkdownToHTML(markdown: string): string {
    if (!markdown) return "";
    
    let html = markdown;
    
    // 转义HTML特殊字符
    html = html
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    
    // 处理标题
    html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
    html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
    
    // 处理粗体和斜体
    html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
    
    // 处理行内代码
    html = html.replace(/`(.+?)`/g, '<code>$1</code>');
    
    // 处理水平线
    html = html.replace(/^---$/gm, '<hr>');
    
    // 处理列表
    const lines = html.split('\n');
    const processedLines: string[] = [];
    let inList = false;
    let listType = '';
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const unorderedMatch = line.match(/^[-*]\s+(.+)$/);
      const orderedMatch = line.match(/^\d+\.\s+(.+)$/);
      
      if (unorderedMatch) {
        if (!inList || listType !== 'ul') {
          if (inList) processedLines.push(`</${listType}>`);
          processedLines.push('<ul>');
          listType = 'ul';
          inList = true;
        }
        processedLines.push(`<li>${unorderedMatch[1]}</li>`);
      } else if (orderedMatch) {
        if (!inList || listType !== 'ol') {
          if (inList) processedLines.push(`</${listType}>`);
          processedLines.push('<ol>');
          listType = 'ol';
          inList = true;
        }
        processedLines.push(`<li>${orderedMatch[1]}</li>`);
      } else {
        if (inList) {
          processedLines.push(`</${listType}>`);
          inList = false;
          listType = '';
        }
        // 处理普通段落
        if (line.trim() === '') {
          processedLines.push('<p></p>');
        } else if (!line.match(/^<h[1-3]>/) && !line.match(/^<hr>/)) {
          processedLines.push(`<p>${line}</p>`);
        } else {
          processedLines.push(line);
        }
      }
    }
    
    if (inList) {
      processedLines.push(`</${listType}>`);
    }
    
    html = processedLines.join('\n');
    
    return html;
  }

  /**
   * Appends a chunk of text to the note content in a streaming-friendly way.
   * @deprecated This method is no longer used
   */
  private static async appendStreamContent(
    noteItem: Zotero.Item,
    chunk: string,
    editor?: any
  ) {
    if (!editor) {
      const noteWin = await getNoteEditorWindowByNoteId(noteItem.id);
      if (!noteWin) {
        // 如果编辑器窗口找不到,回退到旧的、较慢的更新方法
        const oldContent = noteItem.getNote();
        noteItem.setNote(oldContent + chunk);
        return;
      }
      editor = noteWin.document.querySelector(".editor");
    }

    if (editor && editor.editorInstance) {
      // 将 Markdown 块转换为 HTML
      // 清理多余的换行符，将单个换行符视作段落分隔
      const cleanedChunk = chunk.replace(/(\r\n|\n|\r)+/g, "\n").trim();
      if (cleanedChunk) {
        const htmlChunk = cleanedChunk
          .split("\n")
          .map((p) => (p ? `<p>${p}</p>` : ""))
          .join("");
        editor.editorInstance.insertHTML(htmlChunk);
        // 滚动到底部
        editor.editorInstance.focus();
        const selection = editor.ownerDocument.getSelection();
        selection?.collapseToEnd();
      }
    }
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
    note.parentKey = item.key;
    note.setNote(initialContent);
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
    progressCallback?: (current: number, total: number, progress: number, message: string) => void
  ): Promise<void> {
    const total = items.length;
    
    for (let i = 0; i < total; i++) {
      const current = i + 1;
      const item = items[i];
      
      try {
        await this.generateNoteForItem(item, (message, progress) => {
          progressCallback?.(current, total, progress, message);
        });
      } catch (error: any) {
        progressCallback?.(current, total, 100, `Error: ${error.message}`);
      }
    }
  }
}
