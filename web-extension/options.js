// @ts-check

import { healthCheck } from "./bridge-client.js";
import { DEFAULT_SETTINGS, getSettings, saveSettings } from "./storage.js";

const bridgeUrl = /** @type {HTMLInputElement} */ (document.getElementById("bridgeUrl"));
const status = /** @type {HTMLDivElement} */ (document.getElementById("status"));

async function load() {
  const settings = await getSettings();
  bridgeUrl.value = settings.bridgeUrl;
}

async function onSave() {
  await saveSettings({
    bridgeUrl: bridgeUrl.value.trim() || DEFAULT_SETTINGS.bridgeUrl,
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
