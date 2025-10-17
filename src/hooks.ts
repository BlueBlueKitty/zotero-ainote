import { getString, initLocale } from "./utils/locale";
import { registerPrefsScripts } from "./modules/preferenceScript";
import { createZToolkit } from "./utils/ztoolkit";
import { NoteGenerator } from "./modules/noteGenerator";
import { config } from "../package.json";

async function onStartup() {
  await Promise.all([
    Zotero.initializationPromise,
    Zotero.unlockPromise,
    Zotero.uiReadyPromise,
  ]);

  initLocale();

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
  registerContextMenuItem();

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
 * Register context menu item for items
 */
function registerContextMenuItem() {
  const menuIcon = `chrome://${config.addonRef}/content/icons/favicon.png`;
  
  ztoolkit.Menu.register("item", {
    tag: "menuitem",
    label: getString("menuitem-generateSummary"),
    icon: menuIcon,
    commandListener: (ev) => {
      handleGenerateSummary();
    },
    getVisibility: () => {
      const selectedItems = Zotero.getActiveZoteroPane().getSelectedItems();
      return selectedItems?.every((item: Zotero.Item) => item.isRegularItem()) || false;
    },
  });
}

/**
 * Handle generate AI summary command
 */
async function handleGenerateSummary() {
  // Check if API is configured (global only)
  const apiKey = Zotero.Prefs.get(`${config.prefsPrefix}.apiKey`, true) as string;
  ztoolkit.log(`[AiNote] handleGenerateSummary - API Key: ${apiKey ? `exists (${apiKey.length} chars)` : 'missing'}`);

  if (!apiKey) {
    new ztoolkit.ProgressWindow("AiNote", {
      closeOnClick: true,
      closeTime: 5000,
    })
      .createLine({
        text: "请先在设置中配置API Key",
        type: "error",
      })
      .show();
    return;
  }

  // Get selected items
  const items = Zotero.getActiveZoteroPane().getSelectedItems();

  if (items.length === 0) {
    new ztoolkit.ProgressWindow("AiNote", {
      closeOnClick: true,
      closeTime: 3000,
    })
      .createLine({
        text: "请先选择要处理的条目",
        type: "error",
      })
      .show();
    return;
  }

  // Create progress window
  const progressWin = new ztoolkit.ProgressWindow("AiNote", {
    closeOnClick: false,
  });

  try {
    const total = items.length;
    let successCount = 0;
    let failedCount = 0;
    const failedItems: Array<{ title: string; error: string }> = [];

    await NoteGenerator.generateNotesForItems(
      items,
      (current, total, progress, message) => {
        const itemTitle = items[current - 1].getField("title") as string;
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
            ((current - 1) / total) * 100 + (progress / total);
          
          // 检测是否是错误消息
          if (message.startsWith("Error:")) {
            failedCount++;
            failedItems.push({
              title: itemTitle,
              error: message.replace("Error: ", ""),
            });
            
            progressWin.changeLine({
              text: `${mainText} - 失败`,
              type: "error",
              progress: overallProgress,
            });
            
            // 短暂停留后继续下一个
            setTimeout(() => {
              if (current < total) {
                progressWin.changeLine({
                  text: `继续处理下一个条目...`,
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
              text: `✓ 所有 ${total} 个条目处理完成！`,
              type: "success",
              progress: 100,
            });
          } else {
            progressWin.changeLine({
              text: `完成: ${successCount} 个成功, ${failedCount} 个失败`,
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
              
              // 同时在控制台输出详细错误
              ztoolkit.log("[AiNote] Failed items details:", failedItems);
            }, 2000);
          }
          
          // 标记完成，允许进度窗在短时间后关闭
          progressWin.startCloseTimer(5000);
        }
      }
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

async function onMainWindowUnload(win: Window): Promise<void> {
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
  ztoolkit.log("notify", event, type, ids, extraData);
}

async function onPrefsEvent(type: string, data: { [key: string]: any }) {
  console.log("[AiNote] onPrefsEvent called, type:", type);
  ztoolkit.log("[AiNote] onPrefsEvent called, type:", type, "data:", data);
  
  switch (type) {
    case "load":
      console.log("[AiNote] Calling registerPrefsScripts");
      registerPrefsScripts(data.window);
      break;
    default:
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
