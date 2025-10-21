import { getPref, setPref, clearPref } from "../utils/prefs";
import { getDefaultSummaryPrompt, PROMPT_VERSION, shouldUpdatePrompt } from "../utils/prompts";

export async function registerPrefsScripts(_window: Window) {
  // 先不用任何延迟，直接执行
  try {
    migrateToGlobalOnce();
    initializeDefaultPrefs();
    // diagnosePrefs(); // 仅在需要调试配置问题时启用
    updatePrefsUI(_window);
    bindPrefEvents(_window);
  } catch (error) {
    console.error("[AiNote][Prefs] Error in registerPrefsScripts:", error);
  }
}

function updatePrefsUI(win: Window) {
  const doc = win.document;
  const apiKeyInput = doc.getElementById("zotero-prefpane-ainote-apiKey") as HTMLInputElement | null;
  const apiUrlInput = doc.getElementById("zotero-prefpane-ainote-apiUrl") as HTMLInputElement | null;
  const modelInput = doc.getElementById("zotero-prefpane-ainote-model") as HTMLInputElement | null;
  const temperatureInput = doc.getElementById("zotero-prefpane-ainote-temperature") as HTMLInputElement | null;
  const promptTextarea = doc.getElementById("zotero-prefpane-ainote-summaryPrompt") as HTMLTextAreaElement | null;
  const streamCheckbox = doc.getElementById("zotero-prefpane-ainote-stream") as HTMLInputElement | null;

  const apiKey = (getPref("apiKey") as string) || "";
  const apiUrl = (getPref("apiUrl") as string) || "https://api.openai.com/v1/chat/completions";
  const model = (getPref("model") as string) || "gpt-3.5-turbo";
  const temperature = (getPref("temperature") as string) || "0.7";
  const defaultPrompt = getDefaultSummaryPrompt();
  const savedPrompt = getPref("summaryPrompt") as string;
  const stream = (getPref("stream") as boolean) ?? true;

  if (apiKeyInput) apiKeyInput.value = apiKey;
  if (apiUrlInput) apiUrlInput.value = apiUrl;
  if (modelInput) modelInput.value = model;
  if (temperatureInput) temperatureInput.value = temperature;
  if (promptTextarea) {
    // 如果没有保存的 prompt 或者是 undefined/空字符串，使用默认值
    const finalPrompt = savedPrompt && savedPrompt.trim() ? savedPrompt : defaultPrompt;
    promptTextarea.value = finalPrompt;
    // 确保保存默认值到配置中
    if (!savedPrompt || !savedPrompt.trim()) {
      setPref("summaryPrompt", defaultPrompt);
    }
  }
  if (streamCheckbox) streamCheckbox.checked = !!stream;
}

function bindPrefEvents(win: Window) {
  const doc = win.document;
  const apiKeyInput = doc.getElementById("zotero-prefpane-ainote-apiKey") as HTMLInputElement | null;
  const apiUrlInput = doc.getElementById("zotero-prefpane-ainote-apiUrl") as HTMLInputElement | null;
  const modelInput = doc.getElementById("zotero-prefpane-ainote-model") as HTMLInputElement | null;
  const temperatureInput = doc.getElementById("zotero-prefpane-ainote-temperature") as HTMLInputElement | null;
  const promptTextarea = doc.getElementById("zotero-prefpane-ainote-summaryPrompt") as HTMLTextAreaElement | null;
  const streamCheckbox = doc.getElementById("zotero-prefpane-ainote-stream") as HTMLInputElement | null;

  if (apiKeyInput) {
    const save = () => setPref("apiKey", apiKeyInput.value || "");
    apiKeyInput.addEventListener("input", save);
    apiKeyInput.addEventListener("blur", save);
    apiKeyInput.addEventListener("change", save);
  }
  if (apiUrlInput) {
    const save = () => setPref("apiUrl", apiUrlInput.value || "");
    apiUrlInput.addEventListener("input", save);
    apiUrlInput.addEventListener("blur", save);
    apiUrlInput.addEventListener("change", save);
  }
  if (modelInput) {
    const save = () => setPref("model", modelInput.value || "");
    modelInput.addEventListener("input", save);
    modelInput.addEventListener("blur", save);
    modelInput.addEventListener("change", save);
  }
  if (temperatureInput) {
    const save = () => {
      const value = temperatureInput.value || "0.7";
      setPref("temperature", value);
    };
    temperatureInput.addEventListener("input", save);
    temperatureInput.addEventListener("blur", save);
    temperatureInput.addEventListener("change", save);
  }
  if (promptTextarea) {
    const save = () => setPref("summaryPrompt", promptTextarea.value || getDefaultSummaryPrompt());
    promptTextarea.addEventListener("input", save);
    promptTextarea.addEventListener("blur", save);
    promptTextarea.addEventListener("change", save);
  }
  if (streamCheckbox) {
    const save = () => setPref("stream", !!streamCheckbox.checked);
    streamCheckbox.addEventListener("input", save);
    streamCheckbox.addEventListener("change", save);
    streamCheckbox.addEventListener("blur", save);
  }

  // flush on unload to persist any in-focus edits
  win.addEventListener("unload", () => {
    if (apiKeyInput) setPref("apiKey", apiKeyInput.value || "");
    if (apiUrlInput) setPref("apiUrl", apiUrlInput.value || "");
    if (modelInput) setPref("model", modelInput.value || "");
    if (temperatureInput) setPref("temperature", temperatureInput.value || "0.7");
    if (promptTextarea) setPref("summaryPrompt", promptTextarea.value || getDefaultSummaryPrompt());
    if (streamCheckbox) setPref("stream", !!streamCheckbox.checked);
  });
}

// getDefaultPrompt 函数已移除，使用 prompts.ts 中的函数

/**
 * 初始化默认配置 - 在插件加载时立即执行
 * 确保即使 prefs.js 没有加载，也能有默认值
 */
function initializeDefaultPrefs() {
  const defaults: Record<string, any> = {
    apiKey: "",
    apiUrl: "https://api.openai.com/v1/chat/completions",
    model: "gpt-3.5-turbo",
    temperature: "0.7",
    stream: true,
    summaryPrompt: getDefaultSummaryPrompt(),
    promptVersion: PROMPT_VERSION,
  };

  // 遍历所有默认配置
  for (const [key, defaultValue] of Object.entries(defaults)) {
    try {
      const currentValue = getPref(key as any);
      
      // 特殊处理提示词更新
      if (key === "summaryPrompt") {
        const currentPromptVersion = getPref("promptVersion" as any) as number | undefined;
        const currentPrompt = currentValue as string | undefined;
        
        // 检查是否需要更新提示词
        if (shouldUpdatePrompt(currentPromptVersion, currentPrompt)) {
          console.log(`[AiNote][Prefs] 更新提示词到版本 ${PROMPT_VERSION}`);
          setPref("summaryPrompt" as any, defaultValue);
          setPref("promptVersion" as any, PROMPT_VERSION);
          continue;
        }
      }
      
      // 如果配置不存在或为空，则设置默认值
      if (currentValue === undefined || currentValue === null) {
        // const preview = typeof defaultValue === 'string' && defaultValue.length > 50 
        //   ? defaultValue.substring(0, 50) + '...' 
        //   : defaultValue;
        // console.log(`[AiNote][Prefs] 初始化配置: ${key} = ${preview}`);
        setPref(key as any, defaultValue);
      } else if (typeof defaultValue === 'string' && typeof currentValue === 'string' && !currentValue.trim()) {
        // 对于字符串类型，如果是空字符串也重置
        // console.log(`[AiNote][Prefs] 重置空配置: ${key}`);
        setPref(key as any, defaultValue);
      }
    } catch (error) {
      console.error(`[AiNote][Prefs] 初始化配置失败: ${key}`, error);
      // 如果读取失败，尝试强制设置
      try {
        setPref(key as any, defaultValue);
      } catch (e) {
        console.error(`[AiNote][Prefs] 强制设置配置失败: ${key}`, e);
      }
    }
  }
}

/**
 * 诊断配置问题 - 在控制台输出详细信息（仅在调试时使用）
 * 取消注释 registerPrefsScripts 中的调用来启用
 */
function diagnosePrefs() {
  console.log("[AiNote][Prefs] ========== 配置诊断开始 ==========");
  
  const keys = ["apiKey", "apiUrl", "model", "temperature", "stream", "summaryPrompt"];
  
  for (const key of keys) {
    try {
      const value = getPref(key as any);
      const valueType = typeof value;
      const valueLength = typeof value === 'string' ? value.length : 'N/A';
      const valuePreview = typeof value === 'string' && value.length > 100 
        ? value.substring(0, 100) + '...' 
        : value;
      
      console.log(`[AiNote][Prefs] 配置项: ${key}`);
      console.log(`  - 值: ${valuePreview}`);
      console.log(`  - 类型: ${valueType}`);
      console.log(`  - 长度: ${valueLength}`);
      console.log(`  - 是否为空: ${value === undefined || value === null || (typeof value === 'string' && !value.trim())}`);
    } catch (error) {
      console.error(`[AiNote][Prefs] 读取配置失败: ${key}`, error);
    }
  }
  
  console.log("[AiNote][Prefs] ========== 配置诊断结束 ==========");
}

// One-time migration from provider-scoped or misspelled keys back to global keys
function migrateToGlobalOnce() {
  try {
    const flag = getPref("migratedToGlobalV2" as any) as boolean;
    if (flag) return;

    const pick = (k: string): string | undefined => {
      const sources = [
        `custom_${k}`,
        `deepseek_${k}`,
        `openai_${k}`,
        k, // legacy global
        `customed_${k}`, // misspelled legacy
      ];
      for (const s of sources) {
        const v = getPref(s as any) as string;
        if (v) return v;
      }
      return undefined;
    };

    const apiKey = pick("apiKey") || "";
    const apiUrl = pick("apiUrl") || "https://api.openai.com/v1/chat/completions";
    const model = pick("model") || "gpt-3.5-turbo";

    setPref("apiKey", apiKey);
    setPref("apiUrl", apiUrl);
    setPref("model", model);

    for (const p of ["openai", "deepseek", "custom", "customed"]) {
      for (const k of ["apiKey", "apiUrl", "model"]) {
        clearPref(`${p}_${k}`);
      }
    }
    // keep globals only from now on

    setPref("migratedToGlobalV2" as any, true as any);
  } catch (err) {
    // noop
  }
}
