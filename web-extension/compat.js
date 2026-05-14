// @ts-check

export const WEB_SUMMARY_PROTOCOL_VERSION = "1.0.0";
export const WEB_SUMMARY_TASK_CONTRACT_VERSION = "1.0.0";

export const WEB_SUMMARY_CAPABILITIES = [
  "task.summarize",
  "task.open_conversation",
  "task.status.report",
  "task.result.report",
  "task.cancel",
  "task.fetch_pdf",
  "task.mode_switch",
  "task.streaming_result_fetch",
];

export const WEB_SUMMARY_REQUIRED_PERMISSIONS = [
  "storage",
  "tabs",
  "scripting",
  "host:http://127.0.0.1/*",
  "host:https://chatgpt.com/*",
];

