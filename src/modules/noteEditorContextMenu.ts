import { config } from "../../package.json";
import {
  clearEditorContextMenuEvent,
  getActiveNoteEditorContext,
  getAllLiveEditorInstances,
  getEditorRoot,
  recordEditorContextMenuEvent,
  showSectionActionResult,
} from "./noteEditorAdapter";
import {
  findClosestHeading,
  NoteSectionActionType,
  runNoteSectionAction,
} from "./noteSectionActions";
import { getString } from "../utils/locale";
import { runtimeT } from "../utils/runtimeLocale";

const LOG_PREFIX = "[AiNote][NoteEditorContextMenu]";
const CUSTOM_MENU_ID = "ainote-note-section-context-menu";
const ROOT_MENU_ITEM_ID = "ainote-note-section-context-root";
const ROOT_SUBMENU_POPUP_ID = `${ROOT_MENU_ITEM_ID}-popup`;
const MENU_SEPARATOR_ID = `${ROOT_MENU_ITEM_ID}-separator`;
const MENU_ICON = `chrome://${config.addonRef}/content/icons/favicon.png`;

interface MenuActionDefinition {
  id: NoteSectionActionType;
  label: string;
}

interface WindowMenuState {
  observer: MutationObserver | null;
  scanHandler: () => void;
}

const MENU_ACTIONS: MenuActionDefinition[] = [
  {
    id: "section-upgrade-heading",
    label: runtimeT({
      "en-US": "Upgrade Current Heading",
      "zh-CN": "当前章节标题升级",
      "zh-TW": "目前章節標題升級",
    }),
  },
  {
    id: "section-downgrade-heading",
    label: runtimeT({
      "en-US": "Downgrade Current Heading",
      "zh-CN": "当前章节标题降级",
      "zh-TW": "目前章節標題降級",
    }),
  },
  {
    id: "section-increase-number",
    label: runtimeT({
      "en-US": "Increase Section Number",
      "zh-CN": "当前章节序号 +1",
      "zh-TW": "目前章節序號 +1",
    }),
  },
  {
    id: "section-decrease-number",
    label: runtimeT({
      "en-US": "Decrease Section Number",
      "zh-CN": "当前章节序号 -1",
      "zh-TW": "目前章節序號 -1",
    }),
  },
  {
    id: "section-delete",
    label: runtimeT({
      "en-US": "Delete Current Section",
      "zh-CN": "删除当前章节",
      "zh-TW": "刪除目前章節",
    }),
  },
];

const windowStateStore = new WeakMap<Window, WindowMenuState>();

export function installNoteEditorContextMenuForWindow(win: Window) {
  if (windowStateStore.has(win)) {
    return;
  }

  const scanHandler = () => {
    scanAndBindEditors();
  };

  const observer = new win.MutationObserver(() => {
    scanHandler();
  });

  observer.observe(win.document.documentElement, {
    childList: true,
    subtree: true,
  });

  win.addEventListener("focus", scanHandler, true);
  win.addEventListener("mousedown", scanHandler, true);

  windowStateStore.set(win, {
    observer,
    scanHandler,
  });

  scanAndBindEditors();
}

export function uninstallNoteEditorContextMenuForWindow(win: Window) {
  const state = windowStateStore.get(win);
  if (!state) {
    return;
  }

  state.observer?.disconnect();
  win.removeEventListener("focus", state.scanHandler, true);
  win.removeEventListener("mousedown", state.scanHandler, true);
  windowStateStore.delete(win);
}

function scanAndBindEditors() {
  for (const editorInstance of getAllLiveEditorInstances()) {
    bindEditorInstance(editorInstance);
  }
}

function bindEditorInstance(editorInstance: Zotero.EditorInstance) {
  if ((editorInstance as any).__ainoteContextMenuBound) {
    ensureNativePopupBound(editorInstance);
    return;
  }

  const editorWindow = editorInstance._iframeWindow;
  const editorDocument = editorWindow?.document;
  const editorRoot = getEditorRoot(editorInstance);
  if (!editorWindow || !editorDocument || !editorRoot) {
    return;
  }

  (editorInstance as any).__ainoteContextMenuBound = true;
  ensureNativePopupBound(editorInstance);

  editorRoot.addEventListener(
    "contextmenu",
    (event: MouseEvent) => {
      const heading = findClosestHeading(event.target as Node | null);
      if (!heading) {
        clearEditorContextMenuEvent(editorInstance);
        hideCustomContextMenu(editorDocument);
        return;
      }

      recordEditorContextMenuEvent(editorInstance, event);
      ensureNativePopupBound(editorInstance);
      const popup = getNativePopupElement(editorInstance);
      if (!popup) {
        event.preventDefault();
        openCustomContextMenu(editorInstance, event);
      }
    },
    true,
  );

  editorDocument.addEventListener(
    "click",
    () => {
      hideCustomContextMenu(editorDocument);
      clearEditorContextMenuEvent(editorInstance);
    },
    true,
  );

  editorDocument.addEventListener(
    "keydown",
    () => {
      hideCustomContextMenu(editorDocument);
    },
    true,
  );
}

function ensureNativePopupBound(editorInstance: Zotero.EditorInstance) {
  const popup = getNativePopupElement(editorInstance);
  if (!popup || (popup as any).__ainoteContextMenuBound) {
    return;
  }

  (popup as any).__ainoteContextMenuBound = true;
  popup.addEventListener("popupshowing", () => {
    ensureNativePopupMenuItems(editorInstance, popup);
  });
  ensureNativePopupMenuItems(editorInstance, popup);
}

function ensureNativePopupMenuItems(
  editorInstance: Zotero.EditorInstance,
  popup: XUL.MenuPopup,
) {
  const doc = popup.ownerDocument;
  if (!doc) {
    return;
  }

  let separator = doc.getElementById(MENU_SEPARATOR_ID) as any;
  if (!separator) {
    separator = doc.createXULElement("menuseparator") as any;
    separator.id = MENU_SEPARATOR_ID;
    popup.appendChild(separator);
  }

  const hasHeadingContext = !!getHeadingContext(editorInstance);
  separator.hidden = !hasHeadingContext;

  let rootMenu = doc.getElementById(ROOT_MENU_ITEM_ID) as any;
  if (!rootMenu) {
    rootMenu = doc.createXULElement("menu") as any;
    rootMenu.id = ROOT_MENU_ITEM_ID;
    rootMenu.setAttribute("label", getString("note-section-menu"));
    rootMenu.setAttribute("class", "menu-iconic");
    rootMenu.setAttribute("image", MENU_ICON);
    popup.appendChild(rootMenu);
  }
  rootMenu.hidden = !hasHeadingContext;

  let submenuPopup = doc.getElementById(ROOT_SUBMENU_POPUP_ID) as any;
  if (!submenuPopup) {
    submenuPopup = doc.createXULElement("menupopup") as any;
    submenuPopup.id = ROOT_SUBMENU_POPUP_ID;
    rootMenu.appendChild(submenuPopup);
  }

  for (const action of MENU_ACTIONS) {
    let menuitem = doc.getElementById(`${ROOT_MENU_ITEM_ID}-${action.id}`) as any;
    if (!menuitem) {
      menuitem = doc.createXULElement("menuitem") as any;
      menuitem.id = `${ROOT_MENU_ITEM_ID}-${action.id}`;
      menuitem.setAttribute("label", action.label);
      menuitem.setAttribute("class", "menuitem-iconic");
      menuitem.setAttribute("image", MENU_ICON);
      menuitem.addEventListener("command", () => {
        void executeSectionAction(editorInstance, action.id);
      });
      submenuPopup.appendChild(menuitem);
    }
  }
}

function openCustomContextMenu(
  editorInstance: Zotero.EditorInstance,
  event: MouseEvent,
) {
  const editorDocument = editorInstance._iframeWindow?.document;
  if (!editorDocument || !getHeadingContext(editorInstance)) {
    return;
  }

  hideCustomContextMenu(editorDocument);

  const container = editorDocument.createElement("div");
  container.id = CUSTOM_MENU_ID;
  container.setAttribute("role", "menu");
  container.style.position = "fixed";
  container.style.left = `${event.clientX}px`;
  container.style.top = `${event.clientY}px`;
  container.style.zIndex = "2147483647";
  container.style.minWidth = "210px";
  container.style.padding = "6px 0";
  container.style.background = "#ffffff";
  container.style.border = "1px solid rgba(0, 0, 0, 0.18)";
  container.style.borderRadius = "6px";
  container.style.boxShadow = "0 8px 24px rgba(0, 0, 0, 0.18)";
  container.style.fontSize = "13px";

  const rootButton = editorDocument.createElement("button");
  rootButton.type = "button";
  rootButton.style.display = "flex";
  rootButton.style.alignItems = "center";
  rootButton.style.gap = "8px";
  rootButton.style.width = "100%";
  rootButton.style.padding = "8px 14px";
  rootButton.style.border = "none";
  rootButton.style.background = "transparent";
  rootButton.style.textAlign = "left";
  rootButton.style.cursor = "pointer";
  rootButton.style.position = "relative";

  const rootIcon = editorDocument.createElement("img");
  rootIcon.src = MENU_ICON;
  rootIcon.width = 16;
  rootIcon.height = 16;

  const rootLabel = editorDocument.createElement("span");
  rootLabel.textContent = getString("note-section-menu");
  rootLabel.style.flex = "1";

  const arrow = editorDocument.createElement("span");
  arrow.textContent = "›";
  arrow.style.marginLeft = "8px";
  arrow.style.opacity = "0.7";

  const submenu = editorDocument.createElement("div");
  submenu.style.position = "absolute";
  submenu.style.left = "100%";
  submenu.style.top = "0";
  submenu.style.marginLeft = "4px";
  submenu.style.minWidth = "220px";
  submenu.style.padding = "6px 0";
  submenu.style.background = "#ffffff";
  submenu.style.border = "1px solid rgba(0, 0, 0, 0.18)";
  submenu.style.borderRadius = "6px";
  submenu.style.boxShadow = "0 8px 24px rgba(0, 0, 0, 0.18)";
  submenu.style.display = "none";

  rootButton.appendChild(rootIcon);
  rootButton.appendChild(rootLabel);
  rootButton.appendChild(arrow);

  for (const action of MENU_ACTIONS) {
    const button = editorDocument.createElement("button");
    button.type = "button";
    button.style.display = "flex";
    button.style.alignItems = "center";
    button.style.gap = "8px";
    button.style.width = "100%";
    button.style.padding = "8px 14px";
    button.style.border = "none";
    button.style.background = "transparent";
    button.style.textAlign = "left";
    button.style.cursor = "pointer";

    const icon = editorDocument.createElement("img");
    icon.src = MENU_ICON;
    icon.width = 16;
    icon.height = 16;

    const label = editorDocument.createElement("span");
    label.textContent = action.label;

    button.appendChild(icon);
    button.appendChild(label);
    button.addEventListener("mouseenter", () => {
      button.style.background = "rgba(0, 0, 0, 0.06)";
    });
    button.addEventListener("mouseleave", () => {
      button.style.background = "transparent";
    });
    button.addEventListener("click", () => {
      hideCustomContextMenu(editorDocument);
      void executeSectionAction(editorInstance, action.id);
    });
    submenu.appendChild(button);
  }

  rootButton.addEventListener("mouseenter", () => {
    rootButton.style.background = "rgba(0, 0, 0, 0.06)";
    submenu.style.display = "block";
  });
  rootButton.addEventListener("mouseleave", () => {
    rootButton.style.background = "transparent";
    submenu.style.display = "none";
  });
  submenu.addEventListener("mouseenter", () => {
    rootButton.style.background = "rgba(0, 0, 0, 0.06)";
    submenu.style.display = "block";
  });
  submenu.addEventListener("mouseleave", () => {
    rootButton.style.background = "transparent";
    submenu.style.display = "none";
  });

  rootButton.appendChild(submenu);
  container.appendChild(rootButton);

  const mountTarget = editorDocument.body || editorDocument.documentElement;
  if (!mountTarget) {
    return;
  }
  mountTarget.appendChild(container);
}

function hideCustomContextMenu(editorDocument: Document) {
  editorDocument.getElementById(CUSTOM_MENU_ID)?.remove();
}

async function executeSectionAction(
  editorInstance: Zotero.EditorInstance,
  action: NoteSectionActionType,
) {
  try {
    const context = getActiveNoteEditorContext(editorInstance);
    if (!context) {
      showSectionActionResult(getString("note-section-no-editor-context"), "error");
      return;
    }
    if (!findClosestHeading(context.lastContextMenuEvent?.target as Node | null)) {
      showSectionActionResult(getString("note-section-request-place-cursor"), "warning");
      return;
    }
    await runNoteSectionAction(action, context);
  } catch (error: any) {
    ztoolkit.log(`${LOG_PREFIX} 执行章节操作失败`, error);
    showSectionActionResult(
      getString("note-section-error", {
        args: { message: error?.message || "" },
      }),
      "error",
    );
  }
}

function getHeadingContext(editorInstance: Zotero.EditorInstance): HTMLElement | null {
  const context = getActiveNoteEditorContext(editorInstance);
  return findClosestHeading(context?.lastContextMenuEvent?.target as Node | null);
}

function getNativePopupElement(
  editorInstance: Zotero.EditorInstance,
): XUL.MenuPopup | null {
  const popup = editorInstance?._popup;
  if (!popup) {
    return null;
  }
  if (popup.tagName === "menupopup") {
    return popup as XUL.MenuPopup;
  }
  if (typeof popup.querySelector === "function") {
    return popup.querySelector("menupopup") as XUL.MenuPopup | null;
  }
  return null;
}
