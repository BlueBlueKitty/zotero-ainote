import { getString, initLocale } from "./utils/locale";
import { registerPrefsScripts } from "./modules/preferenceScript";
import { createZToolkit } from "./utils/ztoolkit";
import { NoteGenerationTarget, NoteGenerator } from "./modules/noteGenerator";
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

const GENERATE_SUMMARY_MENU_ID = "ainote-generate-summary-menu";
const NOTE_FORMAT_MENU_ID = "ainote-note-format-menu";

async function onStartup() {
  await Promise.all([
    Zotero.initializationPromise,
    Zotero.unlockPromise,
    Zotero.uiReadyPromise,
  ]);

  initLocale();

  // 在插件启动时立即初始化默认配置
  initializeDefaultPrefsOnStartup();

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

    const profiles = parseProfiles(getPref("profiles"));
    const activeId = String(getPref("activeProfileId") || "").trim();
    if (!profiles.length) {
      const profile = createProfile("openai_compatible", "默认配置");
      setPref("profiles" as any, JSON.stringify([profile]));
      setPref("activeProfileId" as any, profile.id);
    } else if (!activeId || !profiles.some((p) => p.id === activeId)) {
      setPref("activeProfileId" as any, profiles[0].id);
    }
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
  win.document.getElementById(NOTE_FORMAT_MENU_ID)?.remove();

  ztoolkit.Menu.register(popup, buildGenerateSummaryMenuOptions(menuIcon));
  ztoolkit.Menu.register(popup, buildNoteFormatMenuOptions(menuIcon));
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
): Promise<NoteGenerationTarget[]> {
  const targets: NoteGenerationTarget[] = [];

  for (const item of items) {
    if (item.isRegularItem()) {
      targets.push({ item, templateId });
      continue;
    }

    if (!isPdfAttachment(item)) {
      continue;
    }

    const parentID = item.parentItemID;
    if (!parentID) {
      throw new Error("选中的 PDF 附件缺少父条目，无法创建总结笔记");
    }

    const parentItem = await Zotero.Items.getAsync(parentID);
    if (!parentItem || !parentItem.isRegularItem()) {
      throw new Error("选中的 PDF 附件未找到可用的父条目");
    }

    targets.push({
      item: parentItem,
      preferredPdfAttachment: item,
      templateId,
    });
  }

  return targets;
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

    if (!activeProfile || !activeProfile.enabled || !activeProfile.apiKey) {
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

  const targets = await normalizeSelectionTargets(selectedItems, templateId);

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

  // Create progress window
  const progressWin = new ztoolkit.ProgressWindow("AiNote", {
    closeOnClick: false,
    closeTime: -1, // 不自动关闭,直到处理完成
  });

  try {
    const total = targets.length;
    let successCount = 0;
    let failedCount = 0;
    const failedItems: Array<{ title: string; error: string }> = [];

    await NoteGenerator.generateNotesForItems(
      targets,
      (current, total, progress, message) => {
        const itemTitle = targets[current - 1].item.getField("title") as string;
        const mainText = `正在处理 ${current}/${total}: ${itemTitle}`;

        if (current === 1 && progress === 10) {
          progressWin
            .createLine({
              text: mainText,
              type: "default",
              progress: 0,
            })
            .show();
        } else {
          const overallProgress =
            ((current - 1) / total) * 100 + progress / total;

          // 检测是否是错误消息
          if (message.startsWith("Error:")) {
            failedCount++;
            failedItems.push({
              title: itemTitle,
              error: message.replace("Error: ", ""),
            });

            progressWin.changeLine({
              text: `${mainText} - ${getString("progress-failed")}`,
              type: "error",
              progress: overallProgress,
            });

            // 短暂停留后继续下一个
            setTimeout(() => {
              if (current < total) {
                progressWin.changeLine({
                  text: getString("progress-continue-next"),
                  type: "default",
                  progress: overallProgress,
                });
              }
            }, 1000);
          } else {
            progressWin.changeLine({
              text: `${mainText} - ${message}`,
              progress: overallProgress,
            });

            // 如果完成了一个条目
            if (progress === 100) {
              successCount++;
            }
          }
        }

        if (current === total && progress === 100) {
          // 显示最终统计
          if (failedCount === 0) {
            progressWin.changeLine({
              text: getString("success-allCompleteDetailed", { args: { total: String(total) } }),
              type: "success",
              progress: 100,
            });
          } else {
            progressWin.changeLine({
              text: getString("success-partialComplete", { args: { success: String(successCount), failed: String(failedCount) } }),
              type: failedCount === total ? "error" : "default",
              progress: 100,
            });
          }

          // 如果有失败的条目，显示详细错误信息
          if (failedCount > 0) {
            setTimeout(() => {
              let errorDetails = `处理失败的条目:\n\n`;
              failedItems.forEach((item, index) => {
                errorDetails += `${index + 1}. ${item.title}\n   错误: ${item.error}\n\n`;
              });

              new ztoolkit.ProgressWindow("处理失败详情", {
                closeOnClick: true,
                closeTime: -1, // 不自动关闭
              })
                .createLine({
                  text: `共 ${failedCount} 个条目失败，点击查看详情`,
                  type: "error",
                })
                .show();

              // 同时在控制台输出详细错误（仅在调试时使用）
              // ztoolkit.log("[AiNote] Failed items details:", failedItems);
            }, 2000);
          }

          // 标记完成，允许进度窗在短时间后关闭
          progressWin.startCloseTimer(5000);
        }
      },
    );
  } catch (error: any) {
    ztoolkit.log("[AiNote] Fatal error in handleGenerateSummary:", error);
    progressWin.changeLine({
      text: `严重错误: ${error.message}`,
      type: "error",
    });
    progressWin.startCloseTimer(10000);
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
