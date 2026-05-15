import { getPref } from "../utils/prefs";
import { getString } from "../utils/locale";
import { PDFExtractor } from "./pdfExtractor";
import { buildNoteHtmlFromMarkdown } from "./noteHtmlBuilder";
import { OutputWindow } from "./outputWindow";
import { OutputWindowManager } from "./outputWindowManager";
import { WebSummaryBridgeClient } from "./webSummaryBridgeClient";
import { buildConversationTitleFromItem } from "./webSummaryConversation";
import { WebSummaryRelationStore } from "./webSummaryRelations";
import {
  ClaimNextTaskResponse,
  CreateTaskRequest,
  WebSummaryChatGPTMode,
  WebSummaryConversationMeta,
  WebSummaryPlatform,
  WebSummaryTask,
} from "./webSummaryTypes";
import {
  buildSummaryHeading,
  ensurePromptTemplateState,
  getActivePromptTemplate,
  PromptTemplate,
  stripLeadingSummaryHeading,
} from "../utils/prompts";

export interface WebSummaryTarget {
  item: Zotero.Item;
  preferredPdfAttachment?: Zotero.Item;
  templateId?: string;
}

export interface WebSummaryRunResult {
  successCount: number;
  failedCount: number;
  canceledCount: number;
  stopped: boolean;
}

export interface WebSummarySingleRunHooks {
  onStage?: (stage: string, progress?: number) => void;
  onContent?: (content: string) => void;
  onCancelReady?: (cancelFn: () => void) => void;
}

const WEB_SUMMARY_MODEL_LABEL = "ChatGPT Web";
const EXTENSION_CLAIM_TIMEOUT_MS = 10000;
const EXTENSION_CLAIM_STALL_TIMEOUT_MS = 25000;
const EXTENSION_OPENING_CHAT_TIMEOUT_MS = 65000;

class WebSummaryCanceledError extends Error {
  constructor(message = getString("summary-canceled-unsaved" as any)) {
    super(message);
    this.name = "WebSummaryCanceledError";
  }
}

function sleep(ms: number): Promise<void> {
  return Zotero.Promise.delay(ms);
}

function getPromptTemplate(templateId?: string): PromptTemplate {
  const fallback = getActivePromptTemplate(
    getPref("promptTemplates" as any),
    getPref("activePromptTemplateId" as any),
    getPref("promptTemplatesVersion" as any),
  );
  if (!templateId) {
    return fallback;
  }
  return (
    ensurePromptTemplateState(
      getPref("promptTemplates" as any),
      getPref("activePromptTemplateId" as any),
      getPref("promptTemplatesVersion" as any),
    ).templates.find((template) => template.id === templateId) || fallback
  );
}

function createNote(
  item: Zotero.Item,
  initialContent: string,
): Promise<Zotero.Item> {
  const note = new Zotero.Item("note");
  note.parentID = item.id;
  note.setNote(initialContent);
  note.addTag("AI-Generated");
  return note.saveTx().then(() => note);
}

function toChatLink(
  platform: WebSummaryPlatform,
  meta: WebSummaryConversationMeta,
) {
  const now = new Date().toISOString();
  return {
    platform,
    conversationId: meta.conversationId,
    conversationUrl: meta.conversationUrl,
    conversationTitle: meta.conversationTitle,
    folderName: meta.folderName,
    folderResolved: meta.folderResolved,
    createdAt: meta.createdAt || now,
    lastUsedAt: meta.lastUsedAt || now,
  };
}

function getPollIntervalMs(): number {
  const value = parseInt(
    String(getPref("webSummaryPollIntervalMs" as any) || "350"),
    10,
  );
  return Number.isFinite(value) && value >= 200 ? value : 350;
}

function getProjectUrl(): string {
  return String(getPref("webSummaryChatGPTProjectUrl" as any) || "").trim();
}

function getChatGPTMode(): WebSummaryChatGPTMode {
  return getPref("webSummaryChatGPTMode" as any) === "instant"
    ? "instant"
    : "thinking";
}

export function getWebSummaryModelLabel(
  mode: WebSummaryChatGPTMode,
): string {
  return `${WEB_SUMMARY_MODEL_LABEL} (${mode === "instant" ? "Instant" : "Thinking"})`;
}

function launchChatGPTSurface(url: string): void {
  const targetUrl = String(url || "").trim() || "https://chatgpt.com/";
  try {
    if (typeof (Zotero as any).launchURL === "function") {
      (Zotero as any).launchURL(targetUrl);
      return;
    }
  } catch (error) {
    ztoolkit.log(
      "[AiNote][WebSummaryWorkflow] Failed to launch ChatGPT surface via Zotero.launchURL",
      error,
    );
  }

  try {
    const uri = Services.io.newURI(targetUrl);
    const externalProtocolService = (
      Components.classes[
        "@mozilla.org/uriloader/external-protocol-service;1" as keyof typeof Components.classes
      ] as any
    ).getService(
      Components.interfaces.nsIExternalProtocolService,
    ) as nsIExternalProtocolService;
    externalProtocolService.loadURI(uri);
  } catch (error) {
    ztoolkit.log(
      "[AiNote][WebSummaryWorkflow] Failed to launch ChatGPT surface",
      error,
    );
  }
}

function getStatusMessage(task: WebSummaryTask): string {
  const map: Record<string, string> = {
    queued: getString("web-summary-stage-queued" as any),
    claimed: getString("web-summary-stage-claimed" as any),
    opening_chat: getString("web-summary-stage-opening-chat" as any),
    locating_folder: getString("web-summary-stage-locating-folder" as any),
    creating_conversation: getString("web-summary-stage-creating-conversation" as any),
    downloading_pdf: getString("web-summary-stage-downloading-pdf" as any),
    awaiting_user_send: getString("web-summary-stage-awaiting-user-send" as any),
    running: getString("web-summary-stage-running" as any),
    succeeded: getString("web-summary-stage-succeeded" as any),
    failed: getString("web-summary-stage-failed" as any),
    canceled: getString("web-summary-stage-canceled" as any),
  };
  return map[task.status] || task.status;
}

function formatCreateTaskError(error: any): string {
  const code = String(error?.bridgeCode || "");
  if (code === "PROTOCOL_MISMATCH") {
    return getString("web-summary-block-protocol-mismatch");
  }
  if (code === "REQUIRED_CAPABILITY_MISSING") {
    return getString("web-summary-block-capability-missing");
  }
  if (code === "PERMISSION_MISSING") {
    return getString("web-summary-block-permission-missing");
  }
  if (code === "TARGET_PAGE_UNAVAILABLE") {
    return getString("web-summary-block-target-unavailable");
  }
  if (code === "EXTENSION_OFFLINE") {
    return getString("web-summary-block-extension-offline");
  }
  return error?.message || String(error);
}

async function checkCompatibilityWarnings(
  phase: "preflight" | "runtime" = "preflight",
): Promise<void> {
  try {
    const health = await WebSummaryBridgeClient.healthCheck();
    const warnings = (health.compatibilityWarnings || []).filter((warning) => {
      if (phase === "preflight" && warning.code === "TARGET_PAGE_UNAVAILABLE") {
        return false;
      }
      return true;
    });
    for (const warning of warnings) {
      ztoolkit.log("[AiNote][WebSummaryWorkflow][CompatibilityWarning]", warning);
    }
  } catch (error) {
    ztoolkit.log("[AiNote][WebSummaryWorkflow] health check failed", error);
  }
}

export class WebSummaryWorkflow {
  public static async summarizeSingleTarget(
    target: WebSummaryTarget,
    hooks?: WebSummarySingleRunHooks,
  ): Promise<{
    content: string;
    noteID: number;
    webConversationId?: string;
    webConversationUrl?: string;
    webConversationTitle?: string;
  }> {
    let currentTaskId = "";
    let currentTaskCanceled = false;
    hooks?.onCancelReady?.(() => {
      currentTaskCanceled = true;
      if (currentTaskId) {
        void WebSummaryBridgeClient.cancelTask(
          currentTaskId,
          getString("summary-canceled-unsaved" as any),
        ).catch((error) => {
          ztoolkit.log(
            "[AiNote][WebSummaryWorkflow] cancel current task failed",
            error,
          );
        });
      }
    });

    const promptTemplate = getPromptTemplate(target.templateId);
    const attachment = await PDFExtractor.resolvePdfAttachment(
      target.item,
      target.preferredPdfAttachment,
    );
    const pdfPath = await attachment.getFilePathAsync();
    if (!pdfPath) {
      throw new Error("无法获取 PDF 文件路径");
    }

    const chatgptMode = getChatGPTMode();
    const payload: CreateTaskRequest = {
      itemId: target.item.id,
      libraryId: target.item.libraryID,
      title: String(target.item.getField("title") || ""),
      pdfPath,
      pdfFileName: String(attachment.getField("title") || "paper.pdf"),
      prompt: promptTemplate.content,
      platform: "chatgpt",
      actionType: "summarize",
      conversationMode: "new-per-item",
      projectUrl: getProjectUrl(),
      chatgptMode,
      conversationTitle: buildConversationTitleFromItem(target.item),
    };

    launchChatGPTSurface(payload.projectUrl || "https://chatgpt.com/");
    hooks?.onStage?.(getString("web-summary-stage-submitting" as any), 5);
    await sleep(4000);

    await checkCompatibilityWarnings("preflight");
    let task;
    try {
      task = (await WebSummaryBridgeClient.createTask(payload)).task;
    } catch (error: any) {
      throw new Error(formatCreateTaskError(error));
    }
    currentTaskId = task.taskId;
    let latestTask = task;
    const queuedStartedAt = Date.now();
    let conversationLinked = false;
    let lastObservedStatus = latestTask.status;
    let sameStatusSince = Date.now();
    while (!["succeeded", "failed", "canceled"].includes(latestTask.status)) {
      if (currentTaskCanceled) {
        await WebSummaryBridgeClient.cancelTask(
          latestTask.taskId,
          getString("summary-canceled-unsaved" as any),
        );
      }
      await sleep(getPollIntervalMs());
      latestTask = await WebSummaryBridgeClient.getTask(task.taskId);
      if (latestTask.status !== lastObservedStatus) {
        lastObservedStatus = latestTask.status;
        sameStatusSince = Date.now();
      }
      if (
        latestTask.status === "queued" &&
        Date.now() - queuedStartedAt >= EXTENSION_CLAIM_TIMEOUT_MS
      ) {
        launchChatGPTSurface(payload.projectUrl || "https://chatgpt.com/");
        throw new Error(
          "已尝试主动打开 ChatGPT，但浏览器扩展仍未领取任务。请确认 Chrome 已启动、扩展已启用，并且扩展中的 Bridge URL 与 Zotero 中的端口一致。",
        );
      }
      if (
        latestTask.status === "claimed" &&
        Date.now() - sameStatusSince >= EXTENSION_CLAIM_STALL_TIMEOUT_MS
      ) {
        await checkCompatibilityWarnings("runtime");
        throw new Error(
          "浏览器扩展已领取任务但尚未开始唤起网页。请确认扩展后台仍在运行；若持续出现，请重启 Chrome 和扩展后再试。",
        );
      }
      if (
        latestTask.status === "opening_chat" &&
        Date.now() - sameStatusSince >= EXTENSION_OPENING_CHAT_TIMEOUT_MS
      ) {
        await checkCompatibilityWarnings("runtime");
        throw new Error(
          "浏览器扩展已开始打开 ChatGPT，但页面脚本长时间未就绪。请确认 ChatGPT 页面已正常加载；若持续出现，请重启 Chrome 和扩展后再试。",
        );
      }
      hooks?.onStage?.(getStatusMessage(latestTask), 15);
      if (
        !conversationLinked &&
        latestTask.conversationMeta?.conversationId &&
        latestTask.conversationMeta?.conversationUrl
      ) {
        await WebSummaryRelationStore.saveLatestLink(
          target.item,
          toChatLink("chatgpt", latestTask.conversationMeta),
        );
        conversationLinked = true;
      }
    }
    currentTaskId = "";

    if (latestTask.status === "canceled") {
      throw new WebSummaryCanceledError(
        latestTask.errorMessage ||
          latestTask.cancelReason ||
          getString("summary-canceled-unsaved" as any),
      );
    }
    if (latestTask.status !== "succeeded" || !latestTask.resultMarkdown) {
      throw new Error(latestTask.errorMessage || getString("web-summary-error-generic" as any));
    }

    const itemTitle = String(target.item.getField("title") || "");
    const summaryHeading = buildSummaryHeading(promptTemplate.name, itemTitle);
    const noteBody = stripLeadingSummaryHeading(
      latestTask.resultMarkdown,
      summaryHeading,
    );
    hooks?.onContent?.(noteBody || latestTask.resultMarkdown);
    hooks?.onStage?.(getString("web-summary-stage-saving-note" as any), 80);
    const noteHtml = buildNoteHtmlFromMarkdown(
      summaryHeading,
      getWebSummaryModelLabel(chatgptMode),
      latestTask.resultMarkdown,
    );
    const note = await createNote(target.item, noteHtml);
    if (latestTask.conversationMeta?.conversationUrl) {
      await WebSummaryRelationStore.saveLatestLink(
        target.item,
        toChatLink("chatgpt", latestTask.conversationMeta),
      );
    }
    hooks?.onStage?.("完成", 100);
    return {
      content: noteBody || latestTask.resultMarkdown,
      noteID: note.id,
      webConversationId: latestTask.conversationMeta?.conversationId,
      webConversationUrl: latestTask.conversationMeta?.conversationUrl,
      webConversationTitle: latestTask.conversationMeta?.conversationTitle,
    };
  }

  public static async summarizeItems(
    targets: WebSummaryTarget[],
    progressCallback?: (
      current: number,
      total: number,
      progress: number,
      message: string,
    ) => void,
  ): Promise<WebSummaryRunResult> {
    const total = targets.length;
    let successCount = 0;
    let failedCount = 0;
    let canceledCount = 0;
    let stopped = false;
    let currentTaskId = "";
    let currentTaskCanceled = false;
    const outputWindow = await OutputWindowManager.startBatch('web-summary', total);
    OutputWindowManager.setOnStop(() => {
      stopped = true;
    });
    OutputWindowManager.setOnStopCurrent(() => {
      currentTaskCanceled = true;
      if (currentTaskId) {
        void WebSummaryBridgeClient.cancelTask(
          currentTaskId,
          "已停止当前条目的AI总结",
        ).catch((error) => {
          ztoolkit.log(
            "[AiNote][WebSummaryWorkflow] cancel current task failed",
            error,
          );
        });
      }
    });

    for (let index = 0; index < targets.length; index++) {
      if (stopped) {
        break;
      }

      const target = targets[index];
      const current = index + 1;
      const promptTemplate = getPromptTemplate(target.templateId);
      const attachment = await PDFExtractor.resolvePdfAttachment(
        target.item,
        target.preferredPdfAttachment,
      );
      const pdfPath = await attachment.getFilePathAsync();
      if (!pdfPath) {
        throw new Error("无法获取 PDF 文件路径");
      }

      const payload: CreateTaskRequest = {
        itemId: target.item.id,
        libraryId: target.item.libraryID,
        title: String(target.item.getField("title") || ""),
        pdfPath,
        pdfFileName: String(attachment.getField("title") || "paper.pdf"),
        prompt: promptTemplate.content,
        platform: "chatgpt",
        actionType: "summarize",
        conversationMode: "new-per-item",
        projectUrl: getProjectUrl(),
        chatgptMode: getChatGPTMode(),
        conversationTitle: buildConversationTitleFromItem(target.item),
      };

      const itemTitle = String(target.item.getField("title") || "");
      const summaryHeading = buildSummaryHeading(
        promptTemplate.name,
        itemTitle,
      );

      try {
        currentTaskCanceled = false;
        progressCallback?.(current, total, 5, getString("web-summary-stage-submitting" as any));
        await outputWindow.startItem(itemTitle, WEB_SUMMARY_MODEL_LABEL);
        OutputWindowManager.recordItemStart(itemTitle, WEB_SUMMARY_MODEL_LABEL);
        outputWindow.updateCurrentStatus(getString("web-summary-stage-submitting" as any));
        OutputWindowManager.recordStatusUpdate(getString("web-summary-stage-submitting" as any));
        launchChatGPTSurface(payload.projectUrl || "https://chatgpt.com/");

        // 等待浏览器和扩展初始化（冷启动时 Chrome 需要时间启动，扩展 Service Worker 需要初始化轮询）
        await sleep(4000);

        await checkCompatibilityWarnings("preflight");
        let task;
        try {
          task = (await WebSummaryBridgeClient.createTask(payload)).task;
        } catch (error: any) {
          throw new Error(formatCreateTaskError(error));
        }
        currentTaskId = task.taskId;
        let latestTask = task;
        const queuedStartedAt = Date.now();
        let lastStatusMessage = "";
        let conversationLinked = false;
        let lastObservedStatus = latestTask.status;
        let sameStatusSince = Date.now();
        let lastModeSwitchLog = "";
        let lastPdfUploadLog = "";
        let lastDebugMessage = "";

        while (
          !["succeeded", "failed", "canceled"].includes(latestTask.status)
        ) {
          if (currentTaskCanceled) {
            await WebSummaryBridgeClient.cancelTask(
              latestTask.taskId,
              getString("summary-canceled-unsaved" as any),
            );
          }
          await sleep(getPollIntervalMs());
          latestTask = await WebSummaryBridgeClient.getTask(task.taskId);
          if (latestTask.status !== lastObservedStatus) {
            lastObservedStatus = latestTask.status;
            sameStatusSince = Date.now();
          }
          if (
            latestTask.status === "queued" &&
            Date.now() - queuedStartedAt >= EXTENSION_CLAIM_TIMEOUT_MS
          ) {
            launchChatGPTSurface(payload.projectUrl || "https://chatgpt.com/");
            throw new Error(
              "已尝试主动打开 ChatGPT，但浏览器扩展仍未领取任务。请确认 Chrome 已启动、扩展已启用，并且扩展中的 Bridge URL 与 Zotero 中的端口一致。",
            );
          }
          if (
            latestTask.status === "claimed" &&
            Date.now() - sameStatusSince >= EXTENSION_CLAIM_STALL_TIMEOUT_MS
          ) {
            await checkCompatibilityWarnings("runtime");
            throw new Error(
              "浏览器扩展已领取任务但尚未开始唤起网页。请确认扩展后台仍在运行；若持续出现，请重启 Chrome 和扩展后再试。",
            );
          }
          if (
            latestTask.status === "opening_chat" &&
            Date.now() - sameStatusSince >= EXTENSION_OPENING_CHAT_TIMEOUT_MS
          ) {
            await checkCompatibilityWarnings("runtime");
            throw new Error(
              "浏览器扩展已开始打开 ChatGPT，但页面脚本长时间未就绪。请确认 ChatGPT 页面已正常加载；若持续出现，请重启 Chrome 和扩展后再试。",
            );
          }
          const statusMessage = getStatusMessage(latestTask);
          if (statusMessage !== lastStatusMessage) {
            outputWindow.updateCurrentStatus(statusMessage);
            OutputWindowManager.recordStatusUpdate(statusMessage);
            lastStatusMessage = statusMessage;
          }
          if (
            !conversationLinked &&
            latestTask.conversationMeta?.conversationId &&
            latestTask.conversationMeta?.conversationUrl
          ) {
            try {
              await WebSummaryRelationStore.saveLatestLink(
                target.item,
                toChatLink("chatgpt", latestTask.conversationMeta),
              );
              conversationLinked = true;
              ztoolkit.log(
                "[AiNote][WebSummaryWorkflow] conversation linked early",
                {
                  taskId: latestTask.taskId,
                  conversationUrl: latestTask.conversationMeta?.conversationUrl,
                },
              );
            } catch (linkError) {
              ztoolkit.log(
                "[AiNote][WebSummaryWorkflow] failed to link conversation early",
                {
                  taskId: latestTask.taskId,
                  error: linkError,
                },
              );
            }
          }
          if (latestTask.modeSwitchOk) {
            const logText = `task=${latestTask.taskId}: 模型切换成功`;
            if (logText !== lastModeSwitchLog) {
              ztoolkit.log("[AiNote][WebSummaryWorkflow]", logText);
              lastModeSwitchLog = logText;
            }
          }
          if (latestTask.modeSwitchFailed || latestTask.modeSwitchError) {
            const logText = `task=${latestTask.taskId}: 模型切换失败 ${latestTask.modeSwitchError || ""}`.trim();
            if (logText !== lastModeSwitchLog) {
              ztoolkit.log("[AiNote][WebSummaryWorkflow]", logText);
              lastModeSwitchLog = logText;
            }
          }
          if (latestTask.pdfUploadReady) {
            const logText = `task=${latestTask.taskId}: PDF 上传完成`;
            if (logText !== lastPdfUploadLog) {
              ztoolkit.log("[AiNote][WebSummaryWorkflow]", logText);
              lastPdfUploadLog = logText;
            }
          }
          if (latestTask.debugMessage && latestTask.debugMessage !== lastDebugMessage) {
            ztoolkit.log("[AiNote][WebSummaryWorkflow][Debug]", {
              taskId: latestTask.taskId,
              message: latestTask.debugMessage,
            });
            lastDebugMessage = latestTask.debugMessage;
          }
          progressCallback?.(current, total, 15, statusMessage);
        }

        currentTaskId = "";

        if (latestTask.status === "canceled") {
          ztoolkit.log("[AiNote][WebSummaryWorkflow] task canceled", {
            taskId: latestTask.taskId,
            errorMessage: latestTask.errorMessage,
          });
          throw new WebSummaryCanceledError(
            latestTask.errorMessage ||
              latestTask.cancelReason ||
              getString("summary-canceled-unsaved" as any),
          );
        }
        if (latestTask.status !== "succeeded" || !latestTask.resultMarkdown) {
          ztoolkit.log("[AiNote][WebSummaryWorkflow] task failed", {
            taskId: latestTask.taskId,
            errorMessage: latestTask.errorMessage,
          });
          throw new Error(latestTask.errorMessage || getString("web-summary-error-generic" as any));
        }
        ztoolkit.log("[AiNote][WebSummaryWorkflow] summary content fetched", {
          taskId: latestTask.taskId,
          source: latestTask.resultSource || "unknown",
          debugInfo: latestTask.resultDebugInfo || "",
          length: latestTask.resultMarkdown.length,
        });

        const noteBody = stripLeadingSummaryHeading(
          latestTask.resultMarkdown,
          summaryHeading,
        );
        outputWindow.replaceCurrentContent(
          noteBody || latestTask.resultMarkdown,
        );
        OutputWindowManager.recordItemReplaceContent(
          noteBody || latestTask.resultMarkdown,
        );
        outputWindow.updateCurrentStatus(getString("web-summary-stage-saving-note" as any));
        OutputWindowManager.recordStatusUpdate(getString("web-summary-stage-saving-note" as any));

        const noteHtml = buildNoteHtmlFromMarkdown(
          summaryHeading,
          WEB_SUMMARY_MODEL_LABEL,
          latestTask.resultMarkdown,
        );
        await createNote(target.item, noteHtml);

        if (latestTask.conversationMeta?.conversationUrl) {
          await WebSummaryRelationStore.saveLatestLink(
            target.item,
            toChatLink("chatgpt", latestTask.conversationMeta),
          );
        }

        outputWindow.finishItem();
        OutputWindowManager.recordItemComplete();
        successCount++;
        progressCallback?.(current, total, 100, getString("web-summary-note-saved" as any));
      } catch (error: any) {
        currentTaskId = "";
        if (error instanceof WebSummaryCanceledError) {
          canceledCount++;
          outputWindow.stopCurrentItem(
            getString("summary-canceled-unsaved" as any),
          );
          OutputWindowManager.recordItemCanceled();
          progressCallback?.(
            current,
            total,
            100,
            getString("summary-canceled-continue-next" as any),
          );
        } else {
          failedCount++;
          outputWindow.showError(itemTitle, error?.message || String(error));
          OutputWindowManager.recordItemError(itemTitle, error?.message || String(error));
          progressCallback?.(
            current,
            total,
            100,
            error?.message || getString("web-summary-error-generic" as any),
          );
        }
      }
    }

    if (stopped) {
      const notProcessed = total - successCount - failedCount - canceledCount;
      OutputWindowManager.recordStopped();
      outputWindow.disableStopButton(true);
      outputWindow.showStopped(
        successCount,
        failedCount,
        notProcessed,
        canceledCount,
      );
      progressCallback?.(
        total,
        total,
        100,
        getString("summary-batch-stopped-detail" as any, {
          args: { success: successCount, failed: failedCount, canceled: canceledCount, notProcessed },
        }),
      );
    } else {
      outputWindow.disableStopButton(false);
      outputWindow.showComplete(successCount, total, canceledCount);
      progressCallback?.(
        total,
        total,
        100,
        failedCount === 0 && canceledCount === 0
          ? getString("summary-batch-all-complete" as any)
          : getString("summary-batch-mixed-result" as any, {
              args: { success: successCount, failed: failedCount, canceled: canceledCount },
            }),
      );
    }

    OutputWindowManager.endBatch();
    return {
      successCount,
      failedCount,
      canceledCount,
      stopped,
    };
  }

  public static async openConversationForItem(
    item: Zotero.Item,
  ): Promise<void> {
    const link = WebSummaryRelationStore.getLatestLink(item, "chatgpt");
    if (!link?.conversationUrl) {
      throw new Error("当前文献还没有可继续对话的 ChatGPT 会话记录");
    }
    launchChatGPTSurface(link.conversationUrl);
  }

  public static async debugFetchConversationContent(
    item: Zotero.Item,
  ): Promise<{ source: string; length: number; debugInfo: string }> {
    const link = WebSummaryRelationStore.getLatestLink(item, "chatgpt");
    if (!link?.conversationUrl) {
      throw new Error("当前文献还没有可继续对话的 ChatGPT 会话记录");
    }

    const payload: CreateTaskRequest = {
      itemId: item.id,
      libraryId: item.libraryID,
      title: String(item.getField("title") || ""),
      pdfPath: "",
      prompt: "",
      platform: "chatgpt",
      actionType: "open_conversation",
      conversationMode: "new-per-item",
      existingConversationId: link.conversationId,
      existingConversationUrl: link.conversationUrl,
    };

    const { task } = await WebSummaryBridgeClient.createTask(payload);
    const taskId = task.taskId;
    let latestTask = task;
    const queuedStartedAt = Date.now();

    while (
      !["succeeded", "failed", "canceled"].includes(latestTask.status)
    ) {
      await sleep(getPollIntervalMs());
      latestTask = await WebSummaryBridgeClient.getTask(taskId);
      if (
        latestTask.status === "queued" &&
        Date.now() - queuedStartedAt >= EXTENSION_CLAIM_TIMEOUT_MS
      ) {
        launchChatGPTSurface(link.conversationUrl);
        throw new Error(
          "浏览器扩展未领取调试任务，请确认扩展已启用",
        );
      }
    }

    if (latestTask.status !== "succeeded" || !latestTask.resultMarkdown) {
      throw new Error(latestTask.errorMessage || "调试获取网页总结内容失败");
    }
    ztoolkit.log("[AiNote][WebSummaryWorkflow][DebugFetch] content fetched", {
      taskId,
      source: latestTask.resultSource || "unknown",
      debugInfo: latestTask.resultDebugInfo || "",
      length: latestTask.resultMarkdown.length,
    });

    const summaryHeading = `## AI Summary (Debug Fetch)\n\n`;
    const noteHtml = buildNoteHtmlFromMarkdown(
      summaryHeading,
      "ChatGPT Web (Debug)",
      latestTask.resultMarkdown,
    );
    await createNote(item, noteHtml);

    if (latestTask.conversationMeta?.conversationUrl) {
      await WebSummaryRelationStore.saveLatestLink(
        item,
        toChatLink("chatgpt", latestTask.conversationMeta),
      );
    }

    return {
      source: latestTask.resultSource || "unknown",
      length: latestTask.resultMarkdown.length,
      debugInfo: latestTask.resultDebugInfo || "",
    };
  }
}
