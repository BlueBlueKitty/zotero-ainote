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
  | "PROTOCOL_MISMATCH"
  | "REQUIRED_CAPABILITY_MISSING"
  | "PERMISSION_MISSING"
  | "TARGET_PAGE_UNAVAILABLE"
  | "EXTENSION_OFFLINE"
  | "INTERNAL_ERROR";

export const WEB_SUMMARY_PROTOCOL_VERSION = "1.0.0";
export const WEB_SUMMARY_TASK_CONTRACT_VERSION = "1.0.0";
export const WEB_SUMMARY_EXTENSION_HEARTBEAT_TTL_MS = 60_000;
export const WEB_SUMMARY_UPDATE_CHECK_TTL_MS = 12 * 60 * 60 * 1000;
export const WEB_SUMMARY_VERSION_INFO_URL =
  "https://raw.githubusercontent.com/BlueBlueKitty/zotero-ainote/main/web-version.json";

export const WEB_SUMMARY_REQUIRED_CAPABILITIES = [
  "task.summarize",
  "task.open_conversation",
  "task.status.report",
  "task.result.report",
  "task.cancel",
  "task.fetch_pdf",
  "task.mode_switch",
  "task.streaming_result_fetch",
] as const;

export type WebSummaryCapability = (typeof WEB_SUMMARY_REQUIRED_CAPABILITIES)[number];

export const WEB_SUMMARY_REQUIRED_PERMISSIONS = [
  "storage",
  "tabs",
  "scripting",
  "host:http://127.0.0.1/*",
  "host:https://chatgpt.com/*",
] as const;

export type WebSummaryPermission = (typeof WEB_SUMMARY_REQUIRED_PERMISSIONS)[number];

export interface CompatibilityWarning {
  code: string;
  message: string;
}

export interface CompatibilityBlockReason {
  code: BridgeErrorCode;
  message: string;
}

export interface ExtensionRuntimeStatus {
  online: boolean;
  lastHeartbeatAt?: string;
  lastActivityAt?: string;
}

export interface ExtensionEnvironmentStatus {
  targetReachable: boolean;
  contentScriptReady: boolean;
  chatgptTabReady: boolean;
}

export interface ExtensionPermissionStatus {
  permission: string;
  granted: boolean;
}

export interface ExtensionHandshakePayload {
  extensionVersion: string;
  protocolVersion: string;
  taskContractVersion: string;
  capabilities: string[];
  permissions: ExtensionPermissionStatus[];
  environment: ExtensionEnvironmentStatus;
  heartbeatAt: string;
}

export interface UpdateVersionInfo {
  latestVersion?: string;
  minCompatibleProtocol?: string;
}

export interface WebSummaryVersionInfoFile {
  plugin?: UpdateVersionInfo;
  extension?: UpdateVersionInfo;
}

export interface CompatibilityDetails {
  pluginVersion: string;
  extensionVersion?: string;
  protocolVersion: string;
  extensionProtocolVersion?: string;
  taskContractVersion: string;
  extensionTaskContractVersion?: string;
  requiredCapabilities: string[];
  extensionCapabilities: string[];
  requiredPermissions: string[];
  extensionPermissions: ExtensionPermissionStatus[];
  environment?: ExtensionEnvironmentStatus;
  runtimeStatus: ExtensionRuntimeStatus;
}

export interface CompatibilityReport {
  allowCreateSummarize: boolean;
  blockingReasons: CompatibilityBlockReason[];
  warnings: CompatibilityWarning[];
  details: CompatibilityDetails;
}

export interface BridgeHealthResponse {
  status: string;
  pluginVersion: string;
  protocolVersion: string;
  taskContractVersion: string;
  requiredCapabilities: string[];
  requiredPermissions: string[];
  runtimeStatus: ExtensionRuntimeStatus;
  compatibilityWarnings?: CompatibilityWarning[];
  checks?: BridgeHealthCheckItem[];
  updatedAt: string;
}

export interface BridgeHealthCheckItem {
  key:
    | "runtime_online"
    | "protocol_compatible"
    | "task_contract_compatible"
    | "required_capabilities"
    | "required_permissions"
    | "target_page_environment"
    | "plugin_update"
    | "extension_update";
  scope: "basic" | "runtime";
  title: string;
  status: "pass" | "warn" | "fail";
  message: string;
  details?: Record<string, unknown>;
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
  resultSource?: "api" | "dom";
  resultDebugInfo?: string;
  modeSwitchOk?: boolean;
  modeSwitchFailed?: boolean;
  modeSwitchError?: string;
  pdfUploadReady?: boolean;
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

export interface RemoveTaskResponse {
  removed: boolean;
  task?: WebSummaryTask;
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
  modeSwitchOk?: boolean;
  modeSwitchFailed?: boolean;
  modeSwitchError?: string;
  pdfUploadReady?: boolean;
  debugMessage?: string;
}

export interface ReportTaskResultRequest extends WebSummaryConversationMeta {
  resultMarkdown: string;
  resultSource?: "api" | "dom";
  resultDebugInfo?: string;
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
