/**
 * Compatibility seam for Zotero APIs that have changed or are not part of
 * the stable public plugin surface.
 *
 * Callers should depend on the small interfaces in this module instead of
 * reaching into Zotero's version-specific objects directly.
 */

export interface ZoteroRuntimeInfo {
  version: string;
  major: number | null;
  minor: number | null;
  patch: number | null;
}

interface FullTextAPI {
  readonly INDEX_STATE_INDEXED?: number;
  getIndexedState?: (item: Zotero.Item) => Promise<number>;
  indexItems?: (itemIDs: number[]) => Promise<unknown>;
  getItemCacheFile?: (item: Zotero.Item) => { path?: string };
}

interface EditorInternals {
  _iframeWindow?: Window | null;
  _item?: Zotero.Item | null;
  _popup?: XUL.MenuPopup | Element | null;
}

const DEFAULT_FULLTEXT_POLL_INTERVAL_MS = 250;
const DEFAULT_FULLTEXT_TIMEOUT_MS = 30_000;

export function getZoteroRuntimeInfo(): ZoteroRuntimeInfo {
  let version = "unknown";
  try {
    version = String(Zotero.version || "unknown");
  } catch (_error) {
    // Keep diagnostics usable even when called during very early startup.
  }

  return parseZoteroVersion(version);
}

export function parseZoteroVersion(version: string): ZoteroRuntimeInfo {
  const match = version.match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  return {
    version,
    major: match ? Number(match[1]) : null,
    minor: match?.[2] ? Number(match[2]) : null,
    patch: match?.[3] ? Number(match[3]) : null,
  };
}

export function getFullTextAPI(): FullTextAPI {
  const zoteroGlobal = Zotero as unknown as Record<string, unknown>;
  const fullText = zoteroGlobal.FullText || zoteroGlobal.Fulltext;
  if (!fullText || typeof fullText !== "object") {
    throw new Error("Zotero 全文索引 API 不可用");
  }
  return fullText as FullTextAPI;
}

export interface IndexedTextOptions {
  pollIntervalMs?: number;
  timeoutMs?: number;
}

export async function readIndexedPDFText(
  pdfAttachment: Zotero.Item,
  options: IndexedTextOptions = {},
): Promise<string> {
  const fullText = getFullTextAPI();
  if (
    typeof fullText.getIndexedState !== "function" ||
    typeof fullText.indexItems !== "function" ||
    typeof fullText.getItemCacheFile !== "function"
  ) {
    throw new Error("当前 Zotero 版本缺少 PDF 全文索引方法");
  }

  const indexedState = await fullText.getIndexedState(pdfAttachment);
  const indexedStateValue = fullText.INDEX_STATE_INDEXED;
  if (typeof indexedStateValue !== "number") {
    throw new Error("当前 Zotero 版本缺少全文索引状态定义");
  }

  if (indexedState !== indexedStateValue) {
    await fullText.indexItems([pdfAttachment.id]);
    await waitForIndexedPDF(
      pdfAttachment,
      fullText,
      options.pollIntervalMs ?? DEFAULT_FULLTEXT_POLL_INTERVAL_MS,
      options.timeoutMs ?? DEFAULT_FULLTEXT_TIMEOUT_MS,
      indexedStateValue,
    );
  }

  const cacheFile = fullText.getItemCacheFile(pdfAttachment);
  const cachePath = String(cacheFile?.path || "");
  if (!cachePath || !(await IOUtils.exists(cachePath))) {
    throw new Error("PDF 全文索引完成，但找不到全文缓存文件");
  }

  const content = await Zotero.File.getContentsAsync(cachePath);
  const text =
    typeof content === "string"
      ? content
      : new TextDecoder().decode(content as BufferSource);
  if (!text.trim()) {
    throw new Error("PDF 全文缓存为空");
  }
  return text;
}

async function waitForIndexedPDF(
  pdfAttachment: Zotero.Item,
  fullText: FullTextAPI,
  pollIntervalMs: number,
  timeoutMs: number,
  indexedStateValue: number,
): Promise<void> {
  if (typeof fullText.getIndexedState !== "function") {
    throw new Error("当前 Zotero 版本缺少全文索引状态方法");
  }

  const deadline = Date.now() + Math.max(0, timeoutMs);
  while (Date.now() <= deadline) {
    if ((await fullText.getIndexedState(pdfAttachment)) === indexedStateValue) {
      return;
    }
    await delay(Math.max(25, pollIntervalMs));
  }

  throw new Error(`PDF 全文索引超时（${timeoutMs} ms）`);
}

function delay(milliseconds: number): Promise<void> {
  try {
    if (typeof Zotero.Promise?.delay === "function") {
      return Zotero.Promise.delay(milliseconds);
    }
  } catch (_error) {
    // Fall through to the platform timer.
  }
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export function getEditorWindow(
  editorInstance: Zotero.EditorInstance,
): Window | null {
  const iframeWindow = (editorInstance as unknown as EditorInternals)
    ._iframeWindow;
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

export function getEditorItem(
  editorInstance: Zotero.EditorInstance,
): Zotero.Item | null {
  const item = (editorInstance as unknown as EditorInternals)._item;
  return item && item.isNote?.() ? item : null;
}

export function getEditorPopup(
  editorInstance: Zotero.EditorInstance,
): XUL.MenuPopup | null {
  const popup = (editorInstance as unknown as EditorInternals)._popup;
  if (!popup) {
    return null;
  }
  if ("tagName" in popup && popup.tagName === "menupopup") {
    return popup as XUL.MenuPopup;
  }
  if (typeof popup.querySelector === "function") {
    return popup.querySelector("menupopup") as XUL.MenuPopup | null;
  }
  return null;
}

export function getLiveEditorInstances(): Zotero.EditorInstance[] {
  const notes = Zotero.Notes as unknown as { _editorInstances?: unknown };
  const editors = notes?._editorInstances;
  if (!Array.isArray(editors)) {
    return [];
  }
  return editors.filter(
    (editor): editor is Zotero.EditorInstance =>
      !!editor && !!getEditorWindow(editor as Zotero.EditorInstance),
  );
}
