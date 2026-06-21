import { getPref } from "../utils/prefs";

declare let ztoolkit: ZToolkit;

export type WebSummaryLogLevel = "off" | "error" | "debug";

function normalizeLogLevel(value: unknown): WebSummaryLogLevel {
  const text = String(value || "").trim().toLowerCase();
  if (text === "off" || text === "debug") {
    return text;
  }
  return "error";
}

export function getWebSummaryLogLevel(): WebSummaryLogLevel {
  return normalizeLogLevel(getPref("webSummaryLogLevel" as any));
}

function shouldLog(level: "error" | "debug"): boolean {
  const current = getWebSummaryLogLevel();
  if (current === "off") {
    return false;
  }
  if (level === "error") {
    return current === "error" || current === "debug";
  }
  return current === "debug";
}

function serializeDetails(details: unknown): unknown {
  if (details === undefined) {
    return undefined;
  }
  try {
    return JSON.parse(JSON.stringify(details));
  } catch {
    return details;
  }
}

function emit(prefix: string, details?: unknown): void {
  const normalizedDetails = serializeDetails(details);
  if (typeof ztoolkit !== "undefined" && typeof ztoolkit.log === "function") {
    if (normalizedDetails === undefined) {
      ztoolkit.log(prefix);
      return;
    }
    ztoolkit.log(prefix, normalizedDetails);
    return;
  }
  if (normalizedDetails === undefined) {
    console.log(prefix);
    return;
  }
  console.log(prefix, normalizedDetails);
}

export function debugWebSummaryLog(
  scope: string,
  message: string,
  details?: unknown,
): void {
  if (!shouldLog("debug")) {
    return;
  }
  emit(`[AiNote][WebSummaryDebug][${scope}] ${message}`, details);
}

export function errorWebSummaryLog(
  scope: string,
  message: string,
  details?: unknown,
): void {
  if (!shouldLog("error")) {
    return;
  }
  emit(`[AiNote][WebSummaryError][${scope}] ${message}`, details);
}
