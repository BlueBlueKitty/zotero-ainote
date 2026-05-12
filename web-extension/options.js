// @ts-check

import { healthCheck } from "./bridge-client.js";
import { DEFAULT_SETTINGS, getSettings, saveSettings } from "./storage.js";

const bridgeUrl = /** @type {HTMLInputElement} */ (document.getElementById("bridgeUrl"));
const pollingIntervalMs = /** @type {HTMLInputElement} */ (document.getElementById("pollingIntervalMs"));
const pollingEnabled = /** @type {HTMLInputElement} */ (document.getElementById("pollingEnabled"));
const autoSend = /** @type {HTMLInputElement} */ (document.getElementById("autoSend"));
const autoRenameConversation = /** @type {HTMLInputElement} */ (document.getElementById("autoRenameConversation"));
const status = /** @type {HTMLDivElement} */ (document.getElementById("status"));

async function load() {
  const settings = await getSettings();
  bridgeUrl.value = settings.bridgeUrl;
  pollingIntervalMs.value = String(settings.pollingIntervalMs);
  pollingEnabled.checked = settings.pollingEnabled;
  autoSend.checked = settings.autoSend;
  autoRenameConversation.checked = settings.autoRenameConversation;
}

async function onSave() {
  await saveSettings({
    bridgeUrl: bridgeUrl.value.trim() || DEFAULT_SETTINGS.bridgeUrl,
    pollingIntervalMs: parseInt(pollingIntervalMs.value, 10) || DEFAULT_SETTINGS.pollingIntervalMs,
    pollingEnabled: pollingEnabled.checked,
    autoSend: autoSend.checked,
    autoRenameConversation: autoRenameConversation.checked,
  });
  status.textContent = "设置已保存。";
}

async function onTest() {
  status.textContent = "正在测试连接...";
  try {
    const result = await healthCheck();
    status.textContent = `连接成功：${JSON.stringify(result)}`;
  } catch (error) {
    status.textContent = `连接失败：${error instanceof Error ? error.message : String(error)}`;
  }
}

document.getElementById("save")?.addEventListener("click", () => {
  void onSave();
});
document.getElementById("test")?.addEventListener("click", () => {
  void onTest();
});

void load();
