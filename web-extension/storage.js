// @ts-check

export const DEFAULT_SETTINGS = {
  bridgeUrl: "http://127.0.0.1:23123",
};

const LEGACY_BRIDGE_URLS = new Set([
  "http://127.0.0.1:23119/ainote/web-summary",
  "http://127.0.0.1:23123",
  "http://127.0.0.1:23123/",
]);

/**
 * @returns {Promise<typeof DEFAULT_SETTINGS>}
 */
export async function getSettings() {
  const result = await chrome.storage.local.get(DEFAULT_SETTINGS);
  const merged = { ...DEFAULT_SETTINGS, ...result };
  if (LEGACY_BRIDGE_URLS.has(String(merged.bridgeUrl || "").trim())) {
    merged.bridgeUrl = DEFAULT_SETTINGS.bridgeUrl;
    await chrome.storage.local.set({ bridgeUrl: merged.bridgeUrl });
  }
  return merged;
}

/**
 * @param {Partial<typeof DEFAULT_SETTINGS>} patch
 */
export async function saveSettings(patch) {
  await chrome.storage.local.set(patch);
}
