export type WebSummaryPlatform = "chatgpt";

export type WebSummaryActionType = "summarize" | "open_conversation";

export type WebSummaryConversationMode = "new-per-item";

export type WebSummaryChatGPTMode = "instant" | "thinking";

export type WebSummaryTaskStatus =
  | "queued"
  | "claimed"
  | "opening_chat"
  | "locating_folder"
  | "creating_conversation"
  | "downloading_pdf"
  | "awaiting_user_send"
  | "running"
  | "succeeded"
  | "failed"
  | "canceled";

export type BridgeErrorCode =
  | "UNAUTHORIZED"
  | "INVALID_REQUEST"
  | "TASK_NOT_FOUND"
  | "INVALID_STATUS_TRANSITION"
  | "PDF_NOT_FOUND"
  | "FOLDER_REQUIRED"
  | "UNSUPPORTED_PLATFORM"
  | "INTERNAL_ERROR";

export interface WebSummaryConversationMeta {
  conversationId?: string;
  conversationUrl?: string;
  conversationTitle?: string;
  folderName?: string;
  folderResolved?: boolean;
  createdAt?: string;
  lastUsedAt?: string;
}

export interface WebSummaryItemChatLink extends WebSummaryConversationMeta {
  platform: WebSummaryPlatform;
}

export interface WebSummaryTask {
  taskId: string;
  itemId: number;
  libraryId: number;
  title: string;
  pdfPath?: string;
  pdfFileName?: string;
  prompt?: string;
  createdAt: string;
  updatedAt: string;
  status: WebSummaryTaskStatus;
  platform: WebSummaryPlatform;
  actionType: WebSummaryActionType;
  conversationMode: WebSummaryConversationMode;
  projectUrl?: string;
  chatgptMode?: WebSummaryChatGPTMode;
  conversationTitle?: string;
  existingConversationId?: string;
  existingConversationUrl?: string;
  resultMarkdown?: string;
  errorCode?: BridgeErrorCode;
  errorMessage?: string;
  cancelRequestedAt?: string;
  cancelReason?: string;
  conversationMeta?: WebSummaryConversationMeta;
}

export interface CreateTaskRequest {
  itemId: number;
  libraryId: number;
  title: string;
  pdfPath?: string;
  pdfFileName?: string;
  prompt?: string;
  platform: WebSummaryPlatform;
  actionType: WebSummaryActionType;
  conversationMode: WebSummaryConversationMode;
  projectUrl?: string;
  chatgptMode?: WebSummaryChatGPTMode;
  conversationTitle?: string;
  existingConversationId?: string;
  existingConversationUrl?: string;
}

export interface CreateTaskResponse {
  task: WebSummaryTask;
}

export interface CancelTaskResponse {
  task: WebSummaryTask;
}

export interface ClaimNextTaskResponse {
  task: WebSummaryTask | null;
}

export interface ReportTaskStatusRequest {
  status: WebSummaryTaskStatus;
  conversationId?: string;
  conversationUrl?: string;
  conversationTitle?: string;
  folderName?: string;
  folderResolved?: boolean;
  errorCode?: BridgeErrorCode;
  errorMessage?: string;
}

export interface ReportTaskResultRequest extends WebSummaryConversationMeta {
  resultMarkdown: string;
}

export interface ReportTaskFailureRequest extends WebSummaryConversationMeta {
  errorCode: BridgeErrorCode;
  errorMessage: string;
}

export interface BridgeEnvelope<T> {
  ok: boolean;
  data?: T;
  error?: {
    code: BridgeErrorCode | "UNKNOWN_ERROR";
    message: string;
  };
}
