export type SummaryTaskKind = "api" | "web";

export type SummaryTaskStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface SummaryTask {
  id: string;
  kind: SummaryTaskKind;
  webTaskId?: string;
  itemID: number;
  itemKey?: string;
  title: string;
  status: SummaryTaskStatus;
  progress?: number;
  stage?: string;
  content: string;
  error?: string;
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  finishedAt?: number;
  noteID?: number;
  webConversationId?: string;
  webConversationUrl?: string;
  webConversationTitle?: string;
  model?: string;
  promptVersion?: string;
  templateId?: string;
  preferredPdfAttachmentID?: number;
  attempt?: number;
}

export interface SummaryTaskRuntime {
  cancel?: () => void;
}

export interface SummaryTaskSnapshot {
  tasks: SummaryTask[];
  selectedTaskId?: string;
}

export function isTerminalStatus(status: SummaryTaskStatus): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}
