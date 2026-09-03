export type WebSummaryPlatform = "chatgpt";

export type WebSummaryActionType = "summarize" | "open_conversation";

export const WEB_SUMMARY_PROTOCOL_VERSION = 2;
export const WEB_SUMMARY_BRIDGE_PORT = 23123;
export const WEB_SUMMARY_BRIDGE_ORIGIN = `http://127.0.0.1:${WEB_SUMMARY_BRIDGE_PORT}`;
export const WEB_SUMMARY_LONG_POLL_MS = 20_000;
export const WEB_SUMMARY_LEASE_DURATION_MS = 45_000;
export const WEB_SUMMARY_EXTENSION_ONLINE_TTL_MS = 60_000;
export const WEB_SUMMARY_PAIRING_REQUEST_TTL_MS = 120_000;
export const WEB_SUMMARY_PAIRING_REQUEST_COOLDOWN_MS = 5_000;
export const WEB_SUMMARY_RESPONSE_START_TIMEOUT_MS = 60_000;
export const WEB_SUMMARY_DEFAULT_RESPONSE_TIMEOUT_MINUTES = 15;

export const WEB_SUMMARY_REQUIRED_CAPABILITIES = [
  "summarize",
  "openConversation",
  "lease",
] as const;

export type WebSummaryCapability =
  (typeof WEB_SUMMARY_REQUIRED_CAPABILITIES)[number];

export type WebSummaryBrowser = "chrome" | "edge";

export type WebSummaryTaskStatus =
  | "queued"
  | "leased"
  | "succeeded"
  | "failed"
  | "canceled";

export const WEB_SUMMARY_TASK_STAGES = [
  "claimed",
  "preparing_page",
  "uploading_pdf",
  "ready_to_send",
  "prompt_sent",
  "waiting_response",
  "extracting_result",
] as const;

export type WebSummaryTaskStage = (typeof WEB_SUMMARY_TASK_STAGES)[number];
export type WebSummarySendState = "not_sent" | "sent" | "unknown";

export type BridgeErrorCode =
  | "UNAUTHORIZED"
  | "PAIRING_REQUEST_NOT_FOUND"
  | "PAIRING_REJECTED"
  | "INVALID_REQUEST"
  | "TASK_NOT_FOUND"
  | "INVALID_STATUS_TRANSITION"
  | "LEASE_MISMATCH"
  | "LEASE_EXPIRED"
  | "SEND_STATE_UNKNOWN"
  | "PDF_NOT_FOUND"
  | "PROJECT_REQUIRED"
  | "PROJECT_UNAVAILABLE"
  | "CONVERSATION_UNAVAILABLE"
  | "PROTOCOL_MISMATCH"
  | "REQUIRED_CAPABILITY_MISSING"
  | "TARGET_PAGE_UNAVAILABLE"
  | "HUMAN_INTERVENTION_REQUIRED"
  | "RESPONSE_START_TIMEOUT"
  | "RESPONSE_TIMEOUT"
  | "EXTENSION_OFFLINE"
  | "BRIDGE_PORT_IN_USE"
  | "INTERNAL_ERROR";

export interface WebSummaryExtensionIdentity {
  installId: string;
  extensionVersion: string;
  protocolVersion: number;
  browser: WebSummaryBrowser;
  capabilities: string[];
}

export interface WebSummaryPairedExecutor extends WebSummaryExtensionIdentity {
  pairedAt: string;
  lastSeenAt?: string;
}

export interface PairingRequest extends WebSummaryExtensionIdentity {
  requestId: string;
  requestedAt: string;
  expiresAt: string;
  status: "pending" | "approved" | "rejected" | "expired" | "delivered";
  rejectionReason?: string;
}

export type CreatePairingRequest = WebSummaryExtensionIdentity;

export interface CreatePairingResponse {
  request: PairingRequest;
}

export interface PairingStatusResponse {
  request: PairingRequest;
  token?: string;
}

export interface WebSummaryBridgeStatus {
  running: boolean;
  protocolVersion: number;
  paired: boolean;
  extensionOnline: boolean;
  executor?: WebSummaryPairedExecutor;
  pendingPairingRequest?: PairingRequest;
  updatedAt: string;
}

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

export interface WebSummaryTaskLease {
  leaseId: string;
  executorInstallId: string;
  claimedAt: string;
  expiresAt: string;
}

export interface WebSummaryTask {
  taskId: string;
  itemId: number;
  libraryId: number;
  title: string;
  pdfPath?: string;
  pdfFileName?: string;
  prompt?: string;
  responseTimeoutMs?: number;
  createdAt: string;
  updatedAt: string;
  status: WebSummaryTaskStatus;
  stage?: WebSummaryTaskStage;
  sendState: WebSummarySendState;
  sentAt?: string;
  platform: WebSummaryPlatform;
  actionType: WebSummaryActionType;
  projectUrl?: string;
  conversationTitle?: string;
  existingConversationId?: string;
  existingConversationUrl?: string;
  lease?: WebSummaryTaskLease;
  resultMarkdown?: string;
  resultSource?: "api" | "dom";
  resultDebugInfo?: string;
  debugMessage?: string;
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
  responseTimeoutMs?: number;
  platform: WebSummaryPlatform;
  actionType: WebSummaryActionType;
  projectUrl?: string;
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

export interface RemoveTaskResponse {
  removed: boolean;
  task?: WebSummaryTask;
}

export interface ClaimNextTaskResponse {
  task: WebSummaryTask | null;
}

export interface ReportTaskEventRequest extends WebSummaryConversationMeta {
  requestId: string;
  leaseId: string;
  stage: WebSummaryTaskStage;
  debugMessage?: string;
}

export interface ReportTaskResultRequest extends WebSummaryConversationMeta {
  requestId: string;
  leaseId: string;
  resultMarkdown: string;
  resultSource?: "api" | "dom";
  resultDebugInfo?: string;
}

export interface ReportTaskFailureRequest extends WebSummaryConversationMeta {
  requestId: string;
  leaseId: string;
  errorCode: BridgeErrorCode;
  errorMessage: string;
  sendState?: WebSummarySendState;
  debugMessage?: string;
}

export interface BridgeSessionResponse {
  protocolVersion: number;
  executor: WebSummaryPairedExecutor;
  requiredCapabilities: string[];
  updatedAt: string;
}

export interface BridgeEnvelope<T> {
  ok: boolean;
  data?: T;
  error?: {
    code: BridgeErrorCode | "UNKNOWN_ERROR";
    message: string;
  };
}

export interface AuthenticatedExtensionContext {
  installId: string;
}
