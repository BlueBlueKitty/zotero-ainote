import {
  CancelTaskResponse,
  CreateTaskRequest,
  CreateTaskResponse,
  RemoveTaskResponse,
  WebSummaryBridgeStatus,
  WebSummaryTask,
} from "./webSummaryTypes";

export class WebSummaryBridgeClient {
  public static getStatus(): WebSummaryBridgeStatus {
    return addon.data.webSummaryBridge!.getStatus();
  }

  public static approvePairingRequest(
    requestId: string,
  ): WebSummaryBridgeStatus {
    return addon.data.webSummaryBridge!.approvePairingRequest(requestId);
  }

  public static rejectPairingRequest(
    requestId: string,
    reason?: string,
  ): WebSummaryBridgeStatus {
    return addon.data.webSummaryBridge!.rejectPairingRequest(requestId, reason);
  }

  public static revokePairing(): WebSummaryBridgeStatus {
    return addon.data.webSummaryBridge!.revokePairing();
  }

  public static async createTask(
    payload: CreateTaskRequest,
  ): Promise<CreateTaskResponse> {
    return addon.data.webSummaryBridge!.createTask(payload);
  }

  public static async getTask(taskId: string): Promise<WebSummaryTask> {
    return addon.data.webSummaryBridge!.getTask(taskId);
  }

  public static hasActiveTaskForItem(itemId: number): boolean {
    return addon.data.webSummaryBridge!.hasActiveTaskForItem(itemId);
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
    return addon.data
      .webSummaryBridge!.getTaskStore()
      .subscribeTask(taskId, listener);
  }

  public static subscribeAll(
    listener: (task: WebSummaryTask) => void,
  ): () => void {
    return addon.data.webSummaryBridge!.getTaskStore().subscribeAll(listener);
  }
}
