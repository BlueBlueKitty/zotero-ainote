import { config } from "../../package.json";
import { getPref, setPref } from "../utils/prefs";
import { ensurePromptTemplateState } from "../utils/prompts";
import { parseProfiles } from "./llmProfiles";
import {
  isActiveTask,
  isHistoryTask,
  sortActiveTasks,
  sortHistoryTasks,
} from "./summaryTaskPartition";
import { SummaryHistoryStore } from "./summaryHistoryStore";
import { OutputWindow } from "./outputWindow";
import { SummaryTaskManager } from "./summaryTaskManager";
import { SummaryTask, SummaryTaskSnapshot } from "./summaryTaskTypes";
import { WebSummaryWorkflow } from "./webSummaryWorkflow";

const LIMIT_OPTIONS = [20, 50, 100, 200, 500, 0];
const HTML_NS = "http://www.w3.org/1999/xhtml";
const REQUIRED_ELEMENT_IDS = [
  "ainote-summary-manager",
  "ainote-profile-select",
  "ainote-template-select",
  "ainote-history-limit",
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
    pending: "待总结",
    running: "总结中",
    completed: "已完成",
    failed: "失败",
    cancelled: "已停止",
  };
  return map[status] || status;
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
  if (selected) return isDark ? "#2f3440" : "#eef1f5";
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
  row.style.setProperty(
    "border",
    `2px solid ${rowBorderColor(status, isDark, selected)}`,
    "important",
  );
  row.style.setProperty("border-left-width", "6px", "important");
  row.style.setProperty(
    "border-left-color",
    rowAccentColor(status, isDark, selected),
    "important",
  );
  row.style.borderRadius = "8px";
  row.style.padding = "10px";
  row.style.marginBottom = "8px";
  row.style.cursor = "pointer";
  row.style.setProperty("background", background, "important");
  row.style.setProperty("background-color", background, "important");
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
  const finalLabel = fallback?.label || "未配置";

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

  public static async open(): Promise<void> {
    if (!this.instance) {
      this.instance = new SummaryManagerWindow();
    }
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
  private activeCollapsed = false;
  private historyCollapsed = false;
  private mathJaxInjected = false;

  private async open(): Promise<void> {
    await this.manager.ensureLoaded();

    if (this.isOpen && this.dialog?.window && !this.dialog.window.closed) {
      this.dialog.window.focus();
      return;
    }

    const dialogData: { [key: string]: any } = {
      loadCallback: () => {
        void this.initializeWindow();
      },
      unloadCallback: () => {
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
        this.initializePromise = null;
        this.isOpen = false;
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
                properties: { innerHTML: "<strong>条目总结管理窗口</strong>" },
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
                    properties: { innerHTML: "大模型" },
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
                          innerHTML: "加载中...",
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
                    properties: { innerHTML: "总结提示词模板" },
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
                          innerHTML: "加载中...",
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
                    properties: { innerHTML: "历史保存上限" },
                  },
                  {
                    tag: "div",
                    namespace: "html",
                    id: "ainote-history-limit",
                    properties: { className: "ainote-custom-select" },
                    children: [
                      {
                        tag: "button",
                        namespace: "html",
                        properties: {
                          className: "ainote-select-trigger",
                          type: "button",
                          innerHTML: "加载中...",
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
                    properties: { innerHTML: "🗑 清空历史任务" },
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
                  width: "360px",
                  borderRight: "1px solid #ddd",
                  display: "flex",
                  flexDirection: "column",
                  minHeight: "0",
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
                        properties: { innerHTML: "⏹ 停止活动任务" },
                      },
                      {
                        tag: "button",
                        namespace: "html",
                        id: "ainote-retry-active",
                        styles: { whiteSpace: "nowrap" },
                        properties: { innerHTML: "🔁 重试活动任务" },
                      },
                      {
                        tag: "button",
                        namespace: "html",
                        id: "ainote-remove-active",
                        styles: { whiteSpace: "nowrap" },
                        properties: { innerHTML: "🗑 移除活动任务" },
                      },
                    ],
                  },
                ],
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
      .open("条目总结管理窗口", {
        width: 980,
        height: 680,
        centerscreen: true,
        resizable: true,
        noDialogMode: true,
      });

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
    this.populateTopSelectors(true);
    this.populateHistoryLimit(true);
    this.installThemeListener();
    this.applyTheme();

    this.unsubscribe?.();
    this.unsubscribe = this.manager.subscribe((snapshot) => {
      this.render(snapshot);
    });

    this.initialized = true;
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

  private bindEvents(): void {
    if (!this.dialog?.window) return;
    const doc = this.dialog.window.document;
    doc.addEventListener("click", () => hideCustomSelectMenus(doc));

    this.populateHistoryLimit(true);
    const limitSelect = doc.getElementById(
      "ainote-history-limit",
    ) as Element | null;
    if (limitSelect) {
      const commitHistoryLimit = () => {
        const value = parseInt(getCustomSelectValue(limitSelect), 10);
        void this.manager.setHistoryLimit(Number.isFinite(value) ? value : 100);
      };
      this.bindCustomSelect(limitSelect, () => {
        commitHistoryLimit();
      });
    }

    const clearBtn = doc.getElementById(
      "ainote-clear-history",
    ) as HTMLButtonElement | null;
    if (clearBtn) {
      bindButtonAction(clearBtn, () => {
        void this.manager.clearHistory();
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
          void this.manager.clearHistory();
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
        if (action === "remove") this.manager.removeTask(taskId);
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
      if (action === "remove") this.manager.removeTask(taskId);
      if (action === "view") this.manager.setSelected(taskId);
      if (action === "continue-chat") {
        void this.openConversationForTask(taskId);
      }
      if (action === "view-note") {
        void this.openNoteForTask(taskId);
      }
    });
  }

  private async openConversationForTask(taskId: string): Promise<void> {
    const task = this.manager.getTaskById(taskId);
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
    const task = this.manager.getTaskById(taskId);
    const noteID = task?.noteID;
    if (!task || !noteID) return;
    const note = Zotero.Items.get(noteID);
    if (!note) return;
    const pane = Zotero.getActiveZoteroPane?.();
    if (pane?.selectItem) {
      try {
        await pane.selectItem(noteID);
        return;
      } catch (error) {
        ztoolkit.log("[AiNote][SummaryManagerWindow] Failed to select note in pane", error);
      }
    }
    if (note.libraryID) {
      const itemURI = Zotero.URI.getItemURI(note);
      if (itemURI) {
        Zotero.launchURL(itemURI);
      }
    }
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

      if (select.id === "ainote-history-limit") {
        this.populateHistoryLimit(true);
      } else {
        this.populateTopSelectors(true);
      }
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
    this.render(this.manager.getSnapshot());
  };

  private readonly handleWindowFocus = () => {
    this.populateTopSelectors(true);
    this.populateHistoryLimit();
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
        #ainote-task-list-pane { min-height: 0; overflow: hidden; }
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
        #ainote-summary-manager #ainote-history-limit {
          width: 82px;
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
          flex: 0 0 auto;
          min-height: 56px;
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
          font-size: 13px;
          font-weight: 600;
          line-height: 1.4;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
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

  private populateHistoryLimit(force = false): void {
    const doc = this.dialog?.window?.document;
    if (!doc) return;
    const limitSelect = doc.getElementById(
      "ainote-history-limit",
    ) as Element | null;
    if (!limitSelect) return;

    populateCustomSelect(
      doc,
      limitSelect,
      LIMIT_OPTIONS.map((n) => ({
        value: String(n),
        label: n === 0 ? "不限制" : String(n),
      })),
      String(SummaryHistoryStore.getLimit()),
      force,
    );
  }

  private render(snapshot: SummaryTaskSnapshot): void {
    if (!this.dialog?.window) return;
    this.applyTheme();
    const activeElement = this.dialog.window.document
      .activeElement as HTMLElement | null;
    const selectorOpen = Boolean(
      activeElement?.closest?.(".ainote-custom-select"),
    );
    if (!selectorOpen) {
      this.populateTopSelectors(false);
      this.populateHistoryLimit();
    }
    this.renderList(snapshot);
    this.renderDetail(snapshot);
  }

  private renderList(snapshot: SummaryTaskSnapshot): void {
    const doc = this.dialog.window.document;
    const listEl = doc.getElementById("ainote-task-list") as HTMLElement | null;
    if (!listEl) return;

    const isDark = this.isDarkTheme();
    listEl.replaceChildren();

    const activeTasks = sortActiveTasks(snapshot.tasks.filter((task) => isActiveTask(task)));
    const historyTasks = sortHistoryTasks(snapshot.tasks.filter((task) => isHistoryTask(task)));

    if (!activeTasks.length && !historyTasks.length) {
      const empty = createHtmlElement(doc, "div");
      empty.style.color = isDark ? "#9ca3af" : "#888";
      empty.textContent = "暂无任务";
      listEl.appendChild(empty);
      return;
    }

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
        title.textContent = task.title;
        title.title = task.title;

        const status = createHtmlElement(doc, "div");
        status.style.fontSize = "12px";
        status.style.color = statusColor(visualStatus, isDark);
        status.style.marginTop = "4px";
        status.textContent = `${statusLabel(visualStatus)}${progress ? ` ${progress}` : ""}`;

        const stage = createHtmlElement(doc, "div");
        stage.style.fontSize = "12px";
        stage.style.color = isDark ? "#a8b0b8" : "#888";
        stage.style.marginTop = "4px";
        const stageText = String(task.stage || "").trim();
        const statusText = statusLabel(visualStatus);
        stage.textContent = stageText === statusText ? "" : stageText;

        const actions = createHtmlElement(doc, "div");
        actions.className = "ainote-row-actions";

        const buttonConfigs: Array<{
          action: "stop" | "retry" | "remove" | "view" | "continue-chat" | "view-note";
          label: string;
          className: string;
          title: string;
        }> = [];
        if (visualStatus === "pending") {
          buttonConfigs.push({
            action: "remove",
            label: "🗑 移除任务",
            className: buttonClass("danger"),
            title: "移除",
          });
        } else if (visualStatus === "running") {
          buttonConfigs.push(
            {
              action: "stop",
              label: "⏹ 停止",
              className: buttonClass("default"),
              title: "停止",
            },
            {
              action: "remove",
              label: "🗑 移除任务",
              className: buttonClass("danger"),
              title: "移除",
            },
          );
        } else if (visualStatus === "failed" || visualStatus === "cancelled") {
          buttonConfigs.push(
            {
              action: "retry",
              label: "🔁 重试",
              className: buttonClass("primary"),
              title: "重试",
            },
            {
              action: "remove",
              label: "🗑 移除任务",
              className: buttonClass("danger"),
              title: "移除",
            },
          );
        } else if (visualStatus === "completed") {
          if (task.kind === "web" && task.webConversationUrl) {
            buttonConfigs.push({
              action: "continue-chat",
              label: "继续对话",
              className: buttonClass("primary"),
              title: "继续对话",
            });
          }
          if (task.noteID) {
            buttonConfigs.push({
              action: "view-note",
              label: "查看笔记",
              className: buttonClass("default"),
              title: "查看笔记",
            });
          }
          buttonConfigs.push({
            action: "remove",
            label: "🗑 移除任务",
            className: buttonClass("danger"),
            title: "移除",
          });
        }

        buttonConfigs.forEach((buttonConfig) => {
          const button = createHtmlElement(doc, "button");
          button.className = buttonConfig.className;
          button.dataset.action = buttonConfig.action;
          button.dataset.taskId = task.id;
          button.title = buttonConfig.title;
          button.textContent = buttonConfig.label;
          actions.appendChild(button);
        });

        if (stage.textContent) {
          row.append(title, status, stage, actions);
        } else {
          row.append(title, status, actions);
        }
        return row;
    };

    const activeSection = createHtmlElement(doc, "div");
    activeSection.className = "ainote-section";
    const historySection = createHtmlElement(doc, "div");
    historySection.className = "ainote-section";

    const bothExpanded = !this.activeCollapsed && !this.historyCollapsed;

    if (this.activeCollapsed) {
      activeSection.style.flex = "0 0 auto";
      historySection.style.flex = "1 1 auto";
    } else if (this.historyCollapsed) {
      activeSection.style.flex = "1 1 auto";
      historySection.style.flex = "0 0 auto";
    } else if (bothExpanded) {
      // When both are expanded, always split 50/50 even if one section is empty.
      activeSection.style.flex = "1 1 0";
      historySection.style.flex = "1 1 0";
    }

    const buildSectionHeader = (
      titleText: string,
      count: number,
      collapsed: boolean,
      toggleAction: "toggle-active" | "toggle-history",
      actions: Array<{ action: string; label: string; className: string }>,
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
      toggle.title = collapsed ? "展开" : "折叠";
      right.appendChild(toggle);

      header.append(title, right);
      return header;
    };

    const activeHeader = buildSectionHeader(
      "活动任务",
      activeTasks.length,
      this.activeCollapsed,
      "toggle-active",
      [
        { action: "stop-active", label: "停止", className: buttonClass("default") },
        { action: "retry-active", label: "重试", className: buttonClass("primary") },
        { action: "remove-active", label: "清空", className: buttonClass("danger") },
      ],
    );
    activeSection.appendChild(activeHeader);

    if (!this.activeCollapsed) {
      const body = createHtmlElement(doc, "div");
      body.className = "ainote-section-body";
      if (!activeTasks.length) {
        activeSection.classList.add("is-empty");
        const empty = createHtmlElement(doc, "div");
        empty.style.color = isDark ? "#9ca3af" : "#888";
        empty.textContent = "暂无活动任务";
        body.appendChild(empty);
      } else {
        activeSection.classList.remove("is-empty");
        activeTasks.forEach((task) => body.appendChild(renderTaskRow(task)));
      }
      activeSection.appendChild(body);

    }

    const historyHeader = buildSectionHeader(
      "历史任务",
      historyTasks.length,
      this.historyCollapsed,
      "toggle-history",
      [
        {
          action: "clear-history",
          label: "🗑 清空历史任务",
          className: buttonClass("danger"),
        },
      ],
    );
    historySection.appendChild(historyHeader);

    if (!this.historyCollapsed) {
      const body = createHtmlElement(doc, "div");
      body.className = "ainote-section-body";
      if (!historyTasks.length) {
        historySection.classList.add("is-empty");
        const empty = createHtmlElement(doc, "div");
        empty.style.color = isDark ? "#9ca3af" : "#888";
        empty.textContent = "暂无历史任务";
        body.appendChild(empty);
      } else {
        historySection.classList.remove("is-empty");
        historyTasks.forEach((task) => body.appendChild(renderTaskRow(task)));
      }
      historySection.appendChild(body);
    }

    listEl.append(activeSection, historySection);
  }

  private renderDetail(snapshot: SummaryTaskSnapshot): void {
    const doc = this.dialog.window.document;
    const detailEl = doc.getElementById(
      "ainote-task-detail",
    ) as HTMLElement | null;
    if (!detailEl) return;
    const task = snapshot.tasks.find(
      (entry) => entry.id === snapshot.selectedTaskId,
    );
    const isDark = this.isDarkTheme();
    const visualStatus = task
      ? normalizeVisualStatus(task.status)
      : "pending";

    detailEl.replaceChildren();
    if (!task) {
      const empty = createHtmlElement(doc, "div");
      empty.style.color = isDark ? "#9ca3af" : "#888";
      empty.textContent = "请选择左侧任务查看详情";
      detailEl.appendChild(empty);
      return;
    }

    const body = task.content || "";

    const header = createHtmlElement(doc, "div");
    header.style.display = "flex";
    header.style.justifyContent = "space-between";
    header.style.alignItems = "center";
    header.style.gap = "8px";

    const title = createHtmlElement(doc, "h3");
    title.style.margin = "0";
    title.textContent = task.title;

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
        label: "🗑 移除任务",
        className: buttonClass("danger"),
      });
    } else if (visualStatus === "running") {
      detailButtons.push(
        {
          action: "stop",
          label: "⏹ 停止",
          className: buttonClass("default"),
        },
        {
          action: "remove",
          label: "🗑 移除任务",
          className: buttonClass("danger"),
        },
      );
    } else if (visualStatus === "failed" || visualStatus === "cancelled") {
      detailButtons.push(
        {
          action: "retry",
          label: "🔁 重试",
          className: buttonClass("primary"),
        },
        {
          action: "remove",
          label: "🗑 移除任务",
          className: buttonClass("danger"),
        },
      );
    } else if (visualStatus === "completed") {
      if (task.kind === "web" && task.webConversationUrl) {
        detailButtons.push({
          action: "continue-chat",
          label: "继续对话",
          className: buttonClass("primary"),
        });
      }
      if (task.noteID) {
        detailButtons.push({
          action: "view-note",
          label: "查看笔记",
          className: buttonClass("default"),
        });
      }
      detailButtons.push({
        action: "remove",
        label: "🗑 移除任务",
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
    const appendMetaLine = (label: string, value: string) => {
      const line = createHtmlElement(doc, "div");
      line.style.fontSize = "12px";
      line.style.color = metaColor;
      line.style.marginTop = label === "进度" ? "8px" : "4px";
      line.textContent = `${label}：${value}`;
      detailEl.appendChild(line);
    };

    detailEl.append(header, actions);
    appendMetaLine(
      "进度",
      typeof task.progress === "number" ? `${task.progress}%` : "-",
    );
    appendMetaLine("阶段", task.stage || "-");
    appendMetaLine("模型", task.model || "-");

    if (task.error) {
      const errorBox = createHtmlElement(doc, "div");
      errorBox.style.marginTop = "8px";
      errorBox.style.padding = "8px";
      errorBox.style.border = `1px solid ${isDark ? "#7f1d1d" : "#ffb3b3"}`;
      errorBox.style.background = isDark ? "#3f1f1f" : "#fff5f5";
      errorBox.style.color = isDark ? "#fecaca" : "#a40000";
      errorBox.textContent = `错误：${task.error}`;
      detailEl.appendChild(errorBox);
    } else if (visualStatus === "completed") {
      const successBox = createHtmlElement(doc, "div");
      successBox.style.marginTop = "8px";
      successBox.style.padding = "8px";
      successBox.style.border = `1px solid ${isDark ? "#14532d" : "#a7f3d0"}`;
      successBox.style.background = isDark ? "#0f2f1f" : "#f0fdf4";
      successBox.style.color = isDark ? "#bbf7d0" : "#166534";
      successBox.textContent = "总结已完成";
      detailEl.appendChild(successBox);
    }

    const content = createHtmlElement(doc, "div");
    content.style.marginTop = "12px";
    content.style.borderTop = `1px solid ${isDark ? "#4b5563" : "#ddd"}`;
    content.style.paddingTop = "12px";
    if (body) {
      content.innerHTML = this.convertDetailMarkdownToHTML(body);
    } else {
      const empty = createHtmlElement(doc, "div");
      empty.style.color = isDark ? "#9ca3af" : "#888";
      empty.textContent = "暂无总结内容";
      content.appendChild(empty);
    }
    detailEl.appendChild(content);
    if (body) {
      // MathJax needs the target node attached to DOM to measure `ex` units.
      // Calling typeset on detached nodes can produce NaNex width/height.
      void this.renderMathInElement(content);
    }
  }

  private ensureMathJax(): void {
    if (this.mathJaxInjected || !this.dialog?.window?.document) return;
    this.mathJaxInjected = true;
    try {
      const doc = this.dialog.window.document;
      const win = this.dialog.window as any;
      if (win.MathJax) return;

      const configScript = doc.createElement("script");
      configScript.type = "text/javascript";
      configScript.text = `
        window.MathJax = {
          tex: {
            // Do NOT enable single-$ delimiters here; they can accidentally
            // capture non-math text and produce giant broken SVG output.
            inlineMath: [['\\\\(', '\\\\)']],
            displayMath: [['$$', '$$'], ['\\\\[', '\\\\]']],
            processEscapes: true
          },
          svg: { fontCache: 'global' },
          options: {
            enableAssistiveMml: false,
            renderActions: { assistiveMml: [] }
          }
        };
      `;
      doc.head.appendChild(configScript);

      const script = doc.createElement("script");
      const candidates = [
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
      let attempts = 0;
      while (attempts < 10) {
        if (win.MathJax?.typesetPromise) {
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

  private convertDetailMarkdownToHTML(markdown: string): string {
    const normalized = this.normalizeInlineMathDelimiters(markdown);
    return String(OutputWindow.convertMarkdownToHTMLCore(normalized));
  }

  private normalizeInlineMathDelimiters(markdown: string): string {
    // Convert simple inline `$...$` into `\\(...\\)` so we can disable
    // single-dollar delimiters in MathJax and avoid accidental over-matching.
    // Keep display math `$$...$$` unchanged.
    return markdown.replace(
      /(^|[^\\$])\$([^\$\n]+?)\$(?!\$)/g,
      (_match, prefix: string, expr: string) => `${prefix}\\(${expr.trim()}\\)`,
    );
  }
}
