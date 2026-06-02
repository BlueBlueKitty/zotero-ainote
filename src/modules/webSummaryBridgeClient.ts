import {
  BridgeHealthResponse,
  CancelTaskResponse,
  CreateTaskRequest,
  CreateTaskResponse,
  RemoveTaskResponse,
  WebSummaryTask,
} from "./webSummaryTypes";

export class WebSummaryBridgeClient {
  public static async healthCheck(): Promise<BridgeHealthResponse> {
    return addon.data.webSummaryBridge!.getHealth();
  }

  public static async createTask(
    payload: CreateTaskRequest,
  ): Promise<CreateTaskResponse> {
    return addon.data.webSummaryBridge!.createTask(payload);
  }

  public static async getTask(taskId: string): Promise<WebSummaryTask> {
    return addon.data.webSummaryBridge!.getTask(taskId);
  }

  public static async cancelTask(
    taskId: string,
    reason?: string,
  ): Promise<CancelTaskResponse> {
    return addon.data.webSummaryBridge!.cancelTask(taskId, reason);
  }

  public static async removeTask(taskId: string): Promise<RemoveTaskResponse> {
    return addon.data.webSummaryBridge!.removeTask(taskId);
  }

  public static subscribeTask(
    taskId: string,
    listener: (task: WebSummaryTask) => void,
  ): () => void {
    return addon.data.webSummaryBridge!.getTaskStore().subscribeTask(taskId, listener);
  }

  public static subscribeAll(
    listener: (task: WebSummaryTask) => void,
  ): () => void {
    return addon.data.webSummaryBridge!.getTaskStore().subscribeAll(listener);
  }
}
