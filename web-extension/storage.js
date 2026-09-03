// @ts-check

export const DEFAULT_SETTINGS = {
  logLevel: "error",
};

/** @returns {Promise<{logLevel: "off" | "error" | "debug"}>} */
export async function getSettings() {
  const result = await chrome.storage.local.get(DEFAULT_SETTINGS);
  const value = String(result.logLevel || "error");
  return {
    logLevel: value === "off" || value === "debug" ? value : "error",
  };
}

/** @param {{logLevel?: "off" | "error" | "debug"}} patch */
export async function saveSettings(patch) {
  await chrome.storage.local.set(patch);
}

export async function getInstallId() {
  const result = await chrome.storage.local.get("installId");
  if (typeof result.installId === "string" && result.installId) {
    return result.installId;
  }
  const installId = crypto.randomUUID();
  await chrome.storage.local.set({ installId });
  return installId;
}

export async function getPairingToken() {
  const result = await chrome.storage.local.get("pairingToken");
  return typeof result.pairingToken === "string" ? result.pairingToken : "";
}

export async function savePairingToken(token) {
  await chrome.storage.local.set({ pairingToken: String(token || "") });
}

export async function clearPairingToken() {
  await chrome.storage.local.remove("pairingToken");
}

export async function getExecutionTabId() {
  const result = await chrome.storage.local.get("executionTabId");
  return Number.isInteger(result.executionTabId) ? result.executionTabId : null;
}

export async function saveExecutionTabId(tabId) {
  await chrome.storage.local.set({ executionTabId: tabId });
}

export async function clearExecutionTabId() {
  await chrome.storage.local.remove("executionTabId");
}
