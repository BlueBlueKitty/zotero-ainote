import { config } from "../../package.json";
import { PDFExtractor } from "./pdfExtractor";
import AIService, { AIRequestCanceledError, CancelSignal } from "./aiService";
import { OutputWindow } from "./outputWindow";
import { OutputWindowManager } from "./outputWindowManager";
import { getPref } from "../utils/prefs";
import { getString } from "../utils/locale";
import { parseProfiles, ProviderType } from "./llmProfiles";
import {
  buildSummaryHeading,
  ensurePromptTemplateState,
  ensureSummaryHeading,
  getActivePromptTemplate,
  PromptTemplate,
  stripLeadingSummaryHeading,
} from "../utils/prompts";
import { buildNoteHtmlFromMarkdown } from "./noteHtmlBuilder";

const PROVIDER_LABELS: Record<ProviderType, string> = {
  chatgpt_web: "ChatGPT 网页版",
  azure: "Azure OpenAI",
  anthropic: "Anthropic Claude",
  gemini: "Google Gemini",
  deepseek: "DeepSeek",
  openai_compatible: "OpenAI [Chat Completions 接口]",
  openai: "OpenAI [Responses 接口]",
};

export interface NoteGenerationTarget {
  item: Zotero.Item;
  preferredPdfAttachment?: Zotero.Item;
  templateId?: string;
}

export class NoteGenerator {
  private static getActiveProfile() {
    const profiles = parseProfiles(getPref("profiles"));
    const activeId = String(getPref("activeProfileId") || "").trim();
    return profiles.find((profile) => profile.id === activeId) || profiles[0] || null;
  }

  private static getProviderLabel(providerType: ProviderType): string {
    return PROVIDER_LABELS[providerType] || providerType;
  }

  private static getModelLabel(activeProfile: ReturnType<typeof NoteGenerator.getActiveProfile>): string {
    const model = String(activeProfile?.model || "").trim();
    if (!model) {
      throw new Error("当前活动模型配置缺少模型名称，请先在设置中填写模型名称");
    }
    const profileName = String(activeProfile?.name || "").trim();
    if (profileName) {
      return `${profileName} / ${model}`;
    }
    return `${this.getProviderLabel(activeProfile.providerType)} / ${model}`;
  }

  /**
   * Generate AI summary note for a single item
   * @param item Zotero item
   * @param outputWindow Optional output window for streaming display
   * @param progressCallback Optional progress callback
   * @returns Created note item with final content
   */
  public static async generateNoteForItem(
    target: NoteGenerationTarget,
    outputWindow?: OutputWindow,
    progressCallback?: (message: string, progress: number) => void,
    setCancelCurrentFn?: (fn: () => void) => void,
    onStreamChunk?: (chunk: string) => void,
  ): Promise<{ note: Zotero.Item; content: string }> {
    const { item, preferredPdfAttachment } = target;
    const itemTitle = item.getField("title") as string;
    let note: Zotero.Item | null = null;
    let fullContent = "";
    let receivedStreamChunk = false;
    let currentItemCanceled = false;
    const cancelListeners = new Set<() => void>();
    const cancelSignal: CancelSignal = {
      isCanceled: () => currentItemCanceled,
      onCancel: (callback: () => void) => {
        cancelListeners.add(callback);
        return () => cancelListeners.delete(callback);
      },
      getReason: () => getString("summary-canceled-unsaved" as any),
    };
    const cancelCurrentItem = () => {
      if (currentItemCanceled) return;
      currentItemCanceled = true;
      cancelListeners.forEach((listener) => {
        try {
          listener();
        } catch {
          // ignore
        }
      });
    };
    const ensureNotCanceled = () => {
      if (currentItemCanceled) {
        throw new AIRequestCanceledError(getString("summary-canceled-unsaved" as any));
      }
    };

    try {
      const activeProfile = this.getActiveProfile();
      if (!activeProfile) {
        throw new Error("请先在设置中创建并激活模型配置");
      }
      const modelLabel = this.getModelLabel(activeProfile);
      const promptTemplate = target.templateId
        ? (
            ensurePromptTemplateState(
              getPref("promptTemplates" as any),
              getPref("activePromptTemplateId" as any),
              getPref("promptTemplatesVersion" as any),
            ).templates.find(
              (template: PromptTemplate) => template.id === target.templateId,
            ) ||
            getActivePromptTemplate(
              getPref("promptTemplates" as any),
              getPref("activePromptTemplateId" as any),
              getPref("promptTemplatesVersion" as any),
            )
          )
        : getActivePromptTemplate(
            getPref("promptTemplates" as any),
            getPref("activePromptTemplateId" as any),
            getPref("promptTemplatesVersion" as any),
          );
      const summaryHeading = buildSummaryHeading(promptTemplate.name, itemTitle);

      // 将当前条目的取消函数注册到 Manager，确保窗口重开后停止按钮仍然有效
      if (setCancelCurrentFn) {
        setCancelCurrentFn(cancelCurrentItem);
      }
      // 如果有输出窗口，先开始显示这个条目，后续提示和内容都写入当前条目区域
      if (outputWindow) {
        await outputWindow.startItem(itemTitle, modelLabel);
        OutputWindowManager.recordItemStart(itemTitle, modelLabel);
        outputWindow.setOnStopCurrent(cancelCurrentItem);
        outputWindow.appendContent(`${summaryHeading}\n\n`);
      }

      let requestContent = "";
      let contentMode: "text" | "pdf-base64" = "text";
      const modeResolution = AIService.resolvePdfProcessMode(activeProfile);
      if (modeResolution.fallbackReason) {
        ztoolkit.log(`[AiNote] ${modeResolution.fallbackReason}`);
        if (outputWindow) {
          outputWindow.appendContent(`\n\n> **提示**: ${modeResolution.fallbackReason}\n\n`);
        }
      }

      const enablePdfSizeLimit = !!activeProfile.extra?.enablePdfSizeLimit;
      if (enablePdfSizeLimit) {
        const maxPdfSizeMB =
          parseFloat(activeProfile.extra?.maxPdfSizeMB || "50") || 50;
        const fileSizeMB = await this.getPdfFileSize(item, preferredPdfAttachment);
        if (fileSizeMB > maxPdfSizeMB) {
          throw new Error(
            `PDF 文件过大（${fileSizeMB.toFixed(1)} MB），超过当前配置限制 ${maxPdfSizeMB} MB`,
          );
        }
      }

      if (modeResolution.actual === "base64") {
        progressCallback?.(getString("progress-reading-pdf" as any), 10);
        requestContent = await PDFExtractor.extractBase64FromItem(
          item,
          preferredPdfAttachment,
        );
        contentMode = "pdf-base64";
      } else {
        progressCallback?.(getString("progress-extracting"), 10);
        const fullText = await PDFExtractor.extractTextFromItem(
          item,
          preferredPdfAttachment,
        );
        const cleanedText = PDFExtractor.cleanText(fullText);

        const truncateLengthStr =
          activeProfile.extra?.textTruncateLengthWan ||
          ((getPref("truncateLength") as string) || "10");
        const truncateLengthInWan = parseInt(truncateLengthStr) || 10;
        const truncateLength = truncateLengthInWan * 10000;
        requestContent = PDFExtractor.truncateText(cleanedText, truncateLength);
        contentMode = "text";

        if (cleanedText.length > truncateLength) {
          const truncationMessage = `文献内容过长（${cleanedText.length} 字符），已优先在句号处截断至前 ${truncateLength.toLocaleString()} 字符附近（${truncateLengthInWan} 万字符）进行处理`;
          ztoolkit.log(`[AiNote] ${truncationMessage}`);
          if (outputWindow) {
            outputWindow.appendContent(`\n\n> **注意**: ${truncationMessage}\n\n`);
          }
          new ztoolkit.ProgressWindow("AiNote - 内容截断提醒", { closeTime: 5000 })
            .createLine({ text: truncationMessage, type: "fail" })
            .show();
          progressCallback?.(truncationMessage, 30);
        }
      }

      ensureNotCanceled();

      progressCallback?.(getString("progress-generating"), 40);

      // 定义流式输出回调
      const onProgress = async (chunk: string) => {
        receivedStreamChunk = true;
        fullContent += chunk;
        if (outputWindow) {
          OutputWindowManager.recordItemContent(chunk);
        }
        onStreamChunk?.(chunk);
        if (outputWindow) {
          outputWindow.appendContent(chunk);
        }
      };

      // 调用 AI 服务生成总结
      const summary = await AIService.generateSummary(
        requestContent,
        contentMode,
        promptTemplate.content,
        onProgress,
        cancelSignal,
      );

      fullContent = ensureSummaryHeading(summary, summaryHeading);

      // 某些 PDF/Base64 请求会直接返回完整结果而不触发增量分片。
      // 这时需要把最终结果补写到输出窗口，否则窗口会显示“完成”但正文为空。
      if (outputWindow && !receivedStreamChunk && summary) {
        outputWindow.appendContent(
          stripLeadingSummaryHeading(fullContent, summaryHeading),
        );
        OutputWindowManager.recordItemContent(
          stripLeadingSummaryHeading(fullContent, summaryHeading),
        );
      }

      ensureNotCanceled();

      progressCallback?.(getString("progress-creating"), 80);

      // 创建笔记并保存内容
      const noteContent = this.formatNoteContent(summaryHeading, modelLabel, fullContent);
      note = await this.createNote(item, noteContent);

      // 如果有输出窗口，标记完成
      if (outputWindow) {
        outputWindow.finishItem();
        OutputWindowManager.recordItemComplete();
      }

      progressCallback?.(getString("progress-complete"), 100);

      return { note, content: fullContent };
    } catch (error: any) {
      if (error instanceof AIRequestCanceledError) {
        ztoolkit.log(`[AiNote] Current item canceled by user: "${itemTitle}"`);
        if (outputWindow) {
          outputWindow.stopCurrentItem(getString("summary-canceled-unsaved" as any));
          OutputWindowManager.recordItemCanceled();
        }
        throw error;
      }

      ztoolkit.log(
        `[AiNote] Error generating note for "${itemTitle}":`,
        error
      );

      // 如果有输出窗口，显示错误
      if (outputWindow) {
        outputWindow.showError(itemTitle, error.message);
        OutputWindowManager.recordItemError(itemTitle, error.message);
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
    summaryHeading: string,
    modelLabel: string,
    summary: string
  ): string {
    const normalizedSummary = ensureSummaryHeading(summary, summaryHeading);
    const noteBody = stripLeadingSummaryHeading(normalizedSummary, summaryHeading);
    return buildNoteHtmlFromMarkdown(summaryHeading, modelLabel, noteBody);
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

  private static async getPdfFileSize(
    item: Zotero.Item,
    preferredPdfAttachment?: Zotero.Item,
  ): Promise<number> {
    try {
      const attachment = await PDFExtractor.resolvePdfAttachment(
        item,
        preferredPdfAttachment,
      );
      const pdfPath = await attachment.getFilePathAsync();
      if (!pdfPath) return 0;
      const fileInfo = await IOUtils.stat(pdfPath);
      return (fileInfo.size ?? 0) / (1024 * 1024);
    } catch {
      return 0;
    }
  }

  /**
   * Generate AI summary notes for multiple items
   * @param items Array of Zotero items
   * @param progressCallback Progress callback with (current, total, progress, message)
   */
  public static async generateNotesForItems(
    targets: NoteGenerationTarget[],
    progressCallback?: (
      current: number,
      total: number,
      progress: number,
      message: string
    ) => void
  ): Promise<void> {
    const total = targets.length;
    let successCount = 0;
    let failedCount = 0;
    let canceledCount = 0;
    let stopped = false; // 标记是否被用户停止
    // 可变的取消函数引用，随每个条目更新，通过 Manager 持久化以便窗口重开仍有效
    let cancelCurrentFn: (() => void) | null = null;

    // 创建并打开输出窗口（通过 Manager 管理）
    const outputWindow = await OutputWindowManager.startBatch('ai-summary', total);
    OutputWindowManager.setOnStop(() => {
      stopped = true;
    });
    OutputWindowManager.setOnStopCurrent(() => {
      cancelCurrentFn?.();
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

        const target = targets[i];
        const item = target.item;
        const current = i + 1;
        const itemTitle = item.getField("title") as string;

        try {
          // 生成笔记（带流式输出）
          await this.generateNoteForItem(
            target,
            outputWindow,
            (message, progress) => {
              progressCallback?.(current, total, progress, message);
            },
            (fn) => { cancelCurrentFn = fn; },
          );

          successCount++;
        } catch (error: any) {
          if (error instanceof AIRequestCanceledError) {
            canceledCount++;
            progressCallback?.(
              current,
              total,
              100,
              getString("summary-canceled-continue-next" as any),
            );
          } else {
            failedCount++;
            ztoolkit.log(`[AiNote] Failed to process "${itemTitle}":`, error);
          }
        }
      }

      // 显示完成消息
      if (stopped) {
        // 如果被停止，显示停止消息和统计
        const notProcessed = total - successCount - failedCount - canceledCount;
        OutputWindowManager.recordStopped();
        outputWindow.disableStopButton(true); // 传入 true 表示是停止状态
        outputWindow.showStopped(successCount, failedCount, notProcessed, canceledCount);
        progressCallback?.(
          total,
          total,
          100,
          getString("summary-batch-stopped-detail" as any, {
            args: {
              success: successCount,
              failed: failedCount,
              canceled: canceledCount,
              notProcessed,
            },
          }),
        );
      } else {
        outputWindow.disableStopButton(false); // 传入 false 表示正常完成
        outputWindow.showComplete(successCount, total, canceledCount);

        // 通知进度回调完成
        if (failedCount === 0 && canceledCount === 0) {
          progressCallback?.(total, total, 100, getString("summary-batch-all-complete" as any));
        } else if (successCount === 0) {
          progressCallback?.(
            total,
            total,
            100,
            canceledCount > 0
              ? getString("summary-batch-all-canceled-or-failed" as any)
              : getString("summary-batch-all-failed" as any),
          );
        } else {
          progressCallback?.(
            total,
            total,
            100,
            getString("summary-batch-mixed-result" as any, {
              args: { success: successCount, failed: failedCount, canceled: canceledCount },
            }),
          );
        }
      }
      
      OutputWindowManager.endBatch();
    } catch (error: any) {
      // 禁用停止按钮
      outputWindow.disableStopButton(false);
      ztoolkit.log("[AiNote] Error in generateNotesForItems:", error);
      throw error;
    }
  }
}
