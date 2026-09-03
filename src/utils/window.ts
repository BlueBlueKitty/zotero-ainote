export { isWindowAlive };

const HTML_NS = "http://www.w3.org/1999/xhtml";
const TOAST_CONTAINER_ID = "ainote-floating-toast-container";
type ToastType = "error" | "warning" | "success" | "info";

/**
 * Check if the window is alive.
 * Useful to prevent opening duplicate windows.
 * @param win
 */
function isWindowAlive(win?: Window) {
  return win && !Components.utils.isDeadWrapper(win) && !win.closed;
}

function createHtmlElement(doc: Document, tag: string): HTMLElement {
  return doc.createElementNS(HTML_NS, tag) as HTMLElement;
}

function getToastContainer(doc: Document): HTMLElement {
  const existing = doc.getElementById(TOAST_CONTAINER_ID);
  if (existing) return existing as HTMLElement;

  const container = createHtmlElement(doc, "div");
  container.id = TOAST_CONTAINER_ID;
  Object.assign(container.style, {
    position: "fixed",
    right: "18px",
    bottom: "18px",
    zIndex: "2147483647",
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-end",
    gap: "8px",
    width: "min(420px, calc(100vw - 36px))",
    pointerEvents: "none",
    fontFamily: "system-ui, -apple-system, sans-serif",
  });
  doc.documentElement?.appendChild(container);
  return container;
}

function showFloatingToast(
  mainWindow: Window,
  message: string,
  type: ToastType,
) {
  const doc = mainWindow.document;
  if (!doc?.documentElement) return false;

  const container = getToastContainer(doc);
  while (container.children.length >= 4) {
    container.firstElementChild?.remove();
  }

  const colors: Record<ToastType, { background: string; border: string }> = {
    error: {
      background: "rgba(127, 29, 29, 0.96)",
      border: "rgba(254, 202, 202, 0.72)",
    },
    warning: {
      background: "rgba(133, 77, 14, 0.96)",
      border: "rgba(253, 230, 138, 0.72)",
    },
    success: {
      background: "rgba(20, 83, 45, 0.96)",
      border: "rgba(187, 247, 208, 0.72)",
    },
    info: {
      background: "rgba(30, 41, 59, 0.96)",
      border: "rgba(203, 213, 225, 0.72)",
    },
  };
  const toast = createHtmlElement(doc, "div");
  const close = createHtmlElement(doc, "button") as HTMLButtonElement;
  const text = createHtmlElement(doc, "span");
  const palette = colors[type];
  let timer: number | undefined;
  let dismissed = false;

  Object.assign(toast.style, {
    display: "flex",
    alignItems: "flex-start",
    gap: "10px",
    boxSizing: "border-box",
    maxWidth: "100%",
    padding: "11px 12px 11px 14px",
    border: `1px solid ${palette.border}`,
    borderRadius: "10px",
    background: palette.background,
    color: "#ffffff",
    boxShadow: "0 8px 24px rgba(15, 23, 42, 0.28)",
    fontSize: "13px",
    lineHeight: "1.45",
    opacity: "0",
    transform: "translateY(8px)",
    transition: "opacity 160ms ease, transform 160ms ease",
    pointerEvents: "auto",
  });
  toast.setAttribute(
    "role",
    type === "error" || type === "warning" ? "alert" : "status",
  );

  text.textContent = message;
  text.style.overflowWrap = "anywhere";
  text.style.flex = "1";
  close.type = "button";
  close.textContent = "×";
  close.setAttribute("aria-label", "Close notification");
  Object.assign(close.style, {
    flex: "0 0 auto",
    margin: "-3px -4px 0 0",
    padding: "0 3px",
    border: "0",
    background: "transparent",
    color: "rgba(255, 255, 255, 0.82)",
    cursor: "pointer",
    fontSize: "19px",
    lineHeight: "1",
  });

  const dismiss = () => {
    if (dismissed) return;
    dismissed = true;
    if (timer) mainWindow.clearTimeout(timer);
    toast.style.opacity = "0";
    toast.style.transform = "translateY(8px)";
    mainWindow.setTimeout(() => toast.remove(), 180);
  };
  const startTimer = () => {
    if (dismissed) return;
    if (timer) mainWindow.clearTimeout(timer);
    const duration = type === "error" ? 6000 : type === "warning" ? 5000 : 3000;
    timer = mainWindow.setTimeout(dismiss, duration);
  };

  close.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    dismiss();
  });
  toast.addEventListener("mouseenter", () => {
    if (timer) mainWindow.clearTimeout(timer);
  });
  toast.addEventListener("mouseleave", startTimer);
  toast.appendChild(text);
  toast.appendChild(close);
  container.appendChild(toast);
  mainWindow.setTimeout(() => {
    if (!dismissed) {
      toast.style.opacity = "1";
      toast.style.transform = "translateY(0)";
    }
  }, 0);
  startTimer();
  return true;
}

/**
 * Show a non-modal floating notification in the Zotero main window.
 * @param message The message to show.
 * @param type The type of notification ('error', 'warning', 'success', 'info').
 */
export function showToast(message: string, type: ToastType = "info") {
  const Zotero =
    typeof (globalThis as any).Zotero !== "undefined"
      ? (globalThis as any).Zotero
      : undefined;
  if (Zotero) {
    const mainWindow =
      typeof Zotero.getMainWindow === "function"
        ? (Zotero.getMainWindow() as Window | undefined)
        : undefined;
    if (mainWindow && showFloatingToast(mainWindow, message, type)) {
      return;
    }
  }
  console.log(`[${type}] ${message}`);
}

export function getWindow() {
  return Zotero.getMainWindow();
}
