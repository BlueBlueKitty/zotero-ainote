import { getString, initLocale } from "./utils/locale";
import { registerPrefsScripts } from "./modules/preferenceScript";
import { createZToolkit } from "./utils/ztoolkit";
import { NoteGenerationTarget } from "./modules/noteGenerator";
import { WebSummaryWorkflow } from "./modules/webSummaryWorkflow";
import {
  formatSelectedNote,
  NOTE_FORMAT_ACTIONS,
  NoteFormatActionType,
} from "./modules/noteFormatter";
import {
  installNoteEditorContextMenuForWindow,
  uninstallNoteEditorContextMenuForWindow,
} from "./modules/noteEditorContextMenu";
import { config } from "../package.json";
import { getPref, setPref } from "./utils/prefs";
import {
  createDefaultPromptTemplates,
  ensurePromptTemplateState,
  getDefaultActivePromptTemplateId,
  getActivePromptTemplate,
  PROMPT_TEMPLATES_VERSION,
  serializePromptTemplates,
} from "./utils/prompts";
import {
  createProfile,
  migrateToProfilesV3,
  parseProfiles,
} from "./modules/llmProfiles";
import { WebSummaryRelationStore } from "./modules/webSummaryRelations";
import { SummaryTaskManager } from "./modules/summaryTaskManager";
import { SummaryManagerWindow } from "./modules/summaryManagerWindow";

const GENERATE_SUMMARY_MENU_ID = "ainote-generate-summary-menu";
const WEB_CONTINUE_CHAT_MENU_ID = "ainote-web-continue-chat-menu";
const NOTE_FORMAT_MENU_ID = "ainote-note-format-menu";
const REOPEN_OUTPUT_WINDOW_MENU_ID = "ainote-reopen-output-window";

async function onStartup() {
  await Promise.all([
    Zotero.initializationPromise,
    Zotero.unlockPromise,
    Zotero.uiReadyPromise,
  ]);

  initLocale();
  await SummaryTaskManager.getInstance().ensureLoaded();

  // 在插件启动时立即初始化默认配置
  initializeDefaultPrefsOnStartup();
  startWebSummaryBridgeIfNeeded();
  void WebSummaryRelationStore.migrateLegacyRelations().catch((error) => {
    ztoolkit.log("[AiNote] Legacy web-summary relation migration failed:", error);
  });

  // Register preferences pane
  registerPrefsPane();

  await Promise.all(
    Zotero.getMainWindows().map((win) => onMainWindowLoad(win)),
  );

  // Mark initialized as true to confirm plugin loading status
  addon.data.initialized = true;
}

async function onMainWindowLoad(win: _ZoteroTypes.MainWindow): Promise<void> {
  // Create ztoolkit for every window
  addon.data.ztoolkit = createZToolkit();

  win.MozXULElement.insertFTLIfNeeded(
    `${addon.data.config.addonRef}-mainWindow.ftl`,
  );
  // Also ensure preferences FTL is available for localized preferences.xhtml
  win.MozXULElement.insertFTLIfNeeded(
    `${addon.data.config.addonRef}-preferences.ftl`,
  );

  // Register context menu item (using ztoolkit for Zotero 7.0)
  refreshContextMenuItems();
  installNoteEditorContextMenuForWindow(win);

  const popupWin = new ztoolkit.ProgressWindow(addon.data.config.addonName, {
    closeOnClick: true,
    closeTime: -1,
  })
    .createLine({
      text: "AiNote loaded",
      type: "default",
      progress: 100,
    })
    .show();

  popupWin.startCloseTimer(3000);
}

/**
 * Register preferences pane
 */
function registerPrefsPane() {
  const prefOptions = {
    pluginID: config.addonID,
    src: rootURI + "content/preferences.xhtml",
    label: getString("prefs-title"),
    image: `chrome://${config.addonRef}/content/icons/favicon.png`,
    defaultXUL: true,
  };
  Zotero.PreferencePanes.register(prefOptions);
}

/**
 * 在插件启动时初始化默认配置
 * 确保即使 prefs.js 没有加载，也能有默认值
 */
function initializeDefaultPrefsOnStartup() {
  const defaults: Record<string, any> = {
    profiles: "[]",
    activeProfileId: "",
    migratedToProfilesV3: false,
    truncateLength: "10",
    summaryPrompt: "",
    promptVersion: 0,
    promptTemplates: serializePromptTemplates(createDefaultPromptTemplates()),
    activePromptTemplateId: getDefaultActivePromptTemplateId(),
    pinCurrentPromptTemplate: false,
    promptTemplatesVersion: PROMPT_TEMPLATES_VERSION,
    enableWebSummary: true,
    webSummaryBridgePort: "23123",
    webSummaryPollIntervalMs: "350",
    webSummaryRequestTimeoutMs: "15000",
    webSummaryAutoStartBridge: true,
    webSummaryChatGPTProjectUrl: "https://chatgpt.com",
    webSummaryChatGPTMode: "thinking",
    webSummaryEnableContinueChatMenu: true,
  };

  migrateToProfilesV3(
    (k) => getPref(k as any),
    (k, v) => setPref(k as any, v),
    (k) => Zotero.Prefs.clear(`${config.prefsPrefix}.${k}`, true),
  );

  for (const [key, defaultValue] of Object.entries(defaults)) {
    try {
      // 使用 Zotero.Prefs.get 直接检查
      const currentValue = getPref(key as any);

      if (currentValue === undefined || currentValue === null) {
        // const preview = typeof defaultValue === 'string' && defaultValue.length > 50
        //   ? defaultValue.substring(0, 50) + '...'
        //   : defaultValue;
        // ztoolkit.log(`[AiNote] 启动时初始化配置: ${key} = ${preview}`);
        setPref(key as any, defaultValue);
      } else if (
        typeof defaultValue === "string" &&
        typeof currentValue === "string" &&
        !currentValue.trim()
      ) {
        // ztoolkit.log(`[AiNote] 启动时重置空配置: ${key}`);
        setPref(key as any, defaultValue);
      }
    } catch (error) {
      ztoolkit.log(`[AiNote] 启动时初始化配置失败: ${key}`, error);
      try {
        setPref(key as any, defaultValue);
      } catch (e) {
        ztoolkit.log(`[AiNote] 启动时强制设置配置失败: ${key}`, e);
      }
    }

  }

  const profiles = parseProfiles(getPref("profiles"));
  const activeId = String(getPref("activeProfileId") || "").trim();
  if (!profiles.length) {
    const chatgptProfile = createProfile(
      "chatgpt_web",
      getString("prefs-provider-chatgpt-web" as any),
    );
    setPref("profiles" as any, JSON.stringify([chatgptProfile]));
    setPref("activeProfileId" as any, chatgptProfile.id);
  } else if (!activeId || !profiles.some((p) => p.id === activeId)) {
    setPref("activeProfileId" as any, profiles[0].id);
  }

  if (profiles.length && !profiles.some((p) => p.providerType === "chatgpt_web")) {
    const nextProfiles = [
      ...profiles,
      createProfile("chatgpt_web", getString("prefs-provider-chatgpt-web" as any)),
    ];
    setPref("profiles" as any, JSON.stringify(nextProfiles));
  }

  const promptTemplateState = ensurePromptTemplateState(
    getPref("promptTemplates" as any),
    getPref("activePromptTemplateId" as any),
    getPref("promptTemplatesVersion" as any),
  );
  if (promptTemplateState.changed) {
    setPref(
      "promptTemplates" as any,
      serializePromptTemplates(promptTemplateState.templates),
    );
    setPref(
      "activePromptTemplateId" as any,
      promptTemplateState.activeTemplateId,
    );
    setPref("promptTemplatesVersion" as any, promptTemplateState.version);
  }
}

/**
 * Register context menu item for items
 */
function buildGenerateSummaryMenuOptions(menuIcon: string): any {
  const state = ensurePromptTemplateState(
    getPref("promptTemplates" as any),
    getPref("activePromptTemplateId" as any),
    getPref("promptTemplatesVersion" as any),
  );
  const activeTemplate = getActivePromptTemplate(
    getPref("promptTemplates" as any),
    getPref("activePromptTemplateId" as any),
    getPref("promptTemplatesVersion" as any),
  );
  const pinCurrentPromptTemplate = !!getPref("pinCurrentPromptTemplate" as any);

  const getVisibility = () => {
    const selectedItems = Zotero.getActiveZoteroPane().getSelectedItems();
    return (
      (selectedItems?.length > 0 &&
        selectedItems.every((item: Zotero.Item) =>
          isSupportedSelectionItem(item),
        )) ||
      false
    );
  };

  if (pinCurrentPromptTemplate) {
    return {
      tag: "menuitem",
      id: GENERATE_SUMMARY_MENU_ID,
      label: getString("menuitem-generateSummary"),
      icon: menuIcon,
      commandListener: () => {
        handleGenerateSummary(activeTemplate.id);
      },
      getVisibility,
    };
  }

  return {
    tag: "menu",
    id: GENERATE_SUMMARY_MENU_ID,
    label: getString("menuitem-generateSummary"),
    icon: menuIcon,
    children: state.templates.map((template) => ({
      tag: "menuitem",
      id: `${GENERATE_SUMMARY_MENU_ID}-${template.id}`,
      label: template.name,
      commandListener: () => {
        handleGenerateSummary(template.id);
      },
    })),
    getVisibility,
  };
}

function registerContextMenuItemForWindow(win: Window) {
  const menuIcon = `chrome://${config.addonRef}/content/icons/favicon.png`;
  const popup = win.document.querySelector(
    "#zotero-itemmenu",
  ) as XUL.MenuPopup | null;
  if (!popup) {
    return;
  }

  win.document.getElementById(GENERATE_SUMMARY_MENU_ID)?.remove();
  win.document.getElementById(WEB_CONTINUE_CHAT_MENU_ID)?.remove();
  win.document.getElementById(NOTE_FORMAT_MENU_ID)?.remove();
  win.document.getElementById(REOPEN_OUTPUT_WINDOW_MENU_ID)?.remove();

  ztoolkit.Menu.register(popup, buildGenerateSummaryMenuOptions(menuIcon));
  ztoolkit.Menu.register(popup, buildContinueChatMenuOptions(menuIcon));
  ztoolkit.Menu.register(popup, buildNoteFormatMenuOptions(menuIcon));
  ztoolkit.Menu.register(popup, {
    tag: "menuitem",
    id: REOPEN_OUTPUT_WINDOW_MENU_ID,
    label: getString("menuitem-reopenOutputWindow" as any),
    icon: menuIcon,
    commandListener: () => {
      void SummaryManagerWindow.open();
    },
    getVisibility: () => true,
  });
}

function refreshContextMenuItems() {
  Zotero.getMainWindows().forEach((win) => {
    registerContextMenuItemForWindow(win);
  });
}

function isPdfAttachment(item: Zotero.Item): boolean {
  return (
    item.isAttachment() && item.attachmentContentType === "application/pdf"
  );
}

function isSupportedSelectionItem(item: Zotero.Item): boolean {
  return item.isRegularItem() || isPdfAttachment(item);
}

function isSingleSelectedNote(item: Zotero.Item): boolean {
  return item.isNote();
}

function isContinueChatEnabled(): boolean {
  return !!getPref("webSummaryEnableContinueChatMenu" as any);
}

function resolveSelectedRegularItemSync(item: Zotero.Item): Zotero.Item | null {
  if (item.isRegularItem()) {
    return item;
  }
  if (!isPdfAttachment(item) || !item.parentItemID) {
    return null;
  }
  const parent = Zotero.Items.get(item.parentItemID);
  return parent?.isRegularItem() ? parent : null;
}

function buildContinueChatMenuOptions(menuIcon: string): any {
  return {
    tag: "menuitem",
    id: WEB_CONTINUE_CHAT_MENU_ID,
    label: getString("menuitem-continueWebChat" as any),
    icon: menuIcon,
    commandListener: () => {
      void handleContinueWebChat();
    },
    getVisibility: () => {
      if (!isContinueChatEnabled()) {
        return false;
      }
      const selectedItems = Zotero.getActiveZoteroPane().getSelectedItems();
      if (selectedItems?.length !== 1) {
        return false;
      }
      const regularItem = resolveSelectedRegularItemSync(selectedItems[0]);
      if (!regularItem) {
        return false;
      }
      return WebSummaryRelationStore.hasPlatformLink(regularItem, "chatgpt");
    },
  };
}


function buildNoteFormatMenuOptions(menuIcon: string): any {
  return {
    tag: "menu",
    id: NOTE_FORMAT_MENU_ID,
    label: getString("note-format-menu"),
    icon: menuIcon,
    children: NOTE_FORMAT_ACTIONS.map((action) => ({
      tag: "menuitem",
      id: `${NOTE_FORMAT_MENU_ID}-${action.id}`,
      label: action.label,
      commandListener: () => {
        handleNoteFormatAction(action.id);
      },
    })),
    getVisibility: () => {
      const selectedItems = Zotero.getActiveZoteroPane().getSelectedItems();
      return (
        selectedItems?.length === 1 &&
        selectedItems.every((item: Zotero.Item) => isSingleSelectedNote(item))
      );
    },
  };
}

async function normalizeSelectionTargets(
  items: Zotero.Item[],
  templateId?: string,
): Promise<{ targets: NoteGenerationTarget[]; skippedNoAttachmentTitles: string[] }> {
  const targets: NoteGenerationTarget[] = [];
  const skippedNoAttachmentTitles: string[] = [];

  for (const item of items) {
    if (item.isRegularItem()) {
      const attachmentIds = item.getAttachments();
      let hasPdf = false;
      for (const attachmentId of attachmentIds) {
        const attachment = await Zotero.Items.getAsync(attachmentId);
        if (attachment?.attachmentContentType === "application/pdf") {
          hasPdf = true;
          break;
        }
      }
      if (!hasPdf) {
        skippedNoAttachmentTitles.push(
          String(item.getField("title") || `Item ${item.id || ""}`).trim(),
        );
        continue;
      }
      targets.push({ item, templateId });
      continue;
    }

    if (!isPdfAttachment(item)) {
      continue;
    }

    const parentID = item.parentItemID;
    if (!parentID) {
      throw new Error(getString("error-pdf-parent-missing" as any));
    }

    const parentItem = await Zotero.Items.getAsync(parentID);
    if (!parentItem || !parentItem.isRegularItem()) {
      throw new Error(getString("error-pdf-parent-invalid" as any));
    }

    targets.push({
      item: parentItem,
      preferredPdfAttachment: item,
      templateId,
    });
  }

  return { targets, skippedNoAttachmentTitles };
}

/**
 * Handle generate AI summary command
 */
async function handleGenerateSummary(templateId?: string) {
  const profilesRaw = Zotero.Prefs.get(
    `${config.prefsPrefix}.profiles`,
    true,
  ) as string;
  const activeId =
    (Zotero.Prefs.get(
      `${config.prefsPrefix}.activeProfileId`,
      true,
    ) as string) || "";
  const profiles = parseProfiles(profilesRaw);
  const activeProfile = profiles.find((p) => p.id === activeId) || profiles[0];

    if (!activeProfile || !activeProfile.enabled) {
    new ztoolkit.ProgressWindow("AiNote", {
      closeOnClick: true,
      closeTime: 5000,
    })
      .createLine({
        text: getString("error-noApiKey"),
        type: "error",
      })
      .show();
    return;
  }

  if (activeProfile.providerType !== "chatgpt_web" && !activeProfile.apiKey) {
    new ztoolkit.ProgressWindow("AiNote", {
      closeOnClick: true,
      closeTime: 5000,
    })
      .createLine({
        text: getString("error-noApiKey"),
        type: "error",
      })
      .show();
    return;
  }

  // Get selected items
  const selectedItems = Zotero.getActiveZoteroPane().getSelectedItems();

  if (selectedItems.length === 0) {
    new ztoolkit.ProgressWindow("AiNote", {
      closeOnClick: true,
      closeTime: 3000,
    })
      .createLine({
        text: getString("error-noItemsSelected"),
        type: "error",
      })
      .show();
    return;
  }

  const { targets, skippedNoAttachmentTitles } = await normalizeSelectionTargets(
    selectedItems,
    templateId,
  );

  if (skippedNoAttachmentTitles.length > 0) {
    const count = skippedNoAttachmentTitles.length;
    const preview = skippedNoAttachmentTitles.slice(0, 2).join("、");
    const suffix = count > 2
      ? ` ${getString("warn-skip-no-pdf-suffix" as any, { args: { count } })}`
      : "";
    new ztoolkit.ProgressWindow("AiNote", {
      closeOnClick: true,
      closeTime: 3500,
    })
      .createLine({
        text: getString("warn-skip-no-pdf" as any, {
          args: { preview, suffix },
        }),
        type: "warning",
      })
      .show();
  }

  if (targets.length === 0) {
    new ztoolkit.ProgressWindow("AiNote", {
      closeOnClick: true,
      closeTime: 3000,
    })
      .createLine({
        text: getString("error-noSupportedItems"),
        type: "error",
      })
      .show();
    return;
  }

  if (activeProfile.providerType === "chatgpt_web") {
    // chatgpt_web 也统一通过任务管理器进入
    await enqueueSummaryTasks(targets);
    return;
  }

  try {
    await enqueueSummaryTasks(targets);
  } catch (error: any) {
    ztoolkit.log("[AiNote] Fatal error in handleGenerateSummary:", error);
  }
}

async function enqueueSummaryTasks(targets: NoteGenerationTarget[]) {
  const manager = SummaryTaskManager.getInstance();
  await manager.ensureLoaded();
  manager.enqueue(targets);
  await SummaryManagerWindow.open();
}

async function handleContinueWebChat() {
  const selectedItems = Zotero.getActiveZoteroPane().getSelectedItems();
  if (selectedItems.length !== 1) {
    return;
  }
  const item = resolveSelectedRegularItemSync(selectedItems[0]);
  if (!item) {
    return;
  }

  const progressWin = new ztoolkit.ProgressWindow("AiNote", {
    closeOnClick: true,
    closeTime: -1,
  });

  try {
    progressWin
      .createLine({
        text: getString("web-summary-open-conversation-start" as any),
        type: "default",
      })
      .show();
    await WebSummaryWorkflow.openConversationForItem(item);
    progressWin.changeLine({
      text: getString("web-summary-open-conversation-success" as any),
      type: "success",
      progress: 100,
    });
    progressWin.startCloseTimer(4000);
  } catch (error: any) {
    progressWin.changeLine({
      text: `${getString("web-summary-open-conversation-failed" as any)}：${error?.message || ""}`,
      type: "error",
    });
    progressWin.startCloseTimer(8000);
  }
}


async function handleNoteFormatAction(actionType: NoteFormatActionType) {
  try {
    const selectedItems = Zotero.getActiveZoteroPane().getSelectedItems();
    if (selectedItems.length !== 1 || !selectedItems[0].isNote()) {
      new ztoolkit.ProgressWindow("AiNote", {
        closeOnClick: true,
        closeTime: 3000,
      })
        .createLine({
          text: getString("note-format-please-select-note"),
          type: "error",
        })
        .show();
      return;
    }

    await formatSelectedNote(actionType);
  } catch (error: any) {
    ztoolkit.log("[AiNote] Failed to run note format action:", error);
    new ztoolkit.ProgressWindow("AiNote", {
      closeOnClick: true,
      closeTime: 5000,
    })
      .createLine({
        text: `${getString("note-format-error")}：${error?.message || ""}`,
        type: "error",
      })
      .show();
  }
}

async function onMainWindowUnload(win: Window): Promise<void> {
  uninstallNoteEditorContextMenuForWindow(win);
  ztoolkit.unregisterAll();
  addon.data.dialog?.window?.close();
}

function onShutdown(): void {
  addon.data.webSummaryBridge?.stop();
  ztoolkit.unregisterAll();
  addon.data.dialog?.window?.close();
  // Remove addon object
  addon.data.alive = false;
  // @ts-expect-error - Plugin instance is not typed
  delete Zotero[addon.data.config.addonInstance];
}

async function onNotify(
  event: string,
  type: string,
  ids: Array<string | number>,
  extraData: { [key: string]: any },
) {
  // Placeholder for future notify handlers
  // ztoolkit.log("notify", event, type, ids, extraData);
}

async function onPrefsEvent(type: string, data: { [key: string]: any }) {
  // console.log("[AiNote] onPrefsEvent called, type:", type);
  // ztoolkit.log("[AiNote] onPrefsEvent called, type:", type, "data:", data);

  switch (type) {
    case "load":
      // console.log("[AiNote] Calling registerPrefsScripts");
      registerPrefsScripts(data.window);
      refreshContextMenuItems();
      break;
    default:
      refreshContextMenuItems();
      return;
  }
}

function onShortcuts(type: string) {
  // Placeholder for future shortcuts
}

function onDialogEvents(type: string) {
  // Placeholder for future dialog events
}

export default {
  onStartup,
  onShutdown,
  onMainWindowLoad,
  onMainWindowUnload,
  onNotify,
  onPrefsEvent,
  onShortcuts,
  onDialogEvents,
};

function startWebSummaryBridgeIfNeeded() {
  if (!getPref("webSummaryAutoStartBridge" as any)) {
    return;
  }
  try {
    addon.data.webSummaryBridge?.start();
  } catch (error) {
    ztoolkit.log("[AiNote] Failed to start web summary bridge:", error);
  }
}
