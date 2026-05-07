const LOG_PREFIX = "[AiNote][NoteEditorAdapter]";
const EDITOR_ROOT_SELECTOR = ".primary-editor, .ProseMirror";

export interface ActiveNoteEditorContext {
  editorInstance: Zotero.EditorInstance;
  noteItem: Zotero.Item;
  editorWindow: Window;
  editorDocument: Document;
  editorRoot: HTMLElement;
  lastContextMenuEvent: MouseEvent | null;
}

interface StoredEditorContext {
  editorInstance: Zotero.EditorInstance;
  lastContextMenuEvent: MouseEvent | null;
  lastContextTimestamp: number;
}

const editorContextStore = new WeakMap<Zotero.EditorInstance, StoredEditorContext>();
let lastGlobalEditorContext: StoredEditorContext | null = null;

export function getEditorRoot(editorInstance: Zotero.EditorInstance): HTMLElement | null {
  const editorDocument = getEditorDocument(editorInstance);
  if (!editorDocument) {
    return null;
  }
  return editorDocument.querySelector(EDITOR_ROOT_SELECTOR) as HTMLElement | null;
}

export function getEditorDocument(
  editorInstance: Zotero.EditorInstance,
): Document | null {
  const editorWindow = getEditorWindow(editorInstance);
  return editorWindow?.document || null;
}

export function getEditorWindow(
  editorInstance: Zotero.EditorInstance,
): Window | null {
  const iframeWindow = editorInstance?._iframeWindow;
  if (!iframeWindow) {
    return null;
  }

  try {
    if (Components.utils.isDeadWrapper(iframeWindow)) {
      return null;
    }
  } catch (_error) {
    return null;
  }

  return iframeWindow;
}

export function recordEditorContextMenuEvent(
  editorInstance: Zotero.EditorInstance,
  event: MouseEvent,
) {
  const storedContext: StoredEditorContext = {
    editorInstance,
    lastContextMenuEvent: event,
    lastContextTimestamp: Date.now(),
  };
  editorContextStore.set(editorInstance, storedContext);
  lastGlobalEditorContext = storedContext;
}

export function clearEditorContextMenuEvent(editorInstance: Zotero.EditorInstance) {
  const storedContext = editorContextStore.get(editorInstance);
  if (storedContext) {
    storedContext.lastContextMenuEvent = null;
  }
  if (lastGlobalEditorContext?.editorInstance === editorInstance) {
    lastGlobalEditorContext.lastContextMenuEvent = null;
  }
}

export function getActiveNoteEditorContext(
  preferredEditor?: Zotero.EditorInstance | null,
): ActiveNoteEditorContext | null {
  const candidates = [
    preferredEditor || null,
    getActiveEditorFromContextPane(),
    lastGlobalEditorContext?.editorInstance || null,
    ...getAllLiveEditorInstances(),
  ].filter(Boolean) as Zotero.EditorInstance[];

  for (const editorInstance of candidates) {
    const editorWindow = getEditorWindow(editorInstance);
    const editorDocument = editorWindow?.document;
    const editorRoot = getEditorRoot(editorInstance);
    const noteItem = editorInstance?._item;
    if (!editorWindow || !editorDocument || !editorRoot || !noteItem?.isNote?.()) {
      continue;
    }

    const storedContext = editorContextStore.get(editorInstance);
    return {
      editorInstance,
      noteItem,
      editorWindow,
      editorDocument,
      editorRoot,
      lastContextMenuEvent: storedContext?.lastContextMenuEvent || null,
    };
  }

  return null;
}

export function getAllLiveEditorInstances(): Zotero.EditorInstance[] {
  const editors = Array.isArray(Zotero.Notes?._editorInstances)
    ? Zotero.Notes._editorInstances
    : [];
  return editors.filter((editorInstance) => !!getEditorWindow(editorInstance));
}

export function readCurrentNoteHtml(noteItem: Zotero.Item): string {
  return noteItem.getNote() || "";
}

export async function writeCurrentNoteHtml(
  noteItem: Zotero.Item,
  html: string,
  originalHtml: string,
): Promise<void> {
  try {
    noteItem.setNote(html);
    await noteItem.saveTx();
  } catch (error) {
    ztoolkit.log(`${LOG_PREFIX} 写回笔记失败，准备回滚`, error);
    try {
      noteItem.setNote(originalHtml);
      await noteItem.saveTx();
      ztoolkit.log(`${LOG_PREFIX} 回滚成功`, { noteID: noteItem.id });
    } catch (rollbackError) {
      ztoolkit.log(`${LOG_PREFIX} 回滚失败`, rollbackError);
    }
    throw error;
  }
}

export function showSectionActionResult(
  text: string,
  type: "success" | "warning" | "error" = "success",
) {
  new ztoolkit.ProgressWindow("AiNote", {
    closeOnClick: true,
    closeTime: 4000,
  })
    .createLine({
      text,
      type: type === "warning" ? "default" : type,
    })
    .show();
}

export function confirmDeleteCurrentSection(
  editorWindow: Window,
  message: string,
): boolean {
  try {
    if (typeof Services !== "undefined" && Services.prompt) {
      return Services.prompt.confirm(editorWindow as any, "AiNote", message);
    }
  } catch (error) {
    ztoolkit.log(`${LOG_PREFIX} 原生确认框调用失败，改用 window.confirm`, error);
  }

  if (typeof editorWindow.confirm === "function") {
    return editorWindow.confirm(message);
  }
  return false;
}

function getActiveEditorFromContextPane(): Zotero.EditorInstance | null {
  try {
    return Zotero.getMainWindow()?.ZoteroContextPane?.activeEditor || null;
  } catch (_error) {
    return null;
  }
}
