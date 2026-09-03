// @ts-check

import {
  DEFAULT_SETTINGS,
  clearPairingToken,
  getPairingToken,
  getSettings,
  saveSettings,
} from "./storage.js";

const logLevel = /** @type {HTMLSelectElement} */ (
  document.getElementById("logLevel")
);
const status = /** @type {HTMLDivElement} */ (
  document.getElementById("status")
);

function t(key) {
  return chrome.i18n.getMessage(key) || key;
}

function applyI18n() {
  for (const element of Array.from(document.querySelectorAll("[data-i18n]"))) {
    const key = element.getAttribute("data-i18n");
    if (!key) continue;
    const text = t(key);
    if (text) element.textContent = text;
  }
  document.title = t("optionsTitle");
}

async function load() {
  const settings = await getSettings();
  logLevel.value = settings.logLevel || DEFAULT_SETTINGS.logLevel;
  const token = await getPairingToken();
  status.textContent = token ? t("statusPairedLocal") : t("statusNotPaired");
}

async function onSave() {
  const value = String(logLevel.value || "error");
  await saveSettings({
    logLevel: value === "off" || value === "debug" ? value : "error",
  });
  status.textContent = t("statusSaved");
}

async function onPair() {
  status.textContent = t("statusPairing");
  try {
    const result = await chrome.runtime.sendMessage({
      type: "ainote-start-pairing",
    });
    if (!result?.ok) throw new Error(result?.error || "Pairing failed");
    status.textContent = t("statusPairSuccess");
  } catch (error) {
    status.textContent = `${t("statusTestFailed")}: ${
      error instanceof Error ? error.message : String(error)
    }`;
  }
}

async function onTest() {
  status.textContent = t("statusTesting");
  try {
    const result = await chrome.runtime.sendMessage({
      type: "ainote-test-session",
    });
    if (!result?.ok) throw new Error(result?.error || "Session failed");
    status.textContent = `${t("statusTestSuccessBasic")}\n${result.summary || ""}`;
  } catch (error) {
    status.textContent = `${t("statusTestFailed")}: ${
      error instanceof Error ? error.message : String(error)
    }`;
  }
}

async function onForget() {
  await clearPairingToken();
  status.textContent = t("statusNotPaired");
}

document.getElementById("save")?.addEventListener("click", () => void onSave());
document.getElementById("pair")?.addEventListener("click", () => void onPair());
document.getElementById("test")?.addEventListener("click", () => void onTest());
document
  .getElementById("forget")
  ?.addEventListener("click", () => void onForget());

applyI18n();
void load();
