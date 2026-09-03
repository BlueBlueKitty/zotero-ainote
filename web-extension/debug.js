// @ts-check

/** @typedef {"off" | "error" | "debug"} WebSummaryLogLevel */

/** @type {WebSummaryLogLevel} */
let currentLogLevel = "error";

/**
 * @param {unknown} value
 * @returns {WebSummaryLogLevel}
 */
export function normalizeLogLevel(value) {
  const text = String(value || "")
    .trim()
    .toLowerCase();
  if (text === "off" || text === "debug") {
    return text;
  }
  return "error";
}

/**
 * @param {WebSummaryLogLevel} level
 */
export function setLogLevel(level) {
  currentLogLevel = normalizeLogLevel(level);
}

/**
 * @returns {WebSummaryLogLevel}
 */
export function getLogLevel() {
  return currentLogLevel;
}

/**
 * @param {"error" | "debug"} level
 */
export function shouldLog(level) {
  if (currentLogLevel === "off") {
    return false;
  }
  if (level === "error") {
    return currentLogLevel === "error" || currentLogLevel === "debug";
  }
  return currentLogLevel === "debug";
}

/**
 * @param {unknown} details
 * @returns {string}
 */
export function formatLogDetails(details) {
  if (details instanceof Error) {
    return details.stack || details.message;
  }
  try {
    const serialized = JSON.stringify(details);
    return serialized === undefined ? String(details) : serialized;
  } catch {
    return String(details);
  }
}

/**
 * @param {string} scope
 * @param {string} message
 * @param {unknown} [details]
 */
export function debugLog(scope, message, details) {
  if (!shouldLog("debug")) {
    return;
  }
  const prefix = `[AiNote][WebSummaryDebug][${scope}] ${message}`;
  if (details === undefined) {
    console.log(prefix);
    return;
  }
  console.log(prefix, formatLogDetails(details));
}

/**
 * @param {string} scope
 * @param {string} message
 * @param {unknown} [details]
 */
export function errorLog(scope, message, details) {
  if (!shouldLog("error")) {
    return;
  }
  const prefix = `[AiNote][WebSummaryError][${scope}] ${message}`;
  if (details === undefined) {
    console.error(prefix);
    return;
  }
  console.error(prefix, formatLogDetails(details));
}
