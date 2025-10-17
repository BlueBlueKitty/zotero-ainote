export { isWindowAlive };

/**
 * Check if the window is alive.
 * Useful to prevent opening duplicate windows.
 * @param win
 */
function isWindowAlive(win?: Window) {
  return win && !Components.utils.isDeadWrapper(win) && !win.closed;
}

/**
 * Show a toast notification.
 * @param message The message to show.
 * @param type The type of notification ('error', 'warning', 'success', 'info').
 */
export function showToast(
  message: string,
  type: "error" | "warning" | "success" | "info" = "info"
) {
  const Zotero = (typeof (globalThis as any).Zotero !== 'undefined' ? (globalThis as any).Zotero : undefined);
  if (Zotero) {
    const iconMap = {
      error: "chrome://zotero/skin/cross.png",
      warning: "chrome://zotero/skin/warning.png",
      success: "chrome://zotero/skin/tick.png",
      info: "chrome://zotero/skin/note.png",
    };
    Zotero.Notifier.showNotification(
      message,
      iconMap[type],
      "AiNote",
      () => {
        // onclick
      }
    );
  } else {
    console.log(`[${type}] ${message}`);
  }
}

export function getWindow() {
  return Zotero.getMainWindow();
}

export function getNoteEditorWindowByNoteId(
  noteId: number
): Window | undefined {
  try {
    const mainWindow = getWindow();
    const Zotero_Tabs = mainWindow.Zotero_Tabs as any;
    
    if (!Zotero_Tabs || !Zotero_Tabs._tabs) {
      return undefined;
    }
    
    // 获取所有标签页
    const tabs = Zotero_Tabs._tabs;
    
    for (let i = 0; i < tabs.length; i++) {
      const tab = tabs[i] as any;
      if (
        tab &&
        tab.type === "note" &&
        tab.note?.id === noteId &&
        tab.noteEditor?.isLoaded
      ) {
        return tab.noteEditor.editor.contentWindow;
      }
    }
  } catch (error) {
    console.error("Error getting note editor window:", error);
  }
  
  return undefined;
}
