// @ts-check

export const BRIDGE_ORIGIN = "http://127.0.0.1:23123";
export const WEB_SUMMARY_PROTOCOL_VERSION = 2;
export const WEB_SUMMARY_CAPABILITIES = [
  "summarize",
  "openConversation",
  "lease",
];
export const TASK_CLAIM_WAIT_MS = 20_000;
export const CLAIM_WAKE_ALARM_NAME = "ainote-claim-wake-v2";
export const CLAIM_WAKE_ALARM_PERIOD_MINUTES = 0.5;

export function detectBrowser() {
  return navigator.userAgent.includes("Edg/") ? "edge" : "chrome";
}
