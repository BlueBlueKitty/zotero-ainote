// @ts-check

import {
  claimNextTask,
  createPairingRequest,
  fetchTaskPdf,
  getPairingStatus,
  getSession,
  reportTaskEvent,
  reportTaskFailure,
  reportTaskResult,
} from "./bridge-client.js";
import {
  CLAIM_WAKE_ALARM_NAME,
  CLAIM_WAKE_ALARM_PERIOD_MINUTES,
  TASK_CLAIM_WAIT_MS,
  WEB_SUMMARY_CAPABILITIES,
  WEB_SUMMARY_PROTOCOL_VERSION,
  detectBrowser,
} from "./compat.js";
import { debugLog, errorLog, setLogLevel } from "./debug.js";
import {
  clearExecutionTabId,
  clearPairingToken,
  getExecutionTabId,
  getInstallId,
  getPairingToken,
  getSettings,
  saveExecutionTabId,
  savePairingToken,
} from "./storage.js";
import { reuseExistingPairing } from "./pairing.js";

const CHATGPT_HOME = "https://chatgpt.com/";
const SCRIPT_FILES = ["page-contract.js", "result-extractor.js", "content.js"];
const PAGE_READY_TIMEOUT_MS = 60_000;
const PAIRING_POLL_MS = 1_000;
const LEASE_HEARTBEAT_MS = 20_000;
const TASK_STAGES = [
  "claimed",
  "preparing_page",
  "uploading_pdf",
  "ready_to_send",
  "prompt_sent",
  "waiting_response",
  "extracting_result",
];

let workerRunning = false;
let currentRun = null;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function requestId() {
  return crypto.randomUUID();
}

function isChatGptUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return (
      url.protocol === "https:" &&
      (url.hostname === "chatgpt.com" || url.hostname === "chat.openai.com")
    );
  } catch {
    return false;
  }
}

function normalizeFailureCode(code, sendState) {
  const allowed = new Set([
    "UNAUTHORIZED",
    "INVALID_REQUEST",
    "LEASE_MISMATCH",
    "LEASE_EXPIRED",
    "PDF_NOT_FOUND",
    "PROJECT_UNAVAILABLE",
    "CONVERSATION_UNAVAILABLE",
    "TARGET_PAGE_UNAVAILABLE",
    "HUMAN_INTERVENTION_REQUIRED",
    "RESPONSE_START_TIMEOUT",
    "RESPONSE_TIMEOUT",
    "UPLOAD_NOT_OBSERVED",
    "UPLOAD_STUCK",
    "ATTACHMENT_NOT_READY",
    "INTERNAL_ERROR",
  ]);
  if (allowed.has(code)) return code;
  if (
    code === "LOGIN_REQUIRED" ||
    code === "PAGE_CONTRACT_UNAVAILABLE" ||
    code === "UPLOAD_FAILED"
  ) {
    return code === "LOGIN_REQUIRED"
      ? "HUMAN_INTERVENTION_REQUIRED"
      : "TARGET_PAGE_UNAVAILABLE";
  }
  return sendState === "sent" || sendState === "unknown"
    ? "SEND_STATE_UNKNOWN"
    : "TARGET_PAGE_UNAVAILABLE";
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const chunks = [];
  const size = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += size) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + size)));
  }
  return btoa(chunks.join(""));
}

async function waitForTabComplete(tabId, timeoutMs = PAGE_READY_TIMEOUT_MS) {
  const existing = await chrome.tabs.get(tabId);
  if (existing.status === "complete") return existing;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      reject(new Error("等待 ChatGPT 页面加载超时"));
    }, timeoutMs);
    const onUpdated = (updatedId, changeInfo, tab) => {
      if (updatedId !== tabId || changeInfo.status !== "complete") return;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      resolve(tab);
    };
    chrome.tabs.onUpdated.addListener(onUpdated);
  });
}

function waitForNextTabComplete(tabId, timeoutMs = PAGE_READY_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      reject(new Error("等待 ChatGPT 页面加载超时"));
    }, timeoutMs);
    const onUpdated = (updatedId, changeInfo, tab) => {
      if (updatedId !== tabId || changeInfo.status !== "complete") return;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      resolve(tab);
    };
    chrome.tabs.onUpdated.addListener(onUpdated);
  });
}

async function createExecutionTab(initialUrl) {
  let normalWindows = [];
  try {
    normalWindows = await chrome.windows.getAll({
      windowTypes: ["normal"],
      populate: false,
    });
  } catch (error) {
    debugLog("Navigation", "could not enumerate browser windows", {
      error: errorMessage(error),
    });
  }

  const existingWindow = normalWindows.find((window) =>
    Number.isInteger(window.id),
  );
  if (existingWindow && Number.isInteger(existingWindow.id)) {
    return chrome.tabs.create({
      windowId: existingWindow.id,
      url: CHATGPT_HOME,
      active: false,
    });
  }

  debugLog("Navigation", "no normal browser window; creating one", {
    initialUrl,
  });
  const createdWindow = await chrome.windows.create({
    url: initialUrl,
    focused: true,
  });
  const createdTab = createdWindow?.tabs?.find((tab) =>
    Number.isInteger(tab.id),
  );
  if (createdTab) return createdTab;
  if (Number.isInteger(createdWindow?.id)) {
    const tabs = await chrome.tabs.query({ windowId: createdWindow.id });
    const tab = tabs.find((entry) => Number.isInteger(entry.id));
    if (tab) return tab;
  }
  throw new Error("无法创建 ChatGPT 执行标签页");
}

async function ensureExecutionTab(initialUrl = CHATGPT_HOME) {
  const storedId = await getExecutionTabId();
  if (storedId !== null) {
    try {
      const tab = await chrome.tabs.get(storedId);
      if (isChatGptUrl(tab.url)) return tab;
    } catch {
      // The saved execution tab may have been closed by the user.
    }
    await clearExecutionTabId();
  }
  const tab = await createExecutionTab(initialUrl);
  if (!Number.isInteger(tab.id)) throw new Error("无法创建 ChatGPT 执行标签页");
  await saveExecutionTabId(tab.id);
  return tab;
}

async function navigateExecutionTab(url, forceReload = true) {
  const tab = await ensureExecutionTab(url);
  const tabId = tab.id;
  if (!Number.isInteger(tabId)) throw new Error("执行标签页无效");
  if (tab.url !== url) {
    const loaded = waitForNextTabComplete(tabId);
    await chrome.tabs.update(tabId, { url, active: false });
    await loaded;
  } else if (forceReload) {
    const loaded = waitForNextTabComplete(tabId);
    await chrome.tabs.reload(tabId);
    await loaded;
  } else {
    await waitForTabComplete(tabId);
  }
  debugLog("Navigation", "execution tab ready", {
    tabId,
    requestedUrl: url,
    actualUrl: (await chrome.tabs.get(tabId)).url || "",
    forceReload,
  });
  return tabId;
}

async function ensureContentReady(tabId) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, {
      type: "ainote-ping",
    });
    if (response?.ok) return;
  } catch {
    // Missing receiver is expected before the content scripts are injected.
  }
  await chrome.scripting.executeScript({
    target: { tabId },
    files: SCRIPT_FILES,
  });
  const response = await chrome.tabs.sendMessage(tabId, {
    type: "ainote-ping",
  });
  if (!response?.ok) throw new Error("ChatGPT 页面适配器未响应");
}

async function emitStage(stage, conversationMeta = {}) {
  if (!currentRun) throw new Error("没有正在执行的任务");
  const currentIndex = TASK_STAGES.indexOf(currentRun.stage || "claimed");
  const nextIndex = TASK_STAGES.indexOf(stage);
  if (nextIndex < 0) throw new Error(`未知任务阶段：${stage}`);
  if (nextIndex < currentIndex) {
    currentRun.conversationMeta = {
      ...currentRun.conversationMeta,
      ...conversationMeta,
    };
    return null;
  }
  currentRun.stage = stage;
  currentRun.conversationMeta = {
    ...currentRun.conversationMeta,
    ...conversationMeta,
  };
  const updated = await reportTaskEvent(currentRun.task.taskId, {
    requestId: requestId(),
    leaseId: currentRun.task.lease.leaseId,
    stage,
    ...conversationMeta,
  });
  if (updated?.status === "canceled") {
    throw Object.assign(new Error(updated.cancelReason || "任务已取消"), {
      code: "TASK_CANCELED",
      sendState:
        stage === "prompt_sent" ||
        stage === "waiting_response" ||
        stage === "extracting_result"
          ? "sent"
          : "not_sent",
    });
  }
  return updated;
}

function assertCurrentRunTask(taskId) {
  if (!currentRun || currentRun.task.taskId !== taskId) {
    throw Object.assign(new Error("任务执行上下文已失效"), {
      code: "TASK_STALE",
      sendState: "not_sent",
    });
  }
}

async function assertActive(taskId = currentRun?.task.taskId) {
  if (taskId) assertCurrentRunTask(taskId);
  if (!currentRun) throw new Error("任务已停止");
  await emitStage(
    currentRun.stage || "claimed",
    currentRun.conversationMeta || {},
  );
}

function startHeartbeat() {
  return setInterval(() => {
    void assertActive().catch((error) => {
      if (currentRun) currentRun.heartbeatError = error;
    });
  }, LEASE_HEARTBEAT_MS);
}

async function executeOpenConversation(task) {
  const url = task.existingConversationUrl;
  if (!isChatGptUrl(url) || !/\/c\/[^/]+/.test(new URL(url).pathname)) {
    throw Object.assign(new Error("已保存的 ChatGPT 对话链接不可用"), {
      code: "CONVERSATION_UNAVAILABLE",
      sendState: "not_sent",
    });
  }
  try {
    const normalWindows = await chrome.windows.getAll({
      windowTypes: ["normal"],
      populate: false,
    });
    const existingWindow = normalWindows.find((window) =>
      Number.isInteger(window.id),
    );
    if (existingWindow && Number.isInteger(existingWindow.id)) {
      await chrome.tabs.create({
        windowId: existingWindow.id,
        url,
        active: true,
      });
    } else {
      await chrome.windows.create({ url, focused: true });
    }
  } catch (error) {
    errorLog("Navigation", "could not open conversation tab", {
      taskId: task.taskId,
      url,
      error: errorMessage(error),
    });
    throw error;
  }
  await reportTaskResult(task.taskId, {
    requestId: requestId(),
    leaseId: task.lease.leaseId,
    resultMarkdown: "",
    resultSource: "dom",
    conversationId: task.existingConversationId,
    conversationUrl: url,
    conversationTitle: task.conversationTitle,
  });
}

async function runSummaryOnce(task, pdfBase64, forceReload) {
  debugLog("Task", "summary attempt started", {
    taskId: task.taskId,
    forceReload,
  });
  const targetUrl = task.existingConversationUrl || task.projectUrl;
  if (!isChatGptUrl(targetUrl)) {
    throw Object.assign(new Error("ChatGPT 项目或对话链接无效"), {
      code: task.existingConversationUrl
        ? "CONVERSATION_UNAVAILABLE"
        : "PROJECT_UNAVAILABLE",
      sendState: "not_sent",
    });
  }
  const tabId = await navigateExecutionTab(targetUrl, forceReload);
  currentRun.tabId = tabId;
  await ensureContentReady(tabId);
  const response = await chrome.tabs.sendMessage(tabId, {
    type: "ainote-run-summary",
    task,
    pdfBase64,
  });
  if (!response?.ok) {
    throw Object.assign(new Error(response?.error || "ChatGPT 页面操作失败"), {
      code: response?.code || "TARGET_PAGE_UNAVAILABLE",
      sendState: response?.sendState || "unknown",
      debugInfo: response?.debugInfo,
      conversationMeta: response?.conversationMeta || {},
    });
  }
  if (currentRun.heartbeatError) throw currentRun.heartbeatError;
  return response.result;
}

async function executeSummary(task) {
  const pdf = await fetchTaskPdf(task.taskId, task.lease.leaseId);
  await assertActive(task.taskId);
  const pdfBase64 = arrayBufferToBase64(pdf);
  try {
    const result = await runSummaryOnce(task, pdfBase64, true);
    const completed = await reportTaskResult(task.taskId, {
      requestId: requestId(),
      leaseId: task.lease.leaseId,
      resultMarkdown: result.markdown,
      resultSource: result.source,
      conversationId: result.conversationId,
      conversationUrl: result.conversationUrl,
      conversationTitle: result.conversationTitle,
    });
    if (completed?.status === "canceled") {
      throw Object.assign(new Error(completed.cancelReason || "任务已取消"), {
        code: "TASK_CANCELED",
        sendState: "sent",
      });
    }
    return;
  } catch (error) {
    if (error?.code === "TASK_CANCELED" || error?.code === "TASK_STALE") {
      throw error;
    }
    const sendState =
      error?.sendState ||
      (currentRun?.stage === "prompt_sent" ||
      currentRun?.stage === "waiting_response" ||
      currentRun?.stage === "extracting_result"
        ? "sent"
        : "not_sent");
    debugLog("Task", "summary failed without retry", {
      taskId: task.taskId,
      error: errorMessage(error),
      code: error?.code,
      sendState,
      debugInfo: error?.debugInfo,
    });
    throw Object.assign(
      error instanceof Error ? error : new Error(String(error)),
      {
        sendState,
        code: error?.code,
        debugInfo: error?.debugInfo,
        conversationMeta: error?.conversationMeta,
      },
    );
  }
}

async function executeTask(task) {
  if (!task?.lease?.leaseId) throw new Error("任务缺少租约");
  currentRun = {
    task,
    stage: "claimed",
    tabId: null,
    heartbeatError: null,
    conversationMeta: {},
  };
  const heartbeat = startHeartbeat();
  try {
    await emitStage("claimed");
    if (task.actionType === "open_conversation")
      await executeOpenConversation(task);
    else await executeSummary(task);
  } catch (error) {
    if (error?.code === "TASK_CANCELED") {
      debugLog("Task", "task canceled by Zotero", {
        taskId: task.taskId,
        stage: currentRun.stage,
      });
      return;
    }
    const sendState =
      error?.sendState ||
      (currentRun.stage === "prompt_sent" ||
      currentRun.stage === "waiting_response" ||
      currentRun.stage === "extracting_result"
        ? "sent"
        : "not_sent");
    const meta = error?.conversationMeta || currentRun.conversationMeta || {};
    try {
      await reportTaskFailure(task.taskId, {
        requestId: requestId(),
        leaseId: task.lease.leaseId,
        errorCode: normalizeFailureCode(error?.code, sendState),
        errorMessage: errorMessage(error),
        sendState,
        debugMessage: error?.debugInfo
          ? JSON.stringify(error.debugInfo)
          : undefined,
        ...meta,
      });
    } catch (reportError) {
      errorLog("Task", "could not report failure", {
        taskId: task.taskId,
        error: errorMessage(reportError),
      });
    }
  } finally {
    clearInterval(heartbeat);
    currentRun = null;
  }
}

async function workerLoop() {
  if (workerRunning || !(await getPairingToken())) return;
  workerRunning = true;
  try {
    while (await getPairingToken()) {
      const response = await claimNextTask(TASK_CLAIM_WAIT_MS);
      if (response?.task) await executeTask(response.task);
    }
  } catch (error) {
    errorLog("Worker", "worker loop paused", { error: errorMessage(error) });
  } finally {
    workerRunning = false;
  }
}

async function startPairing() {
  const existing = await reuseExistingPairing({
    getToken: getPairingToken,
    getSession,
    clearToken: clearPairingToken,
  });
  if (existing) {
    void workerLoop();
    return existing;
  }

  const installId = await getInstallId();
  const created = await createPairingRequest({
    installId,
    extensionVersion: chrome.runtime.getManifest().version,
    protocolVersion: WEB_SUMMARY_PROTOCOL_VERSION,
    browser: detectBrowser(),
    capabilities: WEB_SUMMARY_CAPABILITIES,
  });
  const expiresAt = Date.parse(created.request.expiresAt);
  while (Date.now() < expiresAt) {
    const status = await getPairingStatus(created.request.requestId);
    if (status.request.status === "approved" && status.token) {
      await savePairingToken(status.token);
      const session = await getSession();
      void workerLoop();
      return { session, alreadyPaired: false };
    }
    if (["rejected", "expired"].includes(status.request.status)) {
      throw new Error(
        status.request.rejectionReason || `配对${status.request.status}`,
      );
    }
    await sleep(PAIRING_POLL_MS);
  }
  throw new Error("配对请求已超时");
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "ainote-debug-log") {
    const details = {
      ...(message.details && typeof message.details === "object"
        ? message.details
        : { value: message.details }),
      source: "content",
    };
    if (message.level === "debug") {
      debugLog(
        String(message.scope || "Content"),
        String(message.message || ""),
        details,
      );
    } else {
      errorLog(
        String(message.scope || "Content"),
        String(message.message || ""),
        details,
      );
    }
    return false;
  }
  if (message?.type === "ainote-start-pairing") {
    void startPairing()
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) =>
        sendResponse({ ok: false, error: errorMessage(error) }),
      );
    return true;
  }
  if (message?.type === "ainote-test-session") {
    void getSession()
      .then((session) =>
        sendResponse({
          ok: true,
          summary: `Protocol ${session.protocolVersion} · ${session.executor.browser}`,
        }),
      )
      .catch((error) =>
        sendResponse({ ok: false, error: errorMessage(error) }),
      );
    return true;
  }
  if (message?.type === "ainote-task-stage") {
    void (async () => {
      assertCurrentRunTask(message.taskId);
      if (currentRun)
        currentRun.conversationMeta =
          message.conversationMeta || currentRun.conversationMeta;
      return emitStage(message.stage, message.conversationMeta);
    })()
      .then(() => sendResponse({ ok: true }))
      .catch((error) =>
        sendResponse({
          ok: false,
          code: error?.code,
          error: errorMessage(error),
        }),
      );
    return true;
  }
  if (message?.type === "ainote-task-assert-active") {
    void assertActive(message.taskId)
      .then(() => sendResponse({ ok: true }))
      .catch((error) =>
        sendResponse({
          ok: false,
          code: error?.code,
          error: errorMessage(error),
        }),
      );
    return true;
  }
  return false;
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (currentRun?.tabId !== tabId) return;
  debugLog("Navigation", "execution tab updated", {
    tabId,
    status: changeInfo.status || "",
    url: tab.url || "",
    title: tab.title || "",
  });
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void getExecutionTabId().then(async (storedId) => {
    if (storedId === tabId) await clearExecutionTabId();
  });
  if (currentRun?.tabId === tabId) {
    currentRun.heartbeatError = Object.assign(
      new Error("ChatGPT 执行标签页被关闭"),
      {
        code: "TARGET_PAGE_UNAVAILABLE",
        sendState:
          currentRun.stage === "prompt_sent" ||
          currentRun.stage === "waiting_response" ||
          currentRun.stage === "extracting_result"
            ? "unknown"
            : "not_sent",
      },
    );
  }
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === CLAIM_WAKE_ALARM_NAME) void workerLoop();
});

chrome.action.onClicked.addListener(
  () => void chrome.runtime.openOptionsPage(),
);

async function bootstrap() {
  const settings = await getSettings();
  setLogLevel(settings.logLevel);
  await chrome.alarms.create(CLAIM_WAKE_ALARM_NAME, {
    periodInMinutes: CLAIM_WAKE_ALARM_PERIOD_MINUTES,
  });
  void workerLoop();
}

chrome.runtime.onInstalled.addListener(() => void bootstrap());
chrome.runtime.onStartup.addListener(() => void bootstrap());
void bootstrap();
