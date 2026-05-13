import { marked } from "marked";
import { getPref, setPref } from "../utils/prefs";
import { ensurePromptTemplateState } from "../utils/prompts";
import { parseProfiles } from "./llmProfiles";
import { SummaryHistoryStore } from "./summaryHistoryStore";
import { SummaryTaskManager } from "./summaryTaskManager";
import { SummaryTask, SummaryTaskSnapshot } from "./summaryTaskTypes";

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
  if (status === "processing") return "running";
  if (
    status === "pending" ||
    status === "running" ||
    status === "completed" ||
    status === "failed" ||
    status === "cancelled" ||
    status === "interrupted"
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
    cancelled: "已取消",
    interrupted: "已中断",
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
  if (status === "cancelled" || status === "interrupted") {
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
  if (status === "cancelled" || status === "interrupted") {
    return selected ? "#d97706" : isDark ? "#f59e0b" : "#d97706";
  }
  if (status === "running") return selected ? "#2563eb" : isDark ? "#3b82f6" : "#2563eb";
  if (status === "pending") return selected ? "#64748b" : isDark ? "#475569" : "#cbd5e1";
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
  if (status === "cancelled" || status === "interrupted") {
    return isDark ? "#f59e0b" : "#d97706";
  }
  if (status === "running") {
    return isDark ? "#3b82f6" : "#2563eb";
  }
  return selected ? "#59c0bc" : isDark ? "#4b5563" : "#ddd";
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
          width: "980px",
          height: "680px",
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
                    properties: { innerHTML: "🗑 清空总结历史" },
                  },
                ],
              },
            ],
          },
          {
            tag: "div",
            styles: { flex: "1", display: "flex", minHeight: "0" },
            children: [
              {
                tag: "div",
                styles: {
                  width: "360px",
                  borderRight: "1px solid #ddd",
                  display: "flex",
                  flexDirection: "column",
                  minHeight: "0",
                },
                children: [
                  {
                    tag: "div",
                    id: "ainote-task-list",
                    styles: {
                      flex: "1",
                      overflow: "auto",
                      padding: "8px",
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
                  overflow: "auto",
                  padding: "12px",
                },
              },
            ],
          },
        ],
      })
      .setDialogData(dialogData)
      .open("条目总结管理窗口", {
        width: 1080,
        height: 740,
        centerscreen: true,
        resizable: true,
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
    });
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
        #ainote-task-list, #ainote-task-detail { background: ${isDark ? "#2b2b2b" : "#ffffff"}; }
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
        #ainote-summary-manager .ainote-task-row[data-status="cancelled"],
        #ainote-summary-manager .ainote-task-row[data-status="interrupted"] {
          border-color: ${rowBorderColor("cancelled", isDark, false)};
          border-left-color: ${rowAccentColor("cancelled", isDark, false)};
          background-color: ${rowBackgroundColor("cancelled", isDark, false)};
        }
        #ainote-summary-manager .ainote-task-row[data-status="cancelled"].is-selected,
        #ainote-summary-manager .ainote-task-row[data-status="interrupted"].is-selected {
          border-color: ${rowBorderColor("cancelled", isDark, true)};
          border-left-color: ${rowAccentColor("cancelled", isDark, true)};
          background-color: ${rowBackgroundColor("cancelled", isDark, true)};
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

    if (!snapshot.tasks.length) {
      const empty = createHtmlElement(doc, "div");
      empty.style.color = isDark ? "#9ca3af" : "#888";
      empty.textContent = "暂无任务";
      listEl.appendChild(empty);
      return;
    }

    snapshot.tasks
      .slice()
      .reverse()
      .forEach((task) => {
        const selected = snapshot.selectedTaskId === task.id;
        const visualStatus = normalizeVisualStatus(task.status);
        const progress =
          typeof task.progress === "number" ? `${task.progress}%` : "";

        const row = createHtmlElement(doc, "div");
        row.className = "ainote-task-row";
        row.classList.toggle("is-selected", selected);
        row.dataset.taskId = task.id;
        row.dataset.status = visualStatus;
        row.setAttribute("status", visualStatus);
        applyTaskRowAppearance(row, visualStatus, isDark, selected);

        const title = createHtmlElement(doc, "div");
        title.style.fontSize = "13px";
        title.style.fontWeight = "600";
        title.style.lineHeight = "1.4";
        title.textContent = task.title;

        const status = createHtmlElement(doc, "div");
        status.style.fontSize = "12px";
        status.style.color = statusColor(visualStatus, isDark);
        status.style.marginTop = "4px";
        status.textContent = `${statusLabel(visualStatus)}${progress ? ` · ${progress}` : ""}`;

        const stage = createHtmlElement(doc, "div");
        stage.style.fontSize = "12px";
        stage.style.color = isDark ? "#a8b0b8" : "#888";
        stage.style.marginTop = "4px";
        stage.textContent = task.stage || "";

        const actions = createHtmlElement(doc, "div");
        actions.className = "ainote-row-actions";

        [
          {
            action: "stop",
            label: "⏹ 停止",
            className: buttonClass("default"),
            disabled: task.status !== "running",
            title: "停止",
          },
          {
            action: "retry",
            label: "🔁 重试",
            className: buttonClass("primary"),
            disabled: false,
            title: "重试",
          },
          {
            action: "remove",
            label: "🗑 移除总结",
            className: buttonClass("danger"),
            disabled: false,
            title: "移除总结",
          },
        ].forEach((buttonConfig) => {
          const button = createHtmlElement(doc, "button");
          button.className = buttonConfig.className;
          button.dataset.action = buttonConfig.action;
          button.dataset.taskId = task.id;
          button.title = buttonConfig.title;
          button.disabled = buttonConfig.disabled;
          button.textContent = buttonConfig.label;
          actions.appendChild(button);
        });

        row.append(title, status, stage, actions);
        listEl.appendChild(row);
      });
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
    status.textContent = statusLabel(visualStatus);

    header.append(title, status);

    const actions = createHtmlElement(doc, "div");
    actions.className = "ainote-row-actions";
    actions.style.marginTop = "10px";

    [
      {
        action: "stop",
        label: "⏹ 停止",
        className: buttonClass("default"),
        disabled: task.status !== "running",
      },
      {
        action: "retry",
        label: "🔁 重试",
        className: buttonClass("primary"),
        disabled: false,
      },
      {
        action: "remove",
        label: "🗑 移除总结",
        className: buttonClass("danger"),
        disabled: false,
      },
    ].forEach((buttonConfig) => {
      const button = createHtmlElement(doc, "button");
      button.className = buttonConfig.className;
      button.dataset.detailAction = buttonConfig.action;
      button.dataset.taskId = task.id;
      button.disabled = buttonConfig.disabled;
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
      content.innerHTML = String(marked.parse(body));
    } else {
      const empty = createHtmlElement(doc, "div");
      empty.style.color = isDark ? "#9ca3af" : "#888";
      empty.textContent = "暂无总结内容";
      content.appendChild(empty);
    }
    detailEl.appendChild(content);
  }
}
