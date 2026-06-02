import { config } from "../../package.json";
import { getPref, setPref } from "../utils/prefs";
import { ensurePromptTemplateState } from "../utils/prompts";
import { parseProfiles } from "./llmProfiles";
import {
  isActiveTask,
  sortActiveTasks,
  sortHistoryTasks,
} from "./summaryTaskPartition";
import { OutputWindow } from "./outputWindow";
import { SummaryTaskManager } from "./summaryTaskManager";
import { SummaryTask, SummaryTaskSnapshot } from "./summaryTaskTypes";
import { WebSummaryWorkflow } from "./webSummaryWorkflow";
import { getString } from "../utils/locale";
import { isWindowAlive, showToast } from "../utils/window";
import { HistorySyncStore, HistoryRecord } from "./historySyncStore";

const HTML_NS = "http://www.w3.org/1999/xhtml";
const REQUIRED_ELEMENT_IDS = [
  "ainote-summary-manager",
  "ainote-profile-select",
  "ainote-template-select",
  "ainote-task-list",
  "ainote-task-detail",
];
const HTML_DIALOG_TAGS = new Set([
  "button",
  "div",
  "h3",
  "label",
  "option",
  "select",
  "span",
  "strong",
  "style",
  "title",
]);
type SelectOption = { value: string; label: string };

export function normalizeDetailHeadingLevels(html: string): string {
  const raw = String(html || "");
  if (!raw.trim()) {
    return raw;
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(`<body>${raw}</body>`, "text/html");
  const body = doc.body;
  if (!body) {
    return raw;
  }
  const headings = Array.from(body.querySelectorAll("h1, h2, h3, h4, h5, h6")) as HTMLElement[];
  if (!headings.length) {
    return raw;
  }

  const levels = headings
    .map((heading) => parseInt(heading.tagName.slice(1), 10))
    .filter((level) => Number.isFinite(level));
  const minLevel = Math.min(...levels);
  if (!Number.isFinite(minLevel) || minLevel <= 1) {
    return raw;
  }

  const shift = minLevel - 1;
  for (const heading of headings) {
    const currentLevel = parseInt(heading.tagName.slice(1), 10);
    if (!Number.isFinite(currentLevel)) {
      continue;
    }
    const nextLevel = Math.max(1, currentLevel - shift);
    if (nextLevel === currentLevel) {
      continue;
    }
    const replacement = doc.createElement(`h${nextLevel}`);
    for (const attribute of Array.from(heading.attributes)) {
      replacement.setAttribute(attribute.name, attribute.value);
    }
    while (heading.firstChild) {
      replacement.appendChild(heading.firstChild);
    }
    heading.replaceWith(replacement);
  }

  return String(body.innerHTML);
}

function normalizeVisualStatus(status: string): SummaryTask["status"] {
  if (status === "succeeded") return "completed";
  if (status === "canceled") return "cancelled";
  if (status === "interrupted") return "cancelled";
  if (status === "processing") return "running";
  if (
    status === "pending" ||
    status === "running" ||
    status === "completed" ||
    status === "failed" ||
    status === "cancelled"
  ) {
    return status;
  }
  return "pending";
}

function statusLabel(status: SummaryTask["status"]): string {
  const map: Record<string, string> = {
    pending: getString("summary-manager-status-pending" as any),
    running: getString("summary-manager-status-running" as any),
    completed: getString("summary-manager-status-completed" as any),
    failed: getString("summary-manager-status-failed" as any),
    cancelled: getString("summary-manager-status-cancelled" as any),
  };
  return map[status] || status;
}

function formatTaskTimeToMinute(timestamp?: number): string {
  if (!timestamp || !Number.isFinite(timestamp)) return "-";
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day} ${hour}:${minute}`;
}

export function showSummaryManagerAlert(message: string, win?: Window): void {
  try {
    if (typeof Services !== "undefined" && Services.prompt) {
      Services.prompt.alert(win as any, "AiNote", message);
      return;
    }
  } catch (error) {
    ztoolkit.log("[AiNote][SummaryManagerWindow] Failed to show native alert", error);
  }

  if (win && typeof win.alert === "function") {
    win.alert(message);
    return;
  }

  showToast(message, "error");
}

function extractYearFromDate(value: string): string {
  const raw = String(value || "").trim();
  if (!raw) return "-";
  const match = raw.match(/(1[5-9]\d{2}|20\d{2}|21\d{2})/);
  return match?.[1] || "-";
}

function formatSummaryManagerItemTitle(item: Zotero.Item): string {
  const firstCreator = String(item.getField("firstCreator") || "").trim() || "Unknown";
  const year = extractYearFromDate(String(item.getField("date") || ""));
  const title = String(item.getField("title") || "").trim() || "Untitled";
  return `${firstCreator} - ${year} - ${title}`;
}

function getSummaryManagerTaskTitle(task: SummaryTask): string {
  const item = task.itemID ? Zotero.Items.get(task.itemID) : null;
  if (item) {
    return formatSummaryManagerItemTitle(item);
  }
  return String(task.title || "").trim() || "Untitled";
}

function inferTemplateNameFromTaskTitle(taskTitle: string): string {
  const raw = String(taskTitle || "").trim();
  if (!raw) return "";
  const splitIndex = raw.indexOf(" - ");
  if (splitIndex <= 0) return "";
  const left = raw.slice(0, splitIndex).trim();
  const right = raw.slice(splitIndex + 3).trim();
  if (!left || !right) return "";
  return left;
}

function inferTemplateNameFromContent(content: string): string {
  const raw = String(content || "").trim();
  if (!raw) return "";
  const plain = raw.replace(/<[^>]*>/g, " ").replace(/&nbsp;/gi, " ");
  const firstLine = plain.split(/\r?\n/).find((line) => String(line || "").trim());
  if (!firstLine) return "";
  const normalized = firstLine.replace(/^#{1,6}\s+/, "").trim();
  if (!normalized) return "";
  const splitIndex = normalized.indexOf(" - ");
  if (splitIndex <= 0) return "";
  const left = normalized.slice(0, splitIndex).trim();
  const right = normalized.slice(splitIndex + 3).trim();
  if (!left || !right) return "";
  if (/^h[1-6]$/i.test(left)) return "";
  return left;
}

function getCurrentPromptTemplateNames(): string[] {
  const state = ensurePromptTemplateState(
    getPref("promptTemplates" as any),
    getPref("activePromptTemplateId" as any),
    getPref("promptTemplatesVersion" as any),
  );
  return state.templates
    .map((template) => String(template.name || "").trim())
    .filter(Boolean);
}

function getPromptTemplateNameById(templateId?: string): string {
  const wantedId = String(templateId || "").trim();
  if (!wantedId) return "";
  const state = ensurePromptTemplateState(
    getPref("promptTemplates" as any),
    getPref("activePromptTemplateId" as any),
    getPref("promptTemplatesVersion" as any),
  );
  return (
    state.templates.find((template) => String(template.id || "").trim() === wantedId)
      ?.name || ""
  ).trim();
}

function statusColor(
  status: SummaryTask["status"],
  isDark: boolean,
): string {
  if (status === "completed") {
    return isDark ? "#86efac" : "#15803d";
  }
  if (status === "failed") {
    return isDark ? "#fca5a5" : "#b91c1c";
  }
  if (status === "cancelled") {
    return isDark ? "#fcd34d" : "#a16207";
  }
  return isDark ? "#c7ccd1" : "#666";
}

function rowBackgroundColor(
  status: SummaryTask["status"],
  isDark: boolean,
  selected: boolean,
): string {
  void status;
  if (selected) return isDark ? "#334155" : "#dbeafe";
  return isDark ? "#2a2f39" : "#ffffff";
}

function rowBorderColor(
  status: SummaryTask["status"],
  isDark: boolean,
  selected: boolean,
): string {
  if (status === "completed") return selected ? "#16a34a" : isDark ? "#22c55e" : "#16a34a";
  if (status === "failed") return selected ? "#dc2626" : isDark ? "#ef4444" : "#dc2626";
  if (status === "cancelled") {
    return selected ? "#d97706" : isDark ? "#f59e0b" : "#d97706";
  }
  if (status === "running") return selected ? "#1d4ed8" : isDark ? "#2563eb" : "#1d4ed8";
  if (status === "pending") return selected ? "#60a5fa" : isDark ? "#60a5fa" : "#93c5fd";
  return selected ? "#59c0bc" : isDark ? "#4b5563" : "#ddd";
}

function rowAccentColor(
  status: SummaryTask["status"],
  isDark: boolean,
  selected: boolean,
): string {
  if (status === "completed") {
    return isDark ? "#22c55e" : "#16a34a";
  }
  if (status === "failed") {
    return isDark ? "#ef4444" : "#dc2626";
  }
  if (status === "cancelled") {
    return isDark ? "#f59e0b" : "#d97706";
  }
  if (status === "running") {
    return isDark ? "#2563eb" : "#1d4ed8";
  }
  return selected ? "#93c5fd" : isDark ? "#60a5fa" : "#93c5fd";
}

function applyTaskRowAppearance(
  row: HTMLElement,
  status: SummaryTask["status"],
  isDark: boolean,
  selected: boolean,
): void {
  const background = rowBackgroundColor(status, isDark, selected);
  const accent = rowAccentColor(status, isDark, selected);
  row.style.setProperty(
    "border",
    `2px solid ${rowBorderColor(status, isDark, selected)}`,
    "important",
  );
  row.style.setProperty("border-left-width", selected ? "10px" : "6px", "important");
  row.style.setProperty(
    "border-left-color",
    accent,
    "important",
  );
  row.style.borderRadius = "8px";
  row.style.padding = "10px";
  row.style.marginBottom = "8px";
  row.style.cursor = "pointer";
  row.style.setProperty("background", background, "important");
  row.style.setProperty("background-color", background, "important");
  row.style.setProperty(
    "box-shadow",
    selected
      ? isDark
        ? `0 0 0 3px ${accent}66, 0 14px 28px rgba(0, 0, 0, 0.42)`
        : `0 0 0 2px ${accent}33, 0 8px 20px rgba(29, 78, 216, 0.12)`
      : "none",
    "important",
  );
}

function buttonClass(variant: "default" | "danger" | "primary" = "default") {
  const base = "ainote-op-btn";
  if (variant === "danger") return `${base} ${base}-danger`;
  if (variant === "primary") return `${base} ${base}-primary`;
  return base;
}

function createHtmlElement<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
): HTMLElementTagNameMap[K] {
  return doc.createElementNS(HTML_NS, tag) as HTMLElementTagNameMap[K];
}

function bindButtonAction(
  element: HTMLElement,
  handler: (event: Event) => void | Promise<void>,
) {
  let pending = false;
  const wrapped = (event: Event) => {
    event.preventDefault?.();
    event.stopPropagation?.();
    if (pending) return;
    pending = true;
    Promise.resolve(handler(event)).finally(() => {
      setTimeout(() => {
        pending = false;
      }, 0);
    });
  };
  element.addEventListener("click", wrapped);
  element.addEventListener("command", wrapped as EventListener);
}

function getCustomSelectValue(select: Element): string {
  return (select as HTMLElement).dataset.value || "";
}

function getCustomSelectParts(select: Element): {
  button: HTMLButtonElement | null;
  menu: HTMLElement | null;
} {
  return {
    button: select.querySelector(
      ".ainote-select-trigger",
    ) as HTMLButtonElement | null,
    menu: select.querySelector(".ainote-select-menu") as HTMLElement | null,
  };
}

function hideCustomSelectMenus(doc: Document, except?: Element): void {
  doc.querySelectorAll(".ainote-custom-select").forEach((select: Element) => {
    if (except && select === except) return;
    const menu = select.querySelector(
      ".ainote-select-menu",
    ) as HTMLElement | null;
    menu?.setAttribute("hidden", "true");
  });
}

function setCustomSelectValue(
  select: Element,
  value: string,
  options: SelectOption[] = [],
): void {
  const { button, menu } = getCustomSelectParts(select);
  const fallback =
    options.find((option) => option.value === value) || options[0];
  const finalValue = fallback?.value || value || "";
  const finalLabel = fallback?.label || getString("summary-manager-unset" as any);

  (select as HTMLElement).dataset.value = finalValue;
  select.setAttribute("data-value", finalValue);
  if (button) {
    button.textContent = finalLabel;
    button.title = finalLabel;
  }
  menu?.querySelectorAll(".ainote-select-option").forEach((item: Element) => {
    const selected = item.getAttribute("data-value") === finalValue;
    item.toggleAttribute("aria-selected", selected);
    item.classList.toggle("is-selected", selected);
  });
}

function populateCustomSelect(
  doc: Document,
  select: Element,
  options: SelectOption[],
  selectedValue: string,
  force = false,
): void {
  const { menu } = getCustomSelectParts(select);
  if (!menu) return;

  if (force || menu.children.length === 0) {
    menu.replaceChildren();
    options.forEach((option) => {
      const item = createHtmlElement(doc, "button");
      item.type = "button";
      item.className = "ainote-select-option";
      item.dataset.value = option.value;
      item.textContent = option.label;
      item.title = option.label;
      menu.appendChild(item);
    });
  }

  setCustomSelectValue(select, selectedValue, options);
}

function createHtmlDialog(): any {
  const dialog = new ztoolkit.Dialog(1, 1) as any;
  const originalCreateElement = dialog.createElement?.bind(dialog);

  if (originalCreateElement) {
    dialog.createElement = (
      doc: Document,
      tagName: string,
      props: any = {},
    ) => {
      if (HTML_DIALOG_TAGS.has(tagName) && !props.namespace) {
        props = { ...props, namespace: "html" };
      }
      return originalCreateElement(doc, tagName, props);
    };
  }

  return dialog;
}

export class SummaryManagerWindow {
  private static instance: SummaryManagerWindow | null = null;

  private static getSharedState(): {
    instance?: SummaryManagerWindow;
    window?: Window;
  } {
    const data = ((addon.data as any).__ainoteSummaryManagerState ||= {});
    return data;
  }

  public static async open(): Promise<void> {
    const shared = this.getSharedState();
    if (!shared.instance) {
      shared.instance = this.instance || new SummaryManagerWindow();
    }
    this.instance = shared.instance;
    await this.instance.open();
  }

  private dialog: any;
  private manager = SummaryTaskManager.getInstance();
  private unsubscribe: (() => void) | null = null;
  private isOpen = false;
  private initialized = false;
  private controlsInitialized = false;
  private themeMediaQuery: MediaQueryList | null = null;
  private themeObserver: MutationObserver | null = null;
  private initializePromise: Promise<void> | null = null;
  private openPromise: Promise<void> | null = null;
  private activeCollapsed = false;
  private historyCollapsed = false;
  private mathJaxInjected = false;
  private historyRecords: HistoryRecord[] = [];
  private historyLoaded = false;
  private historyLoading = false;
  private lastActiveTaskIds = new Set<string>();
  private historySearch = "";
  private historyContentRefreshing = new Set<string>();
  private readonly mainPaneSplitRatioPrefKey = "summaryMainPaneSplitRatioV1" as any;
  private readonly mainPaneSplitRatioPrefFullKey = `${config.prefsPrefix}.summaryMainPaneSplitRatioV1`;
  private mainPaneSplitRatio = 0.35;
  private mainSplitterBound = false;
  private mainSplitterDragging = false;
  private readonly mainMinLeftWidthPx = 280;
  private readonly mainMinRightWidthPx = 360;
  private readonly splitRatioPrefKey = "summaryListSplitRatioV2" as any;
  private readonly legacySplitRatioPrefKey = "summaryListSplitRatio" as any;
  private readonly splitRatioPrefFullKey = `${config.prefsPrefix}.summaryListSplitRatioV2`;
  private listSplitRatio = 0.3;
  private splitterBound = false;
  private splitterDragging = false;
  private readonly minSplitRatio = 0.3;
  private readonly maxSplitRatio = 0.7;

  private getLiveDialogWindow(): Window | undefined {
    const shared = SummaryManagerWindow.getSharedState();
    const dialogWindow = this.dialog?.window as Window | undefined;
    if (isWindowAlive(dialogWindow)) {
      shared.window = dialogWindow;
      return dialogWindow;
    }
    if (isWindowAlive(shared.window)) {
      return shared.window;
    }
    if (shared.window) {
      shared.window = undefined;
    }
    return undefined;
  }

  private async open(): Promise<void> {
    if (this.openPromise) {
      return this.openPromise;
    }

    this.openPromise = this.openInternal();
    try {
      await this.openPromise;
    } finally {
      this.openPromise = null;
    }
  }

  private async openInternal(): Promise<void> {
    await this.manager.ensureLoaded();

    const existingWindow = this.getLiveDialogWindow();
    if (existingWindow) {
      this.isOpen = true;
      this.dialog = this.dialog || {};
      this.dialog.window = existingWindow;
      existingWindow.focus();
      return;
    }

    const dialogData: { [key: string]: any } = {
      loadCallback: () => {
        void this.initializeWindow();
      },
      unloadCallback: () => {
        const shared = SummaryManagerWindow.getSharedState();
        const currentWindow = this.dialog?.window as Window | undefined;
        this.unsubscribe?.();
        this.unsubscribe = null;
        this.themeMediaQuery?.removeEventListener(
          "change",
          this.handleThemeChange,
        );
        this.themeMediaQuery = null;
        this.themeObserver?.disconnect();
        this.themeObserver = null;
        this.dialog?.window?.removeEventListener(
          "focus",
          this.handleThemeChange,
        );
        this.dialog?.window?.removeEventListener(
          "focus",
          this.handleWindowFocus,
        );
        this.initialized = false;
        this.controlsInitialized = false;
        this.mathJaxInjected = false;
        this.initializePromise = null;
        this.openPromise = null;
        this.lastActiveTaskIds.clear();
        this.mainSplitterBound = false;
        this.mainSplitterDragging = false;
        this.splitterBound = false;
        this.splitterDragging = false;
        this.saveMainPaneSplitRatio();
        this.saveListSplitRatio();
        this.isOpen = false;
        if (shared.window === currentWindow) {
          shared.window = undefined;
        }
      },
    };

    this.dialog = createHtmlDialog()
      .addCell(0, 0, {
        tag: "div",
        id: "ainote-summary-manager",
        styles: {
          position: "fixed",
          inset: "0",
          minHeight: "0",
          display: "flex",
          flexDirection: "column",
          fontFamily: "system-ui, -apple-system, sans-serif",
        },
        children: [
          {
            tag: "style",
            namespace: "html",
            id: "ainote-summary-manager-style",
            properties: {
              innerHTML: `
                .ainote-op-btn { font-size: 12px; padding: 4px 10px; border-radius: 6px; border: 1px solid #c9ced6; background: #fff; color: #1f2937; cursor: pointer; }
                .ainote-op-btn:hover { border-color: #8fa5c2; }
                .ainote-op-btn:disabled { opacity: 0.45; cursor: not-allowed; }
                .ainote-op-btn-danger { border-color: #f0b5b5; color: #b42318; background: #fff7f7; }
                .ainote-op-btn-primary { border-color: #8fd4cf; color: #0f766e; background: #f0fffe; }
                .ainote-row-actions { display:flex; gap:8px; margin-top:8px; flex-wrap: wrap; }
              `,
            },
          },
          {
            tag: "div",
            id: "ainote-header",
            styles: {
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "12px 16px",
              borderBottom: "1px solid #ddd",
              gap: "12px",
            },
            children: [
              {
                tag: "div",
                namespace: "html",
                properties: {
                  innerHTML: `<strong>${getString("summary-manager-title" as any)}</strong>`,
                },
              },
              {
                tag: "div",
                styles: {
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  flexWrap: "wrap",
                  justifyContent: "flex-end",
                },
                children: [
                  {
                    tag: "label",
                    namespace: "html",
                    properties: { innerHTML: getString("summary-manager-model" as any) },
                  },
                  {
                    tag: "div",
                    namespace: "html",
                    id: "ainote-profile-select",
                    properties: { className: "ainote-custom-select" },
                    children: [
                      {
                        tag: "button",
                        namespace: "html",
                        properties: {
                          className: "ainote-select-trigger",
                          type: "button",
                          innerHTML: getString("summary-manager-loading" as any),
                        },
                      },
                      {
                        tag: "div",
                        namespace: "html",
                        properties: {
                          className: "ainote-select-menu",
                          hidden: true,
                        },
                      },
                    ],
                  },
                  {
                    tag: "label",
                    namespace: "html",
                    properties: { innerHTML: getString("summary-manager-template" as any) },
                  },
                  {
                    tag: "div",
                    namespace: "html",
                    id: "ainote-template-select",
                    properties: { className: "ainote-custom-select" },
                    children: [
                      {
                        tag: "button",
                        namespace: "html",
                        properties: {
                          className: "ainote-select-trigger",
                          type: "button",
                          innerHTML: getString("summary-manager-loading" as any),
                        },
                      },
                      {
                        tag: "div",
                        namespace: "html",
                        properties: {
                          className: "ainote-select-menu",
                          hidden: true,
                        },
                      },
                    ],
                  },
                  {
                    tag: "button",
                    namespace: "html",
                    id: "ainote-clear-history",
                    properties: {
                      innerHTML: getString("summary-manager-clear" as any),
                    },
                  },
                ],
              },
            ],
          },
          {
            tag: "div",
            id: "ainote-main",
            styles: { flex: "1", display: "flex", minHeight: "0" },
            children: [
              {
                tag: "div",
                id: "ainote-task-list-pane",
                styles: {
                  width: "35%",
                  display: "flex",
                  flexDirection: "column",
                  minHeight: "0",
                  minWidth: "0",
                  overflow: "hidden",
                },
                children: [
                  {
                    tag: "div",
                    id: "ainote-task-list",
                    styles: {
                      flex: "1",
                      overflow: "hidden",
                      overflowY: "auto",
                      overflowX: "hidden",
                      overscrollBehavior: "contain",
                      padding: "8px",
                      display: "flex",
                      flexDirection: "column",
                      gap: "8px",
                    },
                  },
                  {
                    tag: "div",
                    styles: {
                      borderTop: "1px solid #ddd",
                      padding: "8px",
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr 1fr",
                      gap: "8px",
                    },
                    children: [
                      {
                        tag: "button",
                        namespace: "html",
                        id: "ainote-stop-active",
                        styles: { whiteSpace: "nowrap" },
                        properties: {
                          innerHTML: getString("summary-manager-stop-active" as any),
                        },
                      },
                      {
                        tag: "button",
                        namespace: "html",
                        id: "ainote-retry-active",
                        styles: { whiteSpace: "nowrap" },
                        properties: {
                          innerHTML: getString("summary-manager-retry-active" as any),
                        },
                      },
                      {
                        tag: "button",
                        namespace: "html",
                        id: "ainote-remove-active",
                        styles: { whiteSpace: "nowrap" },
                        properties: {
                          innerHTML: getString("summary-manager-remove-active" as any),
                        },
                      },
                    ],
                  },
                ],
              },
              {
                tag: "div",
                id: "ainote-main-splitter",
                styles: {
                  width: "8px",
                  cursor: "col-resize",
                  flex: "0 0 auto",
                  userSelect: "none",
                  touchAction: "none",
                },
              },
              {
                tag: "div",
                id: "ainote-task-detail",
                styles: {
                  flex: "1",
                  minWidth: "0",
                  overflow: "auto",
                  overflowY: "auto",
                  overflowX: "hidden",
                  overscrollBehavior: "contain",
                  padding: "12px",
                },
              },
            ],
          },
        ],
      })
      .setDialogData(dialogData)
      .open(getString("summary-manager-title" as any), {
        width: 980,
        height: 680,
        centerscreen: true,
        resizable: true,
        noDialogMode: true,
      });

    SummaryManagerWindow.getSharedState().window = this.dialog?.window;
    this.isOpen = true;
    await Zotero.Promise.delay(80);
    await this.initializeWindow();
  }

  private async initializeWindow(): Promise<void> {
    if (this.initialized || !this.dialog?.window) return;
    if (this.initializePromise) {
      await this.initializePromise;
      return;
    }

    this.initializePromise = this.doInitializeWindow().finally(() => {
      this.initializePromise = null;
    });
    await this.initializePromise;
  }

  private async doInitializeWindow(): Promise<void> {
    const ready = await this.waitForRequiredElements();
    if (!ready || this.initialized || !this.dialog?.window) return;

    this.bindEvents();
    this.ensureMathJax();
    this.loadMainPaneSplitRatio();
    this.loadListSplitRatio();
    this.populateTopSelectors(true);
    this.installThemeListener();
    this.applyTheme();

    this.unsubscribe?.();
    this.unsubscribe = this.manager.subscribe((snapshot) => {
      const nextActiveTaskIds = new Set(snapshot.tasks.map((task) => task.id));
      const removedActiveTaskIds = Array.from(this.lastActiveTaskIds).filter(
        (taskId) => !nextActiveTaskIds.has(taskId),
      );
      this.lastActiveTaskIds = nextActiveTaskIds;
      this.render(snapshot);
      if (removedActiveTaskIds.length > 0) {
        void this.refreshHistoryRecords(true).then(() => {
          this.render(this.manager.getSnapshot());
        });
      }
    });
    this.lastActiveTaskIds = new Set(
      this.manager.getSnapshot().tasks.map((task) => task.id),
    );

    this.initialized = true;
    void this.refreshHistoryRecords(true).then(() => {
      this.render(this.manager.getSnapshot());
    });
    void this.stabilizeInitialRender();
  }

  private async waitForRequiredElements(timeoutMs = 2000): Promise<boolean> {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const doc = this.dialog?.window?.document;
      if (
        doc &&
        REQUIRED_ELEMENT_IDS.every((id) => Boolean(doc.getElementById(id)))
      ) {
        return true;
      }
      await Zotero.Promise.delay(40);
    }
    ztoolkit.log(
      "[AiNote][SummaryManagerWindow] Window content was not ready before initialization timed out",
    );
    return false;
  }

  private loadListSplitRatio(): void {
    let stored: unknown;
    let source = "Zotero.Prefs.get";
    try {
      stored = Zotero.Prefs.get(this.splitRatioPrefFullKey, true);
    } catch {
      source = "getPref fallback";
      stored = getPref(this.splitRatioPrefKey);
    }
    let raw = Number(String(stored || ""));
    if (!Number.isFinite(raw) || raw <= 0) {
      const legacy = Number(String(getPref(this.legacySplitRatioPrefKey) || ""));
      if (Number.isFinite(legacy) && legacy > 0) {
        raw = legacy;
        source = "legacy pref";
      }
    }
    if (Number.isFinite(raw)) {
      this.listSplitRatio = Math.max(
        this.minSplitRatio,
        Math.min(this.maxSplitRatio, raw),
      );
      return;
    }
    this.listSplitRatio = 0.3;
  }

  private computeMainPaneClampedRatio(ratio: number): number {
    const doc = this.dialog?.window?.document;
    const mainEl = doc?.getElementById("ainote-main") as HTMLElement | null;
    const splitterEl = doc?.getElementById("ainote-main-splitter") as HTMLElement | null;
    const width = mainEl?.getBoundingClientRect().width || 0;
    const splitterWidth = splitterEl?.getBoundingClientRect().width || 8;
    if (width <= splitterWidth + 10) {
      return Math.max(0.2, Math.min(0.8, ratio));
    }
    const usable = Math.max(1, width - splitterWidth);
    const minRatio = this.mainMinLeftWidthPx / usable;
    const maxRatio = 1 - this.mainMinRightWidthPx / usable;
    if (minRatio > maxRatio) {
      return Math.max(0.2, Math.min(0.8, ratio));
    }
    return Math.max(minRatio, Math.min(maxRatio, ratio));
  }

  private applyMainPaneSplitRatio(ratio?: number): void {
    const doc = this.dialog?.window?.document;
    if (!doc) return;
    const listPane = doc.getElementById("ainote-task-list-pane") as HTMLElement | null;
    const detailPane = doc.getElementById("ainote-task-detail") as HTMLElement | null;
    const splitter = doc.getElementById("ainote-main-splitter") as HTMLElement | null;
    if (!listPane || !detailPane || !splitter) return;

    const nextRatio = this.computeMainPaneClampedRatio(
      Number.isFinite(ratio as number) ? (ratio as number) : this.mainPaneSplitRatio,
    );
    this.mainPaneSplitRatio = nextRatio;
    listPane.style.flex = `0 0 calc(${(nextRatio * 100).toFixed(4)}% - ${splitter.getBoundingClientRect().width || 8}px)`;
    listPane.style.width = "";
    detailPane.style.flex = "1 1 auto";
    detailPane.style.minWidth = "0";
  }

  private loadMainPaneSplitRatio(): void {
    let raw = Number(
      String(Zotero.Prefs.get(this.mainPaneSplitRatioPrefFullKey, true) || ""),
    );
    if (!Number.isFinite(raw) || raw <= 0 || raw >= 1) {
      raw = Number(String(getPref(this.mainPaneSplitRatioPrefKey) || ""));
    }
    if (!Number.isFinite(raw) || raw <= 0 || raw >= 1) {
      raw = 0.35;
    }
    this.mainPaneSplitRatio = raw;
    this.applyMainPaneSplitRatio(raw);
  }

  private saveMainPaneSplitRatio(): void {
    const value = String(this.mainPaneSplitRatio);
    try {
      Zotero.Prefs.set(this.mainPaneSplitRatioPrefFullKey, value, true);
      const verify = String(
        Zotero.Prefs.get(this.mainPaneSplitRatioPrefFullKey, true) || "",
      );
      if (verify === value) return;
    } catch {
      // fallback below
    }
    setPref(this.mainPaneSplitRatioPrefKey, value as any);
  }

  private ensureMainPaneSplitter(): void {
    const doc = this.dialog?.window?.document;
    const win = this.dialog?.window;
    if (!doc || !win) return;
    const mainEl = doc.getElementById("ainote-main") as HTMLElement | null;
    const splitter = doc.getElementById("ainote-main-splitter") as HTMLElement | null;
    const listPane = doc.getElementById("ainote-task-list-pane") as HTMLElement | null;
    if (!mainEl || !splitter || !listPane) return;

    this.applyMainPaneSplitRatio();
    if (this.mainSplitterBound) return;
    this.mainSplitterBound = true;

    let lastSaveTs = 0;
    const maybeSave = (force = false) => {
      const now = Date.now();
      if (force || now - lastSaveTs >= 150) {
        lastSaveTs = now;
        this.saveMainPaneSplitRatio();
      }
    };

    const onMouseMove = (evt: MouseEvent) => {
      if (!this.mainSplitterDragging) return;
      const rect = mainEl.getBoundingClientRect();
      const splitterWidth = splitter.getBoundingClientRect().width || 8;
      const usable = Math.max(1, rect.width - splitterWidth);
      const rawRatio = (evt.clientX - rect.left) / usable;
      this.applyMainPaneSplitRatio(rawRatio);
      maybeSave(false);
    };

    const endDrag = () => {
      if (!this.mainSplitterDragging) return;
      this.mainSplitterDragging = false;
      doc.body.style.cursor = "";
      maybeSave(true);
    };

    splitter.addEventListener("mousedown", (evt: MouseEvent) => {
      evt.preventDefault();
      this.mainSplitterDragging = true;
      doc.body.style.cursor = "col-resize";
    });
    doc.addEventListener("mousemove", onMouseMove);
    doc.addEventListener("mouseup", endDrag);
    win.addEventListener("mousemove", onMouseMove);
    win.addEventListener("mouseup", endDrag);
    win.addEventListener("blur", endDrag);
    win.addEventListener("resize", () => {
      this.applyMainPaneSplitRatio();
      this.saveMainPaneSplitRatio();
    });
  }

  private saveListSplitRatio(): void {
    const value = String(this.listSplitRatio);
    try {
      Zotero.Prefs.set(this.splitRatioPrefFullKey, value, true);
      const verify = String(
        Zotero.Prefs.get(this.splitRatioPrefFullKey, true) || "",
      );
      if (verify === value) return;
    } catch {
      // fallback below
    }
    setPref(this.splitRatioPrefKey, value as any);
  }

  private ensureSectionSplitter(
    listEl: HTMLElement,
    activeSection: HTMLElement,
    historySection: HTMLElement,
    enabled: boolean,
  ): void {
    const doc = this.dialog?.window?.document;
    const win = this.dialog?.window;
    if (!doc || !win) return;

    let splitter = listEl.querySelector(
      ".ainote-section-splitter",
    ) as HTMLDivElement | null;
    if (!splitter) {
      splitter = createHtmlElement(doc, "div");
      splitter.className = "ainote-section-splitter";
      splitter.dataset.role = "section-splitter";
      splitter.setAttribute("role", "separator");
      splitter.setAttribute("aria-orientation", "horizontal");
      splitter.tabIndex = -1;
      activeSection.after(splitter);
    } else if (splitter.previousElementSibling !== activeSection) {
      activeSection.after(splitter);
    }

    splitter.style.display = enabled ? "block" : "none";
    if (!enabled) return;

    if (this.splitterBound) return;
    this.splitterBound = true;

    const onMouseMove = (evt: MouseEvent) => {
      if (!this.splitterDragging) return;
      const rect = listEl.getBoundingClientRect();
      if (rect.height <= 0) return;
      const ratio = (evt.clientY - rect.top) / rect.height;
      this.listSplitRatio = Math.max(
        this.minSplitRatio,
        Math.min(this.maxSplitRatio, ratio),
      );
      activeSection.style.flex = `${this.listSplitRatio} 1 0`;
      historySection.style.flex = `${1 - this.listSplitRatio} 1 0`;
      this.saveListSplitRatio();
    };

    const endDrag = () => {
      if (!this.splitterDragging) return;
      this.splitterDragging = false;
      doc.body.style.cursor = "";
      this.saveListSplitRatio();
    };

    splitter.addEventListener("mousedown", (evt: MouseEvent) => {
      evt.preventDefault();
      this.splitterDragging = true;
      doc.body.style.cursor = "row-resize";
    });
    doc.addEventListener("mousemove", onMouseMove);
    doc.addEventListener("mouseup", endDrag);
    win.addEventListener("mousemove", onMouseMove);
    win.addEventListener("mouseup", endDrag);
    win.addEventListener("blur", endDrag);
  }

  private bindEvents(): void {
    if (!this.dialog?.window) return;
    const doc = this.dialog.window.document;
    this.ensureMainPaneSplitter();
    doc.addEventListener("click", () => hideCustomSelectMenus(doc));

    const clearBtn = doc.getElementById(
      "ainote-clear-history",
    ) as HTMLButtonElement | null;
    if (clearBtn) {
      bindButtonAction(clearBtn, () => {
        void this.clearHistoryRecords();
      });
    }

    const stopActiveBtn = doc.getElementById(
      "ainote-stop-active",
    ) as HTMLButtonElement | null;
    if (stopActiveBtn) {
      bindButtonAction(stopActiveBtn, () => {
        this.manager.stopActiveTasks();
      });
    }

    const retryActiveBtn = doc.getElementById(
      "ainote-retry-active",
    ) as HTMLButtonElement | null;
    if (retryActiveBtn) {
      bindButtonAction(retryActiveBtn, () => {
        this.manager.retryActiveTasks();
      });
    }

    const removeActiveBtn = doc.getElementById(
      "ainote-remove-active",
    ) as HTMLButtonElement | null;
    if (removeActiveBtn) {
      bindButtonAction(removeActiveBtn, () => {
        this.manager.removeActiveTasks();
      });
    }

    const profileSelect = doc.getElementById(
      "ainote-profile-select",
    ) as Element | null;
    if (profileSelect) {
      const commitProfile = () => {
        setPref(
          "activeProfileId" as any,
          getCustomSelectValue(profileSelect) as any,
        );
        this.populateTopSelectors();
        this.render(this.manager.getSnapshot());
      };
      this.bindCustomSelect(profileSelect, commitProfile);
    }

    const templateSelect = doc.getElementById(
      "ainote-template-select",
    ) as Element | null;
    if (templateSelect) {
      const commitTemplate = () => {
        setPref(
          "activePromptTemplateId" as any,
          getCustomSelectValue(templateSelect) as any,
        );
        this.populateTopSelectors();
        this.render(this.manager.getSnapshot());
      };
      this.bindCustomSelect(templateSelect, commitTemplate);
    }

    const listEl = doc.getElementById("ainote-task-list") as HTMLElement | null;
    listEl?.addEventListener("click", (evt: Event) => {
      const target = evt.target as HTMLElement;
      const listActionBtn = target.closest(
        "button[data-list-action]",
      ) as HTMLButtonElement | null;
      if (listActionBtn) {
        evt.stopPropagation();
        const action = listActionBtn.dataset.listAction;
        if (action === "toggle-active") {
          this.activeCollapsed = !this.activeCollapsed;
          this.render(this.manager.getSnapshot());
        }
        if (action === "toggle-history") {
          this.historyCollapsed = !this.historyCollapsed;
          this.render(this.manager.getSnapshot());
        }
        if (action === "stop-active") {
          this.manager.stopActiveTasks();
        }
        if (action === "retry-active") {
          this.manager.retryActiveTasks();
        }
        if (action === "remove-active") {
          this.manager.removeActiveTasks();
        }
        if (action === "clear-history") {
          void this.clearHistoryRecords();
        }
        return;
      }

      const actionBtn = target.closest(
        "button[data-action]",
      ) as HTMLButtonElement | null;
      if (actionBtn) {
        evt.stopPropagation();
        const action = actionBtn.dataset.action;
        const taskId = actionBtn.dataset.taskId;
        if (!taskId) return;
        if (action === "stop") this.manager.stopTask(taskId);
        if (action === "retry") this.manager.retryTask(taskId);
        if (action === "remove") void this.removeTaskEntry(taskId);
        if (action === "view") this.manager.setSelected(taskId);
        if (action === "continue-chat") {
          void this.openConversationForTask(taskId);
        }
        if (action === "view-note") {
          void this.openNoteForTask(taskId);
        }
        return;
      }

      const row = target.closest(".ainote-task-row") as HTMLElement | null;
      const taskId = row?.dataset.taskId;
      if (taskId) {
        this.manager.setSelected(taskId);
      }
    });

    const detailEl = doc.getElementById(
      "ainote-task-detail",
    ) as HTMLElement | null;
    detailEl?.addEventListener("click", (evt: Event) => {
      const target = evt.target as HTMLElement;
      const btn = target.closest(
        "button[data-detail-action]",
      ) as HTMLButtonElement | null;
      if (!btn) return;
      const action = btn.dataset.detailAction;
      const taskId = btn.dataset.taskId;
      if (!taskId) return;
      if (action === "stop") this.manager.stopTask(taskId);
      if (action === "retry") this.manager.retryTask(taskId);
      if (action === "remove") void this.removeTaskEntry(taskId);
      if (action === "view") this.manager.setSelected(taskId);
      if (action === "continue-chat") {
        void this.openConversationForTask(taskId);
      }
      if (action === "view-note") {
        void this.openNoteForTask(taskId);
      }
    });

    listEl?.addEventListener("input", (evt: Event) => {
      const target = evt.target as HTMLInputElement;
      if (!target || target.id !== "ainote-history-search") return;
      this.historySearch = String(target.value || "");
      this.render(this.manager.getSnapshot());
    });
  }

  private async clearHistoryRecords(): Promise<void> {
    try {
      await HistorySyncStore.clearAll();
      this.historyRecords = [];
      this.historyLoaded = true;
      this.render(this.manager.getSnapshot());
    } catch (error) {
      ztoolkit.log("[AiNote][SummaryManagerWindow] clear history records failed", error);
    }
  }

  private async removeTaskEntry(taskId: string): Promise<void> {
    const localTask = this.manager.getTaskById(taskId);
    if (localTask) {
      this.manager.removeTask(taskId);
      return;
    }
    await HistorySyncStore.removeTask(taskId);
    this.historyRecords = this.historyRecords.filter((record) => record.task.id !== taskId);
    if (this.manager.getSnapshot().selectedTaskId === taskId) {
      this.manager.setSelected(undefined);
    }
    this.render(this.manager.getSnapshot());
  }

  private async openConversationForTask(taskId: string): Promise<void> {
    const task =
      this.manager.getTaskById(taskId) ||
      this.getHistoryTasksForRender().find((entry) => entry.id === taskId);
    if (!task || task.kind !== "web" || task.status !== "completed") return;
    const item = Zotero.Items.get(task.itemID);
    if (!item) return;

    if (task.webConversationUrl) {
      try {
        if (typeof (Zotero as any).launchURL === "function") {
          (Zotero as any).launchURL(task.webConversationUrl);
          return;
        }
      } catch (error) {
        ztoolkit.log("[AiNote][SummaryManagerWindow] Failed to launch conversation URL", error);
      }
    }

    await WebSummaryWorkflow.openConversationForItem(item);
  }

  private async openNoteForTask(taskId: string): Promise<void> {
    const task =
      this.manager.getTaskById(taskId) ||
      this.getHistoryTasksForRender().find((entry) => entry.id === taskId);
    const noteID = task?.noteID;
    if (!task || !noteID) {
      showSummaryManagerAlert(
        getString("selected-note-not-found" as any),
        this.getLiveDialogWindow(),
      );
      return;
    }
    const note = Zotero.Items.get(noteID);
    const invalidNote =
      !note ||
      note.deleted ||
      !note.isNote?.() ||
      note.parentID !== task.itemID;
    if (invalidNote) {
      showSummaryManagerAlert(
        getString("selected-note-not-found" as any),
        this.getLiveDialogWindow(),
      );
      ztoolkit.log(
        "[AiNote][SummaryManagerWindow] Task note is missing or invalid",
        {
          taskId,
          noteID,
          exists: Boolean(note),
          deleted: Boolean(note?.deleted),
          isNote: Boolean(note?.isNote?.()),
          parentID: note?.parentID,
          expectedParentID: task.itemID,
        },
      );
      return;
    }
    const pane = Zotero.getActiveZoteroPane?.();
    if (pane?.selectItem) {
      try {
        await pane.selectItem(noteID);
        return;
      } catch (error) {
        ztoolkit.log("[AiNote][SummaryManagerWindow] Failed to select note in pane", error);
      }
    }
    // Avoid URI fallback because it can trigger deprecated URI-loading paths
    // and may navigate to an unintended item when the target note is invalid.
    showSummaryManagerAlert(
      getString("selected-note-not-found" as any),
      this.getLiveDialogWindow(),
    );
  }

  private bindCustomSelect(select: Element, onChange: () => void): void {
    const doc = this.dialog?.window?.document;
    if (!doc) return;

    select.addEventListener("click", (evt: Event) => {
      const target = evt.target as HTMLElement;
      const option = target.closest(
        ".ainote-select-option",
      ) as HTMLButtonElement | null;
      const trigger = target.closest(
        ".ainote-select-trigger",
      ) as HTMLButtonElement | null;
      const { menu } = getCustomSelectParts(select);

      if (!menu || (!option && !trigger)) return;
      evt.preventDefault();
      evt.stopPropagation();

      if (option) {
        const options = Array.from<Element>(
          menu.querySelectorAll(".ainote-select-option"),
        ).map((item: Element) => ({
          value: (item as HTMLElement).dataset.value || "",
          label: item.textContent || "",
        }));
        setCustomSelectValue(select, option.dataset.value || "", options);
        menu.setAttribute("hidden", "true");
        onChange();
        return;
      }

      this.populateTopSelectors(true);
      hideCustomSelectMenus(doc, select);
      menu.toggleAttribute("hidden");
    });
  }

  private installThemeListener(): void {
    const win = this.dialog?.window;
    const doc = win?.document;
    if (!win || !doc) return;

    this.themeMediaQuery?.removeEventListener("change", this.handleThemeChange);
    this.themeMediaQuery =
      win.matchMedia?.("(prefers-color-scheme: dark)") || null;
    this.themeMediaQuery?.addEventListener("change", this.handleThemeChange);

    this.themeObserver?.disconnect();
    const ObserverCtor =
      win.MutationObserver || (globalThis as any).MutationObserver;
    if (ObserverCtor) {
      const observer = new ObserverCtor(() => {
        this.handleThemeChange();
      }) as MutationObserver;
      observer.observe(doc.documentElement, {
        attributes: true,
        attributeFilter: ["zotero-theme", "class"],
      });
      if (doc.body) {
        observer.observe(doc.body, {
          attributes: true,
          attributeFilter: ["class"],
        });
      }
      this.themeObserver = observer;
    } else {
      this.themeObserver = null;
    }

    win.addEventListener("focus", this.handleThemeChange);
    win.addEventListener("focus", this.handleWindowFocus);
  }

  private readonly handleThemeChange = () => {
    this.applyTheme();
    this.applyMainPaneSplitRatio();
    this.render(this.manager.getSnapshot());
  };

  private readonly handleWindowFocus = () => {
    this.populateTopSelectors(true);
    this.applyMainPaneSplitRatio();
    this.render(this.manager.getSnapshot());
  };

  private async stabilizeInitialRender(): Promise<void> {
    if (!this.dialog?.window) return;
    await Zotero.Promise.delay(0);
    this.forceLayout();
    this.render(this.manager.getSnapshot());
    await Zotero.Promise.delay(120);
    this.forceLayout();
    this.render(this.manager.getSnapshot());
  }

  private forceLayout(): void {
    const doc = this.dialog?.window?.document;
    if (!doc) return;
    const root = doc.getElementById("ainote-summary-manager");
    const listEl = doc.getElementById("ainote-task-list");
    const detailEl = doc.getElementById("ainote-task-detail");
    root?.getBoundingClientRect();
    (doc.getElementById("ainote-main") as HTMLElement | null)?.getBoundingClientRect();
    listEl?.getBoundingClientRect();
    detailEl?.getBoundingClientRect();
  }

  private isDarkTheme(): boolean {
    const doc = this.dialog?.window?.document;
    const win = this.dialog?.window;
    if (!doc || !win) return false;
    return (
      doc.documentElement.getAttribute("zotero-theme") === "dark" ||
      doc.body.classList.contains("dark") ||
      !!win.matchMedia?.("(prefers-color-scheme: dark)").matches
    );
  }

  private applyTheme(): void {
    const doc = this.dialog?.window?.document;
    if (!doc) return;
    const isDark = this.isDarkTheme();
    const root = doc.getElementById(
      "ainote-summary-manager",
    ) as HTMLElement | null;
    if (!root) return;
    doc.documentElement.style.background = isDark ? "#1f2329" : "#ffffff";
    doc.body.style.background = isDark ? "#1f2329" : "#ffffff";
    doc.documentElement.style.height = "100%";
    doc.body.style.height = "100%";
    doc.body.style.margin = "0";
    doc.documentElement.style.overflow = "hidden";
    doc.body.style.overflow = "hidden";
    root.style.height = "100%";
    root.style.minHeight = "0";
    root.style.background = isDark ? "#2b2b2b" : "#fff";
    root.style.color = isDark ? "#e6e6e6" : "#1f1f1f";

    const style = doc.getElementById("ainote-summary-manager-style");
    if (style) {
      const baseRowBg = rowBackgroundColor("pending", isDark, false);
      const baseRowBorder = rowBorderColor("pending", isDark, false);
      const baseRowAccent = rowAccentColor("pending", isDark, false);
      style.textContent = `
        .ainote-op-btn { font-size: 12px; padding: 4px 10px; min-height: 30px; border-radius: 6px; border: 1px solid ${isDark ? "#4b5563" : "#c9ced6"}; background: ${isDark ? "#3a3f47" : "#fff"}; color: ${isDark ? "#e5e7eb" : "#1f2937"}; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 4px; }
        .ainote-op-btn:hover { border-color: ${isDark ? "#7b8794" : "#8fa5c2"}; }
        .ainote-op-btn:disabled { opacity: 0.45; cursor: not-allowed; }
        .ainote-op-btn-danger { border-color: ${isDark ? "#7f1d1d" : "#f0b5b5"}; color: ${isDark ? "#fecaca" : "#b42318"}; background: ${isDark ? "#3f1f1f" : "#fff7f7"}; }
        .ainote-op-btn-primary { border-color: ${isDark ? "#115e59" : "#8fd4cf"}; color: ${isDark ? "#99f6e4" : "#0f766e"}; background: ${isDark ? "#113333" : "#f0fffe"}; }
        .ainote-row-actions { display:flex; gap:8px; margin-top:8px; flex-wrap: wrap; }
        #ainote-header { background: ${isDark ? "#23262d" : "#f8fafc"}; border-bottom-color: ${isDark ? "#4b5563" : "#d1d5db"} !important; }
        #ainote-header label { color: ${isDark ? "#d1d5db" : "#111827"}; }
        #ainote-summary-manager {
          width: 100%;
          height: 100%;
          min-height: 0;
          box-sizing: border-box;
        }
        #ainote-main {
          flex: 1 1 auto;
          min-height: 0;
        }
        #ainote-task-list, #ainote-task-detail { background: ${isDark ? "#2b2b2b" : "#ffffff"}; }
        #ainote-task-list-pane { min-height: 0; min-width: 0; overflow: hidden; border-right: 1px solid ${isDark ? "#4b5563" : "#d1d5db"}; }
        #ainote-main-splitter {
          width: 8px;
          cursor: col-resize;
          flex: 0 0 auto;
          background: ${isDark ? "#3f4652" : "#e5e7eb"};
          border-left: 1px solid ${isDark ? "#4b5563" : "#d1d5db"};
          border-right: 1px solid ${isDark ? "#4b5563" : "#d1d5db"};
        }
        #ainote-main-splitter:hover {
          background: ${isDark ? "#5b6474" : "#cbd5e1"};
        }
        #ainote-task-list {
          overflow: hidden !important;
          overflow-y: hidden !important;
          overflow-x: hidden !important;
          min-height: 0;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        #ainote-task-list > .ainote-section {
          min-height: 0;
        }
        #ainote-task-detail {
          overflow-y: auto !important;
          overflow-x: hidden !important;
          overscroll-behavior: contain;
          min-height: 0;
          min-width: 0;
        }
        #ainote-summary-manager strong, #ainote-summary-manager h3 { color: ${isDark ? "#f3f4f6" : "#111827"}; }
        #ainote-summary-manager .ainote-custom-select {
          position: relative;
          min-width: 76px;
          max-width: 230px;
        }
        #ainote-summary-manager #ainote-profile-select,
        #ainote-summary-manager #ainote-template-select {
          width: 180px;
        }
        #ainote-summary-manager .ainote-select-trigger {
          width: 100%;
          background: ${isDark ? "#303640" : "#ffffff"};
          color: ${isDark ? "#e5e7eb" : "#111827"};
          border: 1px solid ${isDark ? "#4b5563" : "#cbd5e1"};
          border-radius: 8px;
          min-height: 30px;
          padding: 0 24px 0 8px;
          text-align: left;
          overflow: hidden;
          text-overflow: ellipsis;
          position: relative;
        }
        #ainote-summary-manager .ainote-select-trigger::after {
          content: "▾";
          position: absolute;
          right: 8px;
          top: 50%;
          transform: translateY(-50%);
          color: ${isDark ? "#cbd5e1" : "#475569"};
        }
        #ainote-summary-manager .ainote-select-menu {
          position: absolute;
          z-index: 1000;
          top: calc(100% + 4px);
          left: 0;
          min-width: 100%;
          max-width: 360px;
          max-height: 260px;
          overflow: auto;
          padding: 4px;
          border-radius: 8px;
          border: 1px solid ${isDark ? "#4b5563" : "#cbd5e1"};
          background: ${isDark ? "#23262d" : "#ffffff"};
          box-shadow: 0 12px 28px rgba(0,0,0,0.22);
        }
        #ainote-summary-manager .ainote-select-menu[hidden] {
          display: none;
        }
        #ainote-summary-manager .ainote-select-option {
          width: 100%;
          min-height: 30px;
          justify-content: flex-start;
          text-align: left;
          border: 0;
          border-radius: 6px;
          padding: 5px 8px;
          background: transparent;
          color: ${isDark ? "#e5e7eb" : "#111827"};
          overflow: hidden;
          text-overflow: ellipsis;
        }
        #ainote-summary-manager .ainote-select-option:hover,
        #ainote-summary-manager .ainote-select-option.is-selected {
          background: ${isDark ? "#334155" : "#e6f7f6"};
        }
        #ainote-summary-manager button { white-space: nowrap; }
        #ainote-summary-manager button:not(.ainote-op-btn):not(.ainote-select-trigger):not(.ainote-select-option) {
          min-height: 32px;
          border-radius: 8px;
          border: 1px solid ${isDark ? "#4b5563" : "#cbd5e1"};
          background: ${isDark ? "#303640" : "#ffffff"};
          color: ${isDark ? "#e5e7eb" : "#111827"};
        }
        #ainote-summary-manager .ainote-task-row {
          border: 2px solid ${baseRowBorder};
          border-left: 6px solid ${baseRowAccent};
          border-radius: 8px;
          padding: 10px;
          margin-bottom: 8px;
          cursor: pointer;
          background-color: ${baseRowBg};
        }
        #ainote-summary-manager .ainote-task-row[data-status="pending"] {
          border-color: ${rowBorderColor("pending", isDark, false)};
          border-left-color: ${rowAccentColor("pending", isDark, false)};
          background-color: ${rowBackgroundColor("pending", isDark, false)};
        }
        #ainote-summary-manager .ainote-task-row[data-status="pending"].is-selected {
          border-color: ${rowBorderColor("pending", isDark, true)};
          border-left-color: ${rowAccentColor("pending", isDark, true)};
          background-color: ${rowBackgroundColor("pending", isDark, true)};
        }
        #ainote-summary-manager .ainote-task-row[data-status="running"] {
          border-color: ${rowBorderColor("running", isDark, false)};
          border-left-color: ${rowAccentColor("running", isDark, false)};
          background-color: ${rowBackgroundColor("running", isDark, false)};
        }
        #ainote-summary-manager .ainote-task-row[data-status="running"].is-selected {
          border-color: ${rowBorderColor("running", isDark, true)};
          border-left-color: ${rowAccentColor("running", isDark, true)};
          background-color: ${rowBackgroundColor("running", isDark, true)};
        }
        #ainote-summary-manager .ainote-task-row[data-status="completed"] {
          border-color: ${rowBorderColor("completed", isDark, false)};
          border-left-color: ${rowAccentColor("completed", isDark, false)};
          background-color: ${rowBackgroundColor("completed", isDark, false)};
        }
        #ainote-summary-manager .ainote-task-row[data-status="completed"].is-selected {
          border-color: ${rowBorderColor("completed", isDark, true)};
          border-left-color: ${rowAccentColor("completed", isDark, true)};
          background-color: ${rowBackgroundColor("completed", isDark, true)};
        }
        #ainote-summary-manager .ainote-task-row[data-status="failed"] {
          border-color: ${rowBorderColor("failed", isDark, false)};
          border-left-color: ${rowAccentColor("failed", isDark, false)};
          background-color: ${rowBackgroundColor("failed", isDark, false)};
        }
        #ainote-summary-manager .ainote-task-row[data-status="failed"].is-selected {
          border-color: ${rowBorderColor("failed", isDark, true)};
          border-left-color: ${rowAccentColor("failed", isDark, true)};
          background-color: ${rowBackgroundColor("failed", isDark, true)};
        }
        #ainote-summary-manager .ainote-task-row[data-status="cancelled"] {
          border-color: ${rowBorderColor("cancelled", isDark, false)};
          border-left-color: ${rowAccentColor("cancelled", isDark, false)};
          background-color: ${rowBackgroundColor("cancelled", isDark, false)};
        }
        #ainote-summary-manager .ainote-task-row[data-status="cancelled"].is-selected {
          border-color: ${rowBorderColor("cancelled", isDark, true)};
          border-left-color: ${rowAccentColor("cancelled", isDark, true)};
          background-color: ${rowBackgroundColor("cancelled", isDark, true)};
        }
        #ainote-summary-manager .ainote-section {
          border: 1px solid ${isDark ? "#4b5563" : "#d1d5db"};
          border-radius: 8px;
          display: flex;
          flex-direction: column;
          min-height: 0;
          overflow: hidden;
        }
        #ainote-summary-manager .ainote-section-splitter {
          height: 8px;
          margin: 2px 0;
          border-radius: 999px;
          background: ${isDark ? "#4b5563" : "#d1d5db"};
          cursor: row-resize;
          flex: 0 0 auto;
        }
        #ainote-summary-manager .ainote-section-splitter:hover {
          background: ${isDark ? "#6b7280" : "#9ca3af"};
        }
        #ainote-summary-manager .ainote-section-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 8px;
          padding: 8px;
          border-bottom: 1px solid ${isDark ? "#4b5563" : "#e5e7eb"};
          background: ${isDark ? "#23262d" : "#f8fafc"};
        }
        #ainote-summary-manager .ainote-section-title {
          font-size: 12px;
          font-weight: 700;
        }
        #ainote-summary-manager .ainote-section-actions {
          display: flex;
          gap: 6px;
          flex-wrap: wrap;
          justify-content: flex-end;
        }
        #ainote-summary-manager .ainote-section-body {
          flex: 1;
          min-height: 0;
          overflow-y: auto;
          overflow-x: hidden;
          padding: 8px;
        }
        #ainote-summary-manager .ainote-section.is-empty .ainote-section-body {
          flex: 1;
          min-height: 0;
        }
        #ainote-summary-manager .ainote-section-footer {
          padding: 8px;
          border-top: 1px solid ${isDark ? "#4b5563" : "#e5e7eb"};
          display: flex;
          gap: 6px;
          flex-wrap: wrap;
          justify-content: flex-end;
          background: ${isDark ? "#23262d" : "#f8fafc"};
        }
        #ainote-summary-manager .ainote-task-title {
          display: block;
          min-width: 0;
          max-width: 100%;
          font-size: 13px;
          font-weight: 600;
          color: ${isDark ? "#f3f4f6" : "#111827"};
          line-height: 1.4;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        #ainote-summary-manager .ainote-task-row.is-selected .ainote-task-title {
          font-weight: 700;
          color: ${isDark ? "#ffffff" : "#0f172a"};
        }
        #ainote-task-detail mjx-container,
        #ainote-task-detail .MathJax {
          font-size: 1em !important;
          max-width: 100%;
        }
        #ainote-task-detail mjx-container[display="true"] {
          display: block;
          overflow-x: auto;
          overflow-y: hidden;
          padding: 2px 0;
        }
        #ainote-task-detail mjx-container svg {
          max-width: 100% !important;
          height: auto !important;
        }
        #ainote-stop-active,
        #ainote-retry-active,
        #ainote-remove-active,
        #ainote-clear-history {
          display: none !important;
        }
      `;
    }
  }

  private populateTopSelectors(force = false): void {
    const doc = this.dialog?.window?.document;
    if (!doc) return;

    const profileSelect = doc.getElementById(
      "ainote-profile-select",
    ) as Element | null;
    const templateSelect = doc.getElementById(
      "ainote-template-select",
    ) as Element | null;
    if (!profileSelect || !templateSelect) return;

    const profiles = parseProfiles(getPref("profiles" as any));
    const activeProfileId = String(
      getPref("activeProfileId" as any) || "",
    ).trim();
    populateCustomSelect(
      doc,
      profileSelect,
      profiles.map((profile) => ({
        value: profile.id,
        label: profile.name || profile.model || profile.id,
      })),
      activeProfileId || profiles[0]?.id || "",
      force || !this.controlsInitialized,
    );

    const state = ensurePromptTemplateState(
      getPref("promptTemplates" as any),
      getPref("activePromptTemplateId" as any),
      getPref("promptTemplatesVersion" as any),
    );
    populateCustomSelect(
      doc,
      templateSelect,
      state.templates.map((tpl) => ({ value: tpl.id, label: tpl.name })),
      state.activeTemplateId,
      force || !this.controlsInitialized,
    );
    this.controlsInitialized = true;
  }

  private async refreshHistoryRecords(force = false): Promise<void> {
    if (this.historyLoading) return;
    if (this.historyLoaded && !force) return;
    this.historyLoading = true;
    try {
      this.historyRecords = await HistorySyncStore.queryAll();
      this.historyLoaded = true;
    } catch (error) {
      ztoolkit.log("[AiNote][SummaryManagerWindow] load history records failed", error);
    } finally {
      this.historyLoading = false;
    }
  }

  private getHistoryTasksForRender(): SummaryTask[] {
    return this.historyRecords.map((record) => record.task);
  }

  private render(snapshot: SummaryTaskSnapshot): void {
    if (!this.dialog?.window) return;
    if (!this.historyLoaded && !this.historyLoading) {
      void this.refreshHistoryRecords().then(() => this.render(this.manager.getSnapshot()));
    }
    this.applyTheme();
    const activeElement = this.dialog.window.document
      .activeElement as HTMLElement | null;
    const selectorOpen = Boolean(
      activeElement?.closest?.(".ainote-custom-select"),
    );
    if (!selectorOpen) {
      this.populateTopSelectors(false);
    }
    this.renderList(snapshot);
    this.renderDetail(snapshot);
  }

  private renderList(snapshot: SummaryTaskSnapshot): void {
    const doc = this.dialog.window.document;
    const listEl = doc.getElementById("ainote-task-list") as HTMLElement | null;
    if (!listEl) return;

    const isDark = this.isDarkTheme();

    const activeTasks = sortActiveTasks(snapshot.tasks.filter((task) => isActiveTask(task)));
    const historyTasks = sortHistoryTasks(this.getHistoryTasksForRender());
    const templateState = ensurePromptTemplateState(
      getPref("promptTemplates" as any),
      getPref("activePromptTemplateId" as any),
      getPref("promptTemplatesVersion" as any),
    );
    const templateNameById = new Map(
      templateState.templates.map((tpl) => [String(tpl.id || "").trim(), String(tpl.name || "").trim()]),
    );

      if (!activeTasks.length && !historyTasks.length) {
      listEl.replaceChildren();
      const empty = createHtmlElement(doc, "div");
      empty.style.color = isDark ? "#9ca3af" : "#888";
      empty.textContent = getString("summary-manager-no-tasks" as any);
      listEl.appendChild(empty);
      return;
    }

    const getTaskButtonConfigs = (task: SummaryTask, visualStatus: SummaryTask["status"]) => {
      const buttonConfigs: Array<{
        action: "stop" | "retry" | "remove" | "view" | "continue-chat" | "view-note";
        label: string;
        className: string;
        title: string;
      }> = [];
      if (visualStatus === "pending") {
        buttonConfigs.push({
          action: "remove",
          label: getString("summary-manager-remove" as any),
          className: buttonClass("danger"),
          title: getString("summary-manager-remove-title" as any),
        });
      } else if (visualStatus === "running") {
        buttonConfigs.push(
          {
            action: "stop",
            label: getString("summary-manager-stop" as any),
            className: buttonClass("default"),
            title: getString("summary-manager-stop-title" as any),
          },
          {
            action: "remove",
            label: getString("summary-manager-remove" as any),
            className: buttonClass("danger"),
            title: getString("summary-manager-remove-title" as any),
          },
        );
      } else if (visualStatus === "failed" || visualStatus === "cancelled") {
        buttonConfigs.push(
          {
            action: "retry",
            label: getString("summary-manager-retry" as any),
            className: buttonClass("primary"),
            title: getString("summary-manager-retry-title" as any),
          },
          {
            action: "remove",
            label: getString("summary-manager-remove" as any),
            className: buttonClass("danger"),
            title: getString("summary-manager-remove-title" as any),
          },
        );
      } else if (visualStatus === "completed") {
        if (task.kind === "web" && task.webConversationUrl) {
          buttonConfigs.push({
            action: "continue-chat",
            label: getString("summary-manager-continue-chat" as any),
            className: buttonClass("primary"),
            title: getString("summary-manager-continue-chat" as any),
          });
        }
        if (task.noteID) {
          buttonConfigs.push({
            action: "view-note",
            label: getString("summary-manager-view-note" as any),
            className: buttonClass("default"),
            title: getString("summary-manager-view-note" as any),
          });
        }
        buttonConfigs.push({
          action: "remove",
          label: getString("summary-manager-remove" as any),
          className: buttonClass("danger"),
          title: getString("summary-manager-remove-title" as any),
        });
      }
      return buttonConfigs;
    };

    const renderTaskRow = (task: SummaryTask) => {
        const selected = snapshot.selectedTaskId === task.id;
        const visualStatus = normalizeVisualStatus(task.status);
        const progress = typeof task.progress === "number" ? `${task.progress}%` : "";

        const row = createHtmlElement(doc, "div");
        row.className = "ainote-task-row";
        row.classList.toggle("is-selected", selected);
        row.dataset.taskId = task.id;
        row.dataset.status = visualStatus;
        row.setAttribute("status", visualStatus);
        applyTaskRowAppearance(row, visualStatus, isDark, selected);

        const title = createHtmlElement(doc, "div");
        title.className = "ainote-task-title";
        const taskTitle = getSummaryManagerTaskTitle(task);
        title.textContent = taskTitle;
        title.title = taskTitle;

        const status = createHtmlElement(doc, "div");
        status.style.fontSize = "12px";
        status.style.color = statusColor(visualStatus, isDark);
        status.style.marginTop = "4px";
        status.style.display = "flex";
        status.style.justifyContent = "space-between";
        status.style.alignItems = "center";
        status.style.gap = "8px";
        const stageText = String(task.stage || "").trim() || statusLabel(visualStatus);
        const completedAtText =
          visualStatus === "completed"
            ? formatTaskTimeToMinute(task.finishedAt || task.updatedAt)
            : "";
        const templateName =
          templateNameById.get(String(task.templateId || "").trim()) ||
          inferTemplateNameFromTaskTitle(task.title) ||
          inferTemplateNameFromContent(task.content);
        const stageWithTemplate = templateName
          ? `${templateName} - ${stageText}`
          : stageText;
        const stageLabel = createHtmlElement(doc, "span");
        stageLabel.textContent = completedAtText
          ? `${stageWithTemplate} · ${completedAtText}`
          : stageWithTemplate;
        const progressLabel = createHtmlElement(doc, "span");
        progressLabel.textContent = progress || "";
        status.append(stageLabel, progressLabel);

        const actions = createHtmlElement(doc, "div");
        actions.className = "ainote-row-actions";
        getTaskButtonConfigs(task, visualStatus).forEach((buttonConfig) => {
          const button = createHtmlElement(doc, "button");
          button.className = buttonConfig.className;
          button.dataset.action = buttonConfig.action;
          button.dataset.taskId = task.id;
          button.title = buttonConfig.title;
          button.textContent = buttonConfig.label;
          actions.appendChild(button);
        });

        row.append(title, status, actions);
        return row;
    };

    const getRowRenderKey = (task: SummaryTask, selected: boolean): string => {
      const visualStatus = normalizeVisualStatus(task.status);
      return [
        selected ? "1" : "0",
        visualStatus,
        getSummaryManagerTaskTitle(task),
        String(task.progress ?? ""),
        String(task.stage || ""),
        String(task.noteID || ""),
        String(task.webConversationUrl || ""),
      ].join("|");
    };

    const upsertRows = (bodyEl: HTMLElement, tasks: SummaryTask[]) => {
      const existing = new Map<string, HTMLElement>();
      Array.from(bodyEl.querySelectorAll(".ainote-task-row")).forEach((node) => {
        const row = node as HTMLElement;
        const taskId = row.dataset.taskId;
        if (taskId) existing.set(taskId, row);
      });

      const orderedRows: HTMLElement[] = [];
      tasks.forEach((task) => {
        const selected = snapshot.selectedTaskId === task.id;
        const visualStatus = normalizeVisualStatus(task.status);
        const renderKey = getRowRenderKey(task, selected);
        const previous = existing.get(task.id);
        if (previous && previous.dataset.renderKey === renderKey) {
          // Theme switching does not change renderKey. Re-apply row appearance
          // so reused DOM nodes can follow current dark/light colors.
          applyTaskRowAppearance(previous, visualStatus, isDark, selected);
          orderedRows.push(previous);
          existing.delete(task.id);
          return;
        }
        const row = renderTaskRow(task);
        row.dataset.renderKey = renderKey;
        orderedRows.push(row);
        existing.delete(task.id);
      });

      existing.forEach((staleRow) => {
        staleRow.remove();
      });

      if (!orderedRows.length) {
        bodyEl.replaceChildren();
      } else {
        bodyEl.replaceChildren(...orderedRows);
      }
    };

    let activeSection = listEl.querySelector(
      '.ainote-section[data-section="active"]',
    ) as HTMLElement | null;
    let historySection = listEl.querySelector(
      '.ainote-section[data-section="history"]',
    ) as HTMLElement | null;
    if (!activeSection || !historySection) {
      listEl.replaceChildren();
      activeSection = createHtmlElement(doc, "div");
      activeSection.className = "ainote-section";
      activeSection.dataset.section = "active";
      historySection = createHtmlElement(doc, "div");
      historySection.className = "ainote-section";
      historySection.dataset.section = "history";
      listEl.append(activeSection, historySection);
    }

    const bothExpanded = !this.activeCollapsed && !this.historyCollapsed;

    if (this.activeCollapsed) {
      activeSection.style.flex = "0 0 auto";
      historySection.style.flex = "1 1 auto";
      this.ensureSectionSplitter(listEl, activeSection, historySection, false);
    } else if (this.historyCollapsed) {
      activeSection.style.flex = "1 1 auto";
      historySection.style.flex = "0 0 auto";
      this.ensureSectionSplitter(listEl, activeSection, historySection, false);
    } else if (bothExpanded) {
      activeSection.style.flex = `${this.listSplitRatio} 1 0`;
      historySection.style.flex = `${1 - this.listSplitRatio} 1 0`;
      this.ensureSectionSplitter(listEl, activeSection, historySection, true);
    }

    const buildSectionHeader = (
      titleText: string,
      count: number,
      collapsed: boolean,
      toggleAction: "toggle-active" | "toggle-history",
      actions: Array<{ action: string; label: string; className: string }>,
      extra?: HTMLElement | null,
    ) => {
      const header = createHtmlElement(doc, "div");
      header.className = "ainote-section-header";

      const title = createHtmlElement(doc, "div");
      title.className = "ainote-section-title";
      title.textContent = `${titleText}（${count}）`;

      const right = createHtmlElement(doc, "div");
      right.className = "ainote-section-actions";

      actions.forEach((actionCfg) => {
        const btn = createHtmlElement(doc, "button");
        btn.className = actionCfg.className;
        btn.dataset.listAction = actionCfg.action;
        btn.textContent = actionCfg.label;
        right.appendChild(btn);
      });

      const toggle = createHtmlElement(doc, "button");
      toggle.className = buttonClass("default");
      toggle.dataset.listAction = toggleAction;
      toggle.textContent = collapsed ? "▲" : "▼";
      toggle.title = collapsed
        ? getString("summary-manager-expand" as any)
        : getString("summary-manager-collapse" as any);
      right.appendChild(toggle);
      if (extra) {
        right.appendChild(extra);
      }

      header.append(title, right);
      return header;
    };

    const activeHeader = buildSectionHeader(
      getString("summary-manager-active-tasks" as any),
      activeTasks.length,
      this.activeCollapsed,
      "toggle-active",
      [
        {
          action: "stop-active",
          label: getString("summary-manager-stop-title" as any),
          className: buttonClass("default"),
        },
        {
          action: "retry-active",
          label: getString("summary-manager-retry-title" as any),
          className: buttonClass("primary"),
        },
        {
          action: "remove-active",
          label: getString("summary-manager-clear" as any),
          className: buttonClass("danger"),
        },
      ],
    );
    const existingActiveHeader = activeSection.querySelector(
      ".ainote-section-header",
    ) as HTMLElement | null;
    if (existingActiveHeader) {
      existingActiveHeader.replaceWith(activeHeader);
    } else {
      activeSection.appendChild(activeHeader);
    }

    if (!this.activeCollapsed) {
      let body = activeSection.querySelector(
        ".ainote-section-body",
      ) as HTMLElement | null;
      if (!body) {
        body = createHtmlElement(doc, "div");
        body.className = "ainote-section-body";
        activeSection.appendChild(body);
      }
      if (!activeTasks.length) {
        activeSection.classList.add("is-empty");
        body.replaceChildren();
        const empty = createHtmlElement(doc, "div");
        empty.style.color = isDark ? "#9ca3af" : "#888";
        empty.textContent = getString("summary-manager-no-active" as any);
        body.appendChild(empty);
      } else {
        activeSection.classList.remove("is-empty");
        upsertRows(body, activeTasks);
      }
    } else {
      activeSection.querySelector(".ainote-section-body")?.remove();
    }

    const historyHeader = buildSectionHeader(
      getString("summary-manager-history-tasks" as any),
      historyTasks.length,
      this.historyCollapsed,
      "toggle-history",
      [
        {
          action: "clear-history",
          label: getString("summary-manager-clear" as any),
          className: buttonClass("danger"),
        },
      ],
    );
    const existingHistoryHeader = historySection.querySelector(
      ".ainote-section-header",
    ) as HTMLElement | null;
    if (existingHistoryHeader) {
      existingHistoryHeader.replaceWith(historyHeader);
    } else {
      historySection.appendChild(historyHeader);
    }

    if (!this.historyCollapsed) {
      let body = historySection.querySelector(
        ".ainote-section-body",
      ) as HTMLElement | null;
      if (!body) {
        body = createHtmlElement(doc, "div");
        body.className = "ainote-section-body";
        historySection.appendChild(body);
      }
      if (!historyTasks.length) {
        historySection.classList.add("is-empty");
        body.replaceChildren();
        const empty = createHtmlElement(doc, "div");
        empty.style.color = isDark ? "#9ca3af" : "#888";
        empty.textContent = getString("summary-manager-no-history" as any);
        body.appendChild(empty);
      } else {
        historySection.classList.remove("is-empty");
        upsertRows(body, historyTasks);
      }
    } else {
      historySection.querySelector(".ainote-section-body")?.remove();
    }
  }

  private renderDetail(snapshot: SummaryTaskSnapshot): void {
    const doc = this.dialog.window.document;
    const detailEl = doc.getElementById(
      "ainote-task-detail",
    ) as HTMLElement | null;
    if (!detailEl) return;
    const task = snapshot.tasks.find(
      (entry) => entry.id === snapshot.selectedTaskId,
    ) || this.getHistoryTasksForRender().find((entry) => entry.id === snapshot.selectedTaskId);
    const isDark = this.isDarkTheme();
    const visualStatus = task
      ? normalizeVisualStatus(task.status)
      : "pending";

    detailEl.replaceChildren();
    if (!task) {
      const empty = createHtmlElement(doc, "div");
      empty.style.color = isDark ? "#9ca3af" : "#888";
      empty.textContent = getString("summary-manager-select-task" as any);
      detailEl.appendChild(empty);
      return;
    }

    if (!snapshot.tasks.some((entry) => entry.id === task.id)) {
      void this.refreshHistoryTaskContentOnDemand(task.id);
    }

    const body = this.stripDuplicatedSummaryPreamble(task.content || "", task);

    const header = createHtmlElement(doc, "div");
    header.style.display = "flex";
    header.style.justifyContent = "space-between";
    header.style.alignItems = "center";
    header.style.gap = "8px";

    const title = createHtmlElement(doc, "h3");
    title.style.margin = "0";
    title.textContent = getSummaryManagerTaskTitle(task);

    const status = createHtmlElement(doc, "div");
    status.style.fontSize = "12px";
    status.style.color = statusColor(visualStatus, isDark);
    status.style.writingMode = "vertical-rl";
    status.style.textOrientation = "upright";
    status.style.letterSpacing = "1px";
    status.style.lineHeight = "1.1";
    status.style.flex = "0 0 auto";
    status.textContent = statusLabel(visualStatus);

    header.append(title, status);

    const actions = createHtmlElement(doc, "div");
    actions.className = "ainote-row-actions";
    actions.style.marginTop = "10px";

    const detailButtons: Array<{
      action: "stop" | "retry" | "remove" | "view" | "continue-chat" | "view-note";
      label: string;
      className: string;
      disabled?: boolean;
    }> = [];
    if (visualStatus === "pending") {
      detailButtons.push({
        action: "remove",
        label: getString("summary-manager-remove" as any),
        className: buttonClass("danger"),
      });
    } else if (visualStatus === "running") {
      detailButtons.push(
        {
          action: "stop",
          label: getString("summary-manager-stop" as any),
          className: buttonClass("default"),
        },
        {
          action: "remove",
          label: getString("summary-manager-remove" as any),
          className: buttonClass("danger"),
        },
      );
    } else if (visualStatus === "failed" || visualStatus === "cancelled") {
      detailButtons.push(
        {
          action: "retry",
          label: getString("summary-manager-retry" as any),
          className: buttonClass("primary"),
        },
        {
          action: "remove",
          label: getString("summary-manager-remove" as any),
          className: buttonClass("danger"),
        },
      );
    } else if (visualStatus === "completed") {
      if (task.kind === "web" && task.webConversationUrl) {
        detailButtons.push({
          action: "continue-chat",
          label: getString("summary-manager-continue-chat" as any),
          className: buttonClass("primary"),
        });
      }
      if (task.noteID) {
        detailButtons.push({
          action: "view-note",
          label: getString("summary-manager-view-note" as any),
          className: buttonClass("default"),
        });
      }
      detailButtons.push({
        action: "remove",
        label: getString("summary-manager-remove" as any),
        className: buttonClass("danger"),
      });
    }

    detailButtons.forEach((buttonConfig) => {
      const button = createHtmlElement(doc, "button");
      button.className = buttonConfig.className;
      button.dataset.detailAction = buttonConfig.action;
      button.dataset.taskId = task.id;
      button.disabled = Boolean(buttonConfig.disabled);
      button.textContent = buttonConfig.label;
      actions.appendChild(button);
    });

    const metaColor = isDark ? "#cbd5e1" : "#666";
    const appendItemMetaLine = (label: string, value: string, ellipsis = false) => {
      const line = createHtmlElement(doc, "div");
      line.style.fontSize = "12px";
      line.style.color = metaColor;
      line.style.marginTop = "4px";
      line.style.display = "flex";
      line.style.alignItems = "center";
      line.style.gap = "4px";

      const labelEl = createHtmlElement(doc, "span");
      labelEl.style.flex = "0 0 auto";
      labelEl.textContent = `${label}：`;

      const valueEl = createHtmlElement(doc, "span");
      valueEl.style.flex = "1";
      valueEl.style.minWidth = "0";
      valueEl.textContent = value || "-";
      valueEl.title = value || "-";
      if (ellipsis) {
        valueEl.style.display = "inline-block";
        valueEl.style.overflow = "hidden";
        valueEl.style.whiteSpace = "nowrap";
        valueEl.style.textOverflow = "ellipsis";
      }

      line.append(labelEl, valueEl);
      detailEl.appendChild(line);
    };
    const appendMetaLine = (label: string, value: string) => {
      const line = createHtmlElement(doc, "div");
      line.style.fontSize = "12px";
      line.style.color = metaColor;
      line.style.marginTop =
        label === getString("summary-manager-progress" as any) ? "8px" : "4px";
      line.textContent = `${label}：${value}`;
      detailEl.appendChild(line);
    };

    detailEl.append(header, actions);
    const item = task.itemID ? Zotero.Items.get(task.itemID) : null;
    const publication =
      String(item?.getField?.("publicationTitle") || "").trim() ||
      String(item?.getField?.("proceedingsTitle") || "").trim() ||
      String(item?.getField?.("bookTitle") || "").trim() ||
      "-";
    appendItemMetaLine(
      getString("summary-manager-meta-journal" as any),
      publication,
      true,
    );

    const stageText = String(task.stage || "").trim() || statusLabel(visualStatus);
    const progressText = typeof task.progress === "number" ? `${task.progress}%` : "-";
    appendMetaLine(getString("summary-manager-progress" as any), `${stageText}  ${progressText}`);
    appendMetaLine(getString("summary-manager-model-meta" as any), task.model || "-");
    if (visualStatus === "completed") {
      appendMetaLine(
        getString("summary-manager-completed-at" as any),
        formatTaskTimeToMinute(task.finishedAt || task.updatedAt),
      );
    }

    if (task.error) {
      const errorBox = createHtmlElement(doc, "div");
      errorBox.style.marginTop = "8px";
      errorBox.style.padding = "8px";
      errorBox.style.border = `1px solid ${isDark ? "#7f1d1d" : "#ffb3b3"}`;
      errorBox.style.background = isDark ? "#3f1f1f" : "#fff5f5";
      errorBox.style.color = isDark ? "#fecaca" : "#a40000";
      errorBox.textContent = getString("summary-manager-error" as any, {
        args: { error: task.error },
      });
      detailEl.appendChild(errorBox);
    } else if (visualStatus === "completed") {
      const successBox = createHtmlElement(doc, "div");
      successBox.style.marginTop = "8px";
      successBox.style.padding = "8px";
      successBox.style.border = `1px solid ${isDark ? "#14532d" : "#a7f3d0"}`;
      successBox.style.background = isDark ? "#0f2f1f" : "#f0fdf4";
      successBox.style.color = isDark ? "#bbf7d0" : "#166534";
      successBox.textContent = getString("summary-manager-completed" as any);
      detailEl.appendChild(successBox);
    }

    const content = createHtmlElement(doc, "div");
    content.style.marginTop = "12px";
    content.style.borderTop = `1px solid ${isDark ? "#4b5563" : "#ddd"}`;
    content.style.paddingTop = "12px";
    content.style.overflowWrap = "anywhere";
    content.style.wordBreak = "break-word";
    if (body) {
      content.innerHTML = this.convertDetailMarkdownToHTML(body);
    } else {
      const empty = createHtmlElement(doc, "div");
      empty.style.color = isDark ? "#9ca3af" : "#888";
      empty.textContent = getString("summary-manager-no-content" as any);
      content.appendChild(empty);
    }
    detailEl.appendChild(content);
    if (body) {
      // MathJax needs the target node attached to DOM to measure `ex` units.
      // Calling typeset on detached nodes can produce NaNex width/height.
      void this.renderMathInElement(content);
    }
  }

  private async refreshHistoryTaskContentOnDemand(taskId: string): Promise<void> {
    if (this.historyContentRefreshing.has(taskId)) return;
    this.historyContentRefreshing.add(taskId);
    try {
      const latest = await HistorySyncStore.resolveContent(taskId);
      if (!latest) return;
      const index = this.historyRecords.findIndex((record) => record.task.id === taskId);
      if (index < 0) return;
      const previous = this.historyRecords[index];
      const changed =
        (previous.task.content || "") !== (latest.task.content || "") ||
        (previous.searchText || "") !== (latest.searchText || "");
      if (!changed) return;
      this.historyRecords[index] = latest;
      if (this.manager.getSnapshot().selectedTaskId === taskId) {
        this.render(this.manager.getSnapshot());
      }
    } catch {
      // ignore on-demand refresh failures to keep detail panel responsive
    } finally {
      this.historyContentRefreshing.delete(taskId);
    }
  }

  private ensureMathJax(): void {
    if (!this.dialog?.window?.document) return;
    try {
      const doc = this.dialog.window.document;
      const win = this.dialog.window as any;
      if (win.MathJax?.typesetPromise) {
        return;
      }

      if (
        this.mathJaxInjected &&
        doc.getElementById("ainote-mathjax-script")
      ) {
        return;
      }
      this.mathJaxInjected = true;

      if (!win.MathJax) {
        const configScript = doc.createElement("script");
        configScript.id = "ainote-mathjax-config";
        configScript.type = "text/javascript";
        configScript.text = `
          window.MathJax = {
          tex: {
            inlineMath: [['$', '$']],
            displayMath: [['$$', '$$']],
          },
          svg: {
            fontCache: 'global'
          },
          options: {
            enableAssistiveMml: false,
            renderActions: {
              assistiveMml: []
            }
          },
          startup: {
            ready: () => {
              MathJax.startup.defaultReady();
            }
          }
        };
        `;
        doc.head.appendChild(configScript);
      }

      const script = doc.createElement("script");
      script.id = "ainote-mathjax-script";
      const candidates = [
        `chrome://${config.addonRef}/content/lib/mathjax/es5/tex-chtml.js`,
        `chrome://${config.addonRef}/content/lib/mathjax/tex-svg.js`,
        `chrome://${config.addonRef}/content/lib/mathjax/es5/tex-svg.js`,
      ];
      let idx = 0;
      script.src = candidates[idx];
      script.async = true;
      script.onerror = () => {
        idx += 1;
        if (idx < candidates.length) {
          script.src = candidates[idx];
          doc.head.appendChild(script);
        }
      };
      doc.head.appendChild(script);
    } catch (error) {
      ztoolkit.log("[AiNote][SummaryManagerWindow] Failed to inject MathJax", error);
    }
  }

  private async renderMathInElement(element: HTMLElement): Promise<void> {
    try {
      const win = this.dialog?.window as any;
      if (!win) return;
      await this.waitForMathHostReady(element);
      let attempts = 0;
      while (attempts < 20) {
        if (win.MathJax?.typesetPromise) {
          if (win.MathJax?.startup?.promise) {
            await win.MathJax.startup.promise;
          }
          if (typeof win.MathJax.typesetClear === "function") {
            win.MathJax.typesetClear([element]);
          }
          await win.MathJax.typesetPromise([element]);
          // A short second pass helps avoid occasional NaNex/viewBox instability
          // when the pane width is still settling right after mount.
          await Zotero.Promise.delay(60);
          if (typeof win.MathJax.typesetClear === "function") {
            win.MathJax.typesetClear([element]);
          }
          await win.MathJax.typesetPromise([element]);
          return;
        }
        attempts += 1;
        await Zotero.Promise.delay(150);
      }
    } catch {
      // ignore math rendering failures and keep plain text content visible
    }
  }

  private async waitForMathHostReady(element: HTMLElement): Promise<void> {
    let attempts = 0;
    while (attempts < 20) {
      const connected = element.isConnected;
      const rect = element.getBoundingClientRect();
      const style = this.dialog?.window?.getComputedStyle?.(element);
      const visible = style ? style.display !== "none" && style.visibility !== "hidden" : true;
      if (connected && visible && rect.width > 0) return;
      attempts += 1;
      await Zotero.Promise.delay(50);
    }
  }

  private convertDetailMarkdownToHTML(markdown: string): string {
    return normalizeDetailHeadingLevels(OutputWindow.convertMarkdownToDisplayHTML(markdown));
  }

  private stripDuplicatedSummaryPreamble(
    content: string,
    task?: SummaryTask,
  ): string {
    const raw = String(content || "");
    if (!raw.trim()) return raw;

    const lines = raw.replace(/\r\n?/g, "\n").split("\n");
    let i = 0;
    while (i < lines.length && !lines[i].trim()) i += 1;
    if (i >= lines.length) return raw;

    const normalizeMetaLine = (line: string): string =>
      line
        .replace(/<[^>]+>/g, "")
        .replace(/\*\*/g, "")
        .replace(/__/g, "")
        .trim();
    const knownTemplateNames = Array.from(
      new Set(
        [
          getPromptTemplateNameById(task?.templateId),
          inferTemplateNameFromTaskTitle(String(task?.title || "")),
          ...getCurrentPromptTemplateNames(),
        ]
          .map((name) => String(name || "").trim())
          .filter(Boolean),
      ),
    );
    const isSummaryTitleLine = (line: string): boolean => {
      const normalized = normalizeMetaLine(line).replace(/^#{1,6}\s*/, "");
      return knownTemplateNames.some((templateName) =>
        normalized.startsWith(`${templateName} - `),
      );
    };
    const isModelLine = (line: string): boolean => {
      const normalized = normalizeMetaLine(line);
      return /^(模型|model)\s*[:：]\s*/i.test(normalized);
    };
    const isCompletedAtLine = (line: string): boolean => {
      const normalized = normalizeMetaLine(line);
      return /^(总结完成时间|完成时间|completed(?:\s+at|\s+time)?)\s*[:：]\s*/i.test(
        normalized,
      );
    };

    if (!isSummaryTitleLine(lines[i])) return raw;
    i += 1;

    // Remove adjacent blank/meta lines that duplicate header info already shown
    // in the popup detail panel.
    while (i < lines.length) {
      const line = lines[i];
      if (!line.trim() || isModelLine(line) || isCompletedAtLine(line)) {
        i += 1;
        continue;
      }
      break;
    }

    const stripped = lines.slice(i).join("\n").replace(/^\s+/, "");
    return stripped || raw;
  }
}
