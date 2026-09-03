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
  type: "error" | "warning" | "success" | "info" = "info",
) {
  const Zotero =
    typeof (globalThis as any).Zotero !== "undefined"
      ? (globalThis as any).Zotero
      : undefined;
  if (Zotero) {
    const iconMap = {
      error: "chrome://zotero/skin/cross.png",
      warning: "chrome://zotero/skin/warning.png",
      success: "chrome://zotero/skin/tick.png",
      info: "chrome://zotero/skin/note.png",
    };
    if (typeof Zotero.Notifier?.showNotification === "function") {
      try {
        Zotero.Notifier.showNotification(
          message,
          iconMap[type],
          "AiNote",
          () => {
            // onclick
          },
        );
        return;
      } catch {
        // Fall through to a native modal if Zotero's optional notifier fails.
      }
    }
    const mainWindow =
      typeof Zotero.getMainWindow === "function"
        ? Zotero.getMainWindow()
        : undefined;
    if (typeof mainWindow?.alert === "function") {
      mainWindow.alert(message);
      return;
    }
  }
  console.log(`[${type}] ${message}`);
}

export function getWindow() {
  return Zotero.getMainWindow();
}
