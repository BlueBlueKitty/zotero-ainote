// @ts-check

import { healthCheck } from "./bridge-client.js";
import { DEFAULT_SETTINGS, getSettings, saveSettings } from "./storage.js";

const bridgeUrl = /** @type {HTMLInputElement} */ (document.getElementById("bridgeUrl"));
const status = /** @type {HTMLDivElement} */ (document.getElementById("status"));

function t(key) {
  return chrome.i18n.getMessage(key) || key;
}

function applyI18n() {
  for (const element of Array.from(document.querySelectorAll("[data-i18n]"))) {
    const key = element.getAttribute("data-i18n");
    if (!key) continue;
    const text = t(key);
    if (text) {
      element.textContent = text;
    }
  }
  const title = t("optionsTitle");
  if (title) {
    document.title = title;
  }
}

async function load() {
  const settings = await getSettings();
  bridgeUrl.value = settings.bridgeUrl;
}

async function onSave() {
  await saveSettings({
    bridgeUrl: bridgeUrl.value.trim() || DEFAULT_SETTINGS.bridgeUrl,
  });
  status.textContent = t("statusSaved");
}

async function onTest() {
  status.textContent = t("statusTesting");
  try {
    const result = await healthCheck();
    const checks = Array.isArray(result?.checks) ? result.checks : [];
    const relevantChecks = checks.filter((entry) => entry?.scope === "basic");
    const abnormalChecks = relevantChecks.filter(
      (entry) => entry?.status === "warn" || entry?.status === "fail",
    );

    if (!checks.length || abnormalChecks.length === 0) {
      status.textContent = t("statusTestSuccessBasic");
      return;
    }

    const detailLines = abnormalChecks.map((entry) => {
      const level = entry.status === "fail" ? "FAIL" : "WARN";
      const title = entry.title || entry.key || "unknown";
      const message = entry.message || "";
      return `- [${level}] ${title}: ${message}`;
    });
    status.textContent = `${t("statusTestAbnormal")}\n${detailLines.join("\n")}`;
  } catch (error) {
    status.textContent = `${t("statusTestFailed")}: ${error instanceof Error ? error.message : String(error)}`;
  }
}

document.getElementById("save")?.addEventListener("click", () => {
  void onSave();
});
document.getElementById("test")?.addEventListener("click", () => {
  void onTest();
});

applyI18n();
void load();
