import { OutputWindow } from "./outputWindow";

interface ItemState {
  title: string;
  modelLabel?: string;
  status: "processing" | "completed" | "failed" | "canceled";
  content: string;
  statusMessage: string;
  error?: string;
}

interface BatchState {
  mode: string;
  totalCount: number;
  items: ItemState[];
  currentIndex: number;
  successCount: number;
  failedCount: number;
  canceledCount: number;
  stopped: boolean;
}

export class OutputWindowManager {
  private static state: BatchState | null = null;
  private static window: OutputWindow | null = null;
  private static onStopCallback: (() => void) | null = null;
  private static onStopCurrentCallback: (() => void) | null = null;

  public static async startBatch(
    mode: string,
    totalCount: number,
  ): Promise<OutputWindow> {
    if (this.state && !this.state.stopped) {
      this.endBatch();
    }

    this.state = {
      mode,
      totalCount,
      items: [],
      currentIndex: -1,
      successCount: 0,
      failedCount: 0,
      canceledCount: 0,
      stopped: false,
    };

    const win = await this.createWindow();
    win.initializeProgress(totalCount);
    return win;
  }

  public static endBatch(): void {
    this.state = null;
    this.window = null;
    this.onStopCallback = null;
    this.onStopCurrentCallback = null;
  }

  public static hasActiveBatch(): boolean {
    return (
      this.state !== null &&
      !this.state.stopped &&
      this.state.successCount + this.state.failedCount + this.state.canceledCount <
        this.state.totalCount
    );
  }

  public static setOnStop(callback: () => void): void {
    this.onStopCallback = callback;
  }

  public static setOnStopCurrent(callback: () => void): void {
    this.onStopCurrentCallback = callback;
    if (this.window) {
      this.window.setOnStopCurrent(() => this.onStopCurrentCallback?.());
    }
  }

  public static recordItemStart(title: string, modelLabel?: string): void {
    if (!this.state) return;
    this.state.currentIndex++;
    this.state.items[this.state.currentIndex] = {
      title,
      modelLabel,
      status: "processing",
      content: "",
      statusMessage: "",
    };
  }

  public static recordItemContent(chunk: string): void {
    if (!this.state) return;
    const idx = this.state.currentIndex;
    if (idx >= 0 && idx < this.state.items.length) {
      this.state.items[idx].content += chunk;
    }
  }

  public static recordItemReplaceContent(content: string): void {
    if (!this.state) return;
    const idx = this.state.currentIndex;
    if (idx >= 0 && idx < this.state.items.length) {
      this.state.items[idx].content = content;
    }
  }

  public static recordItemComplete(): void {
    if (!this.state) return;
    const idx = this.state.currentIndex;
    if (idx >= 0 && idx < this.state.items.length) {
      this.state.items[idx].status = "completed";
    }
    this.state.successCount++;
  }

  public static recordItemCanceled(): void {
    if (!this.state) return;
    const idx = this.state.currentIndex;
    if (idx >= 0 && idx < this.state.items.length) {
      this.state.items[idx].status = "canceled";
    }
    this.state.canceledCount++;
  }

  public static recordItemError(title: string, error: string): void {
    if (!this.state) return;
    const idx = this.state.currentIndex;
    if (idx >= 0 && idx < this.state.items.length) {
      this.state.items[idx].status = "failed";
      this.state.items[idx].error = error;
    }
    this.state.failedCount++;
  }

  public static recordStatusUpdate(message: string): void {
    if (!this.state) return;
    const idx = this.state.currentIndex;
    if (idx >= 0 && idx < this.state.items.length) {
      this.state.items[idx].statusMessage = message;
    }
  }

  public static recordStopped(): void {
    if (!this.state) return;
    this.state.stopped = true;
  }

  public static async reopenWindow(): Promise<void> {
    if (!this.state) return;

    // 关闭当前窗口
    this.closeWindow();

    const win = await this.rebuildWindow();
    this.window = win;
  }

  public static closeWindow(): void {
    if (this.window) {
      this.window.close();
      this.window = null;
    }
  }

  private static async createWindow(): Promise<OutputWindow> {
    const win = new OutputWindow();
    await win.open();

    // 连接回调
    if (this.onStopCallback) {
      win.setOnStop(() => this.onStopCallback?.());
    }
    if (this.onStopCurrentCallback) {
      win.setOnStopCurrent(() => this.onStopCurrentCallback?.());
    }
    win.setOnClose(() => {
      // 窗口关闭时不做额外处理，状态保留在 Manager 中
    });

    this.window = win;
    return win;
  }

  private static async rebuildWindow(): Promise<OutputWindow> {
    const win = new OutputWindow();
    await win.open();

    // 重连回调
    if (this.onStopCallback) {
      win.setOnStop(() => this.onStopCallback?.());
    }
    if (this.onStopCurrentCallback) {
      win.setOnStopCurrent(() => this.onStopCurrentCallback?.());
    }
    win.setOnClose(() => {
      // 窗口关闭时不做额外处理
    });

    if (!this.state) return win;
    win.initializeProgress(this.state.totalCount);

    // 重放所有已处理的项目
    for (let i = 0; i < this.state.items.length; i++) {
      const item = this.state.items[i];

      if (item.status === "failed") {
        win.showError(item.title, item.error || "");
        continue;
      }

      await win.startItem(item.title, item.modelLabel);

      if (item.content) {
        win.replaceCurrentContent(item.content);
      }

      if (item.statusMessage) {
        win.updateCurrentStatus(item.statusMessage);
      }

      if (item.status === "completed") {
        win.finishItem();
      } else if (item.status === "canceled") {
        win.stopCurrentItem("已停止当前条目的AI总结，未保存到笔记。");
      } else if (item.status === "processing") {
        // 正在处理的 item - 保持打开状态
      }

      // 每个 item 之间短暂延迟，避免 ensureOutputContainerReady 超时
      await Zotero.Promise.delay(100);
    }

    // 恢复停止按钮状态
    if (this.state.stopped) {
      win.disableStopButton(true);
    }

    return win;
  }
}
