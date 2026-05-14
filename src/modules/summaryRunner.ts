import { getPref } from "../utils/prefs";
import { parseProfiles } from "./llmProfiles";
import { AIRequestCanceledError } from "./aiService";
import { NoteGenerationTarget, NoteGenerator } from "./noteGenerator";
import {
  getWebSummaryModelLabel,
  WebSummaryTarget,
  WebSummaryWorkflow,
} from "./webSummaryWorkflow";
import { SummaryTask } from "./summaryTaskTypes";
import { WebSummaryChatGPTMode } from "./webSummaryTypes";

export interface SummaryRunnerHooks {
  onStage: (stage: string, progress?: number) => void;
  onChunk: (chunk: string) => void;
  onCancelReady: (cancelFn: () => void) => void;
}

export interface SummaryRunnerResult {
  content: string;
  noteID?: number;
  webConversationId?: string;
  webConversationUrl?: string;
  webConversationTitle?: string;
  model?: string;
  promptVersion?: string;
}

function getActiveProfile() {
  const profiles = parseProfiles(getPref("profiles" as any));
  const activeId = String(getPref("activeProfileId" as any) || "").trim();
  return profiles.find((profile) => profile.id === activeId) || profiles[0] || null;
}

function getApiModelLabel(profile: ReturnType<typeof getActiveProfile>): string {
  const model = String(profile?.model || "").trim();
  const profileName = String(profile?.name || "").trim();
  if (profileName && model) {
    return `${profileName} / ${model}`;
  }
  return model || "";
}

function buildTarget(task: SummaryTask): NoteGenerationTarget {
  const item = Zotero.Items.get(task.itemID);
  if (!item) {
    throw new Error("条目不存在或已被删除");
  }
  let preferredPdfAttachment: Zotero.Item | undefined;
  if (task.preferredPdfAttachmentID) {
    const attachment = Zotero.Items.get(task.preferredPdfAttachmentID);
    if (attachment) {
      preferredPdfAttachment = attachment;
    }
  }
  return {
    item,
    preferredPdfAttachment,
    templateId: task.templateId,
  };
}

export class SummaryRunner {
  public static async run(
    task: SummaryTask,
    hooks: SummaryRunnerHooks,
  ): Promise<SummaryRunnerResult> {
    if (task.kind === "web") {
      return this.runWeb(task, hooks);
    }
    return this.runApi(task, hooks);
  }

  private static async runApi(
    task: SummaryTask,
    hooks: SummaryRunnerHooks,
  ): Promise<SummaryRunnerResult> {
    const target = buildTarget(task);
    const profile = getActiveProfile();
    if (!profile) {
      throw new Error("请先在设置中创建并激活模型配置");
    }
    hooks.onStage("准备生成总结...", 5);
    const { note, content } = await NoteGenerator.generateNoteForItem(
      target,
      undefined,
      (stage, progress) => hooks.onStage(stage, progress),
      (cancelFn) => hooks.onCancelReady(cancelFn),
      (chunk) => hooks.onChunk(chunk),
    );
    return {
      content,
      noteID: note.id,
      model: getApiModelLabel(profile),
      promptVersion: String(getPref("promptTemplatesVersion" as any) || ""),
    };
  }

  private static async runWeb(
    task: SummaryTask,
    hooks: SummaryRunnerHooks,
  ): Promise<SummaryRunnerResult> {
    const item = Zotero.Items.get(task.itemID);
    if (!item) {
      throw new Error("条目不存在或已被删除");
    }
    let preferredPdfAttachment: Zotero.Item | undefined;
    if (task.preferredPdfAttachmentID) {
      const attachment = Zotero.Items.get(task.preferredPdfAttachmentID);
      if (attachment) preferredPdfAttachment = attachment;
    }
    const target: WebSummaryTarget = {
      item,
      preferredPdfAttachment,
      templateId: task.templateId,
    };
    const mode: WebSummaryChatGPTMode =
      getPref("webSummaryChatGPTMode" as any) === "instant"
        ? "instant"
        : "thinking";
    const result = await WebSummaryWorkflow.summarizeSingleTarget(target, {
      onStage: hooks.onStage,
      onContent: (content) => hooks.onChunk(content),
      onCancelReady: hooks.onCancelReady,
    });

    return {
      content: result.content,
      noteID: result.noteID,
      webConversationId: result.webConversationId,
      webConversationUrl: result.webConversationUrl,
      webConversationTitle: result.webConversationTitle,
      model: getWebSummaryModelLabel(mode),
      promptVersion: String(getPref("promptTemplatesVersion" as any) || ""),
    };
  }

  public static isCanceledError(error: any): boolean {
    return (
      error instanceof AIRequestCanceledError ||
      error?.name === "WebSummaryCanceledError" ||
      String(error?.message || "").includes("已停止当前条目")
    );
  }
}
