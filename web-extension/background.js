// @ts-check

import {
  getTask,
  claimNextTask,
  fetchTaskPdf,
  healthCheck,
  reportTaskFailure,
  reportHandshake,
  reportTaskResult,
  reportTaskStatus,
} from "./bridge-client.js";
import {
  WEB_SUMMARY_CAPABILITIES,
  WEB_SUMMARY_PROTOCOL_VERSION,
  WEB_SUMMARY_REQUIRED_PERMISSIONS,
  WEB_SUMMARY_TASK_CONTRACT_VERSION,
} from "./compat.js";
import { debugLog, errorLog, getLogLevel, setLogLevel } from "./debug.js";
import { getSettings } from "./storage.js";

const CHATGPT_URL = "https://chatgpt.com/";
const CHATGPT_URL_PREFIXES = [
  "https://chatgpt.com/",
  "https://chat.openai.com/",
];
let pollingTimer = null;
let runningTaskId = "";
let runningTaskTabId = 0;
const pendingTaskResolvers = new Map();
let workerLoopRunning = false;
let workerLoopStopToken = 0;
const TASK_CLAIM_WAIT_MS = 8000;
const CLAIM_FAILURE_BACKOFF_MS = 1500;
const CANCEL_WATCH_INTERVAL_MS = 800;
const CHATGPT_TAB_READY_TIMEOUT_MS = 60000;
const CONTENT_SCRIPT_READY_TIMEOUT_MS = 20000;
const HANDSHAKE_INTERVAL_MS = 45000;
const CLAIM_WAKE_ALARM_NAME = "ainote-claim-wake";
const CLAIM_WAKE_ALARM_PERIOD_MINUTES = 0.5;
const WORKER_INSTANCE_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
let lastHandshakeAtMs = 0;
let lastBridgeTrafficAtMs = 0;
let activeClaimPromise = null;
let activeCancelWatcherToken = 0;
let bootstrapPromise = null;
const taskPorts = new Map();
const cancelPendingTasks = new Map();

async function syncLogLevelFromSettings() {
  try {
    const settings = await getSettings();
    setLogLevel(settings.logLevel);
  } catch {
    setLogLevel("error");
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 长时间等待时定期调用扩展 API 以防止 Service Worker 被终止 */
async function safeSleep(ms) {
  const CHUNK_MS = 8000;
  if (ms <= CHUNK_MS) {
    return sleep(ms);
  }
  const start = Date.now();
  while (Date.now() - start < ms) {
    const remaining = ms - (Date.now() - start);
    await sleep(Math.min(CHUNK_MS, remaining));
    // MV3: 扩展 API 调用可重置 30 秒空闲终止计时器
    try { await chrome.storage.local.get("__sw_keepalive__"); } catch {}
  }
}

async function withTimeout(promise, timeoutMs, fallbackMessage) {
  let timer = null;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(fallbackMessage || "Operation timeout")),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function hasNamedPermissions(permissions) {
  try {
    return await chrome.permissions.contains({ permissions });
  } catch {
    return false;
  }
}

async function hasHostPermission(originPattern) {
  try {
    return await chrome.permissions.contains({ origins: [originPattern] });
  } catch {
    return false;
  }
}

async function detectEnvironmentSnapshot() {
  let targetReachable = false;
  let chatgptTabReady = false;
  let contentScriptReady = false;
  try {
    const tabs = await chrome.tabs.query({
      url: ["https://chatgpt.com/*", "https://chat.openai.com/*"],
    });
    targetReachable = tabs.length > 0;
    const tab = tabs.find((entry) => !!entry.id);
    if (tab?.id) {
      chatgptTabReady = isChatGPTUrlCandidate(String(tab.url || tab.pendingUrl || ""));
      try {
        const ping = await withTimeout(
          pingContentScript(tab.id),
          1500,
          "ping timeout",
        );
        contentScriptReady = !!ping?.ok;
      } catch {
        contentScriptReady = false;
      }
    }
  } catch {
    // ignore
  }
  return {
    targetReachable,
    contentScriptReady,
    chatgptTabReady,
  };
}

async function buildPermissionSnapshot() {
  const namedPermissionsGranted = await hasNamedPermissions([
    "storage",
    "tabs",
    "scripting",
  ]);
  const localhostGranted = await hasHostPermission("http://127.0.0.1/*");
  const chatgptGranted = await hasHostPermission("https://chatgpt.com/*");
  const chatOpenAiGranted = await hasHostPermission("https://chat.openai.com/*");

  return WEB_SUMMARY_REQUIRED_PERMISSIONS.map((permission) => {
    if (permission === "host:http://127.0.0.1/*") {
      return { permission, granted: localhostGranted };
    }
    if (permission === "host:https://chatgpt.com/*") {
      return { permission, granted: chatgptGranted || chatOpenAiGranted };
    }
    return { permission, granted: namedPermissionsGranted };
  });
}

function markBridgeActivity() {
  lastBridgeTrafficAtMs = Date.now();
}

async function sendCompatibilityHeartbeat(reason, force = false) {
  const now = Date.now();
  if (
    !force &&
    now - lastHandshakeAtMs < HANDSHAKE_INTERVAL_MS &&
    now - lastBridgeTrafficAtMs < HANDSHAKE_INTERVAL_MS
  ) {
    return;
  }
  try {
    await healthCheck();
    markBridgeActivity();
    const permissions = await buildPermissionSnapshot();
    const environment = await detectEnvironmentSnapshot();
    await reportHandshake({
      extensionVersion: chrome.runtime.getManifest().version || "0.0.0",
      protocolVersion: WEB_SUMMARY_PROTOCOL_VERSION,
      taskContractVersion: WEB_SUMMARY_TASK_CONTRACT_VERSION,
      capabilities: [...WEB_SUMMARY_CAPABILITIES],
      permissions,
      environment,
      heartbeatAt: new Date().toISOString(),
    });
    markBridgeActivity();
    lastHandshakeAtMs = now;
  } catch (error) {
    errorLog("Background", `heartbeat failed (${reason})`, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function ensureBackgroundActive(reason = "unknown") {
  debugLog("Background", "ensureBackgroundActive called", {
    reason,
    workerInstanceId: WORKER_INSTANCE_ID,
    hasBootstrapPromise: !!bootstrapPromise,
    workerLoopRunning,
    workerLoopStopToken,
  });
  if (!bootstrapPromise) {
    bootstrapPromise = (async () => {
      try {
        debugLog("Background", "ensureBackgroundActive bootstrap start", {
          reason,
          workerInstanceId: WORKER_INSTANCE_ID,
        });
        await schedulePolling(reason);
      } finally {
        debugLog("Background", "ensureBackgroundActive bootstrap end", {
          reason,
          workerInstanceId: WORKER_INSTANCE_ID,
        });
        bootstrapPromise = null;
      }
    })();
  }
  return bootstrapPromise;
}

function scheduleWakeAlarm() {
  try {
    chrome.alarms.create(CLAIM_WAKE_ALARM_NAME, {
      periodInMinutes: CLAIM_WAKE_ALARM_PERIOD_MINUTES,
    });
  } catch (error) {
    errorLog("Background", "Failed to schedule wake alarm", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function clearTaskPort(taskId, port = null) {
  const current = taskPorts.get(taskId);
  if (!current) {
    return;
  }
  if (port && current.port !== port) {
    return;
  }
  taskPorts.delete(taskId);
}

function pushTaskCancelToContent(taskId, payload) {
  const binding = taskPorts.get(taskId);
  if (binding?.port) {
    try {
      binding.port.postMessage({
        type: "task-cancel-requested",
        taskId,
        reason: payload?.reason || "已停止当前条目的AI总结",
      });
      cancelPendingTasks.delete(taskId);
      return true;
    } catch (error) {
      errorLog("Background", "Failed to push cancel to content", {
        taskId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  cancelPendingTasks.set(taskId, {
    reason: payload?.reason || "已停止当前条目的AI总结",
    taskId,
  });
  return false;
}

async function getLatestTaskState(taskId) {
  try {
    const task = await getTask(taskId);
    markBridgeActivity();
    return task;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || "");
    if (message.includes("Task not found") || message.includes("TASK_NOT_FOUND")) {
      return null;
    }
    throw error;
  }
}

async function shortCircuitCanceledTask(task) {
  const latestTask = await getLatestTaskState(task.taskId);
  if (!latestTask) {
    return true;
  }
  if (latestTask.status === "canceled") {
    return true;
  }
  if (!latestTask.cancelRequestedAt) {
    return false;
  }
  try {
    await reportTaskStatus(task.taskId, {
      status: "canceled",
      errorCode: latestTask.errorCode || "INTERNAL_ERROR",
      errorMessage:
        latestTask.cancelReason ||
        latestTask.errorMessage ||
        "已停止当前条目的AI总结",
      conversationId: latestTask.conversationMeta?.conversationId,
      conversationUrl: latestTask.conversationMeta?.conversationUrl,
      conversationTitle: latestTask.conversationMeta?.conversationTitle,
      folderName: latestTask.conversationMeta?.folderName,
      folderResolved: latestTask.conversationMeta?.folderResolved,
    });
    markBridgeActivity();
  } catch (error) {
    errorLog("Background", "Failed to finalize canceled task before launch", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return true;
}

async function watchRunningTaskCancellation(taskId) {
  const watcherToken = ++activeCancelWatcherToken;
  while (
    watcherToken === activeCancelWatcherToken &&
    runningTaskId === taskId
  ) {
    try {
      const task = await getLatestTaskState(taskId);
      if (!task) {
        break;
      }
      if (task.status === "canceled" || task.cancelRequestedAt) {
        pushTaskCancelToContent(taskId, {
          reason:
            task.cancelReason ||
            task.errorMessage ||
            "已停止当前条目的AI总结",
        });
        break;
      }
      if (["succeeded", "failed"].includes(task.status)) {
        break;
      }
    } catch (error) {
      errorLog("Background", "cancel watcher failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    await sleep(CANCEL_WATCH_INTERVAL_MS);
  }
}

function isChatGPTUrlCandidate(value) {
  const url = String(value || "");
  return CHATGPT_URL_PREFIXES.some((prefix) => url.startsWith(prefix));
}

async function waitForChatGPTTabReady(tabId, timeoutMs = CHATGPT_TAB_READY_TIMEOUT_MS) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const tab = await chrome.tabs.get(tabId);
    const url = tab.url || "";
    debugLog("Background", "waitForChatGPTTabReady tick", {
      tabId,
      url,
      pendingUrl: tab.pendingUrl || "",
      status: tab.status || "",
    });
    if (isChatGPTUrlCandidate(url)) {
      debugLog("Background", "waitForChatGPTTabReady success", {
        tabId,
        url,
      });
      return tab;
    }
    await sleep(300);
  }
  throw new Error("ChatGPT 标签页长时间未进入目标页面");
}

async function pingContentScript(tabId) {
  return sendTabMessage(
    tabId,
    { type: "ainote-ping", logLevel: getLogLevel() },
    1,
  );
}

async function waitForContentScriptReady(
  tabId,
  timeoutMs = CONTENT_SCRIPT_READY_TIMEOUT_MS,
) {
  const startedAt = Date.now();
  let lastError = null;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await pingContentScript(tabId);
      debugLog("Background", "waitForContentScriptReady ping", {
        tabId,
        response,
      });
      if (response?.ok) {
        return;
      }
      lastError = new Error(response?.error || "Content script 未返回 ready");
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
    await sleep(350);
  }
  throw lastError || new Error("Content script 未在预期时间内就绪");
}

function isTransientPortError(error) {
  const message = error instanceof Error ? error.message : String(error || "");
  return (
    message.includes("The message port closed before a response was received") ||
    message.includes("Receiving end does not exist") ||
    message.includes("Could not establish connection")
  );
}

async function waitForStableContentScript(
  tabId,
  timeoutMs = CONTENT_SCRIPT_READY_TIMEOUT_MS,
) {
  const startedAt = Date.now();
  let lastHref = "";
  let stableCount = 0;
  let lastError = null;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await pingContentScript(tabId);
      const href = String(response?.href || "");
      const readyState = String(response?.readyState || "");
      if (
        response?.ok &&
        isChatGPTUrlCandidate(href) &&
        ["interactive", "complete"].includes(readyState)
      ) {
        stableCount = href === lastHref ? stableCount + 1 : 1;
        lastHref = href;
        if (stableCount >= 2) {
          return response;
        }
      } else {
        stableCount = 0;
        lastHref = href;
      }
    } catch (error) {
      stableCount = 0;
      lastHref = "";
      lastError = error instanceof Error ? error : new Error(String(error));
    }
    await sleep(400);
  }

  throw lastError || new Error("ChatGPT 页面尚未稳定，无法执行任务");
}

async function ensureContentScript(tabId) {
  debugLog("Background", "ensureContentScript start", { tabId });
  // 快速验证：标签页应该已在 ensureChatGPTTab 中就绪，5s 内未就绪视为异常
  try {
    await waitForChatGPTTabReady(tabId, 5000);
  } catch {
    throw new Error(
      "ChatGPT 标签页在内容脚本注入前状态异常，请确认页面已正常加载。若持续出现，请重启 Chrome 和扩展后再试。",
    );
  }

  // 给 manifest 的 document_idle 注入足够时间（冷启动页面加载慢，延长到 10s）
  try {
    await waitForStableContentScript(tabId, 10000);
    debugLog("Background", "ensureContentScript stable without reinject", { tabId });
    return;
  } catch {
    debugLog("Background", "ensureContentScript needs reinject", { tabId });
  }

  // 冷启动时扩展刚初始化，tab 的渲染进程可能尚未就绪，延长注入重试窗口到 30s
  const COLD_START_INJECT_TIMEOUT = 30000;
  const startedAt = Date.now();
  let lastError = null;
  let injectAttempt = 0;
  while (Date.now() - startedAt < COLD_START_INJECT_TIMEOUT) {
    injectAttempt += 1;
    try {
      debugLog("Background", "executeScript attempt", {
        tabId,
        injectAttempt,
      });
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ["content.js"],
        injectImmediately: true,
      });
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      errorLog("Background", "executeScript failed", {
        error: lastError?.message || "",
      });
    }
    try {
      await waitForContentScriptReady(tabId, 3000);
      debugLog("Background", "ensureContentScript ready after inject", {
        tabId,
        injectAttempt,
      });
      return;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
    await safeSleep(1000);
  }
  throw lastError || new Error("Content script 注入后仍未就绪");
}

async function sendTabMessage(tabId, payload, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await new Promise((resolve, reject) => {
        chrome.tabs.sendMessage(tabId, payload, (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          resolve(response);
        });
      });
    } catch (error) {
      if (attempt < retries) {
        errorLog("Background", `sendTabMessage attempt ${attempt} failed, retrying`, {
          error: error instanceof Error ? error.message : String(error),
        });
        await sleep(1000);
      } else {
        throw error;
      }
    }
  }
}

async function dispatchTaskMessage(tabId, payload, retries = 3) {
  let lastError = null;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      return await sendTabMessage(tabId, payload, 1);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt >= retries || !isTransientPortError(lastError)) {
        throw lastError;
      }
      errorLog("Background", `Task dispatch attempt ${attempt} hit transient port error`, {
        error: lastError?.message || String(lastError),
      });
      await sleep(700);
      await ensureContentScript(tabId);
    }
  }
  throw lastError || new Error("Task dispatch failed");
}

async function ensureChatGPTTab(targetUrl) {
  debugLog("Background", "ensureChatGPTTab start", { targetUrl });
  // 先尝试按 URL 模式查找已加载的标签页
  let all = await chrome.tabs.query({
    url: ["https://chatgpt.com/*", "https://chat.openai.com/*"],
  });
  // 优先使用最新创建的标签页（launchChatGPTSurface 刚打开的），避免拿到旧的
  // chrome.tabs.query 通常按创建时间排序，reverse 后取最新的
  let matching = [...all].reverse().find((t) => {
    const tabUrl = String(t.url || t.pendingUrl || "");
    return tabUrl.startsWith(targetUrl);
  });

  // 冷启动时：标签页可能还在加载中（url 尚未匹配），通过 pendingUrl 再找一次
  if (!matching) {
    all = await chrome.tabs.query({});
    matching = [...all].reverse().find((t) => {
      const pending = String(t.pendingUrl || "");
      return isChatGPTUrlCandidate(pending) && pending.startsWith(targetUrl);
    });
  }

  if (matching?.id) {
    // 如果标签页当前 URL 不是 targetUrl，导航到 targetUrl 确保内容脚本运行在正确页面
    const currentUrl = String(matching.url || matching.pendingUrl || "");
    if (currentUrl !== targetUrl) {
      debugLog("Background", "ensureChatGPTTab reuse existing with navigate", {
        tabId: matching.id,
        currentUrl,
        targetUrl,
      });
      await chrome.tabs.update(matching.id, { url: targetUrl, active: true });
    } else {
      debugLog("Background", "ensureChatGPTTab reuse existing active", {
        tabId: matching.id,
        currentUrl,
      });
      await chrome.tabs.update(matching.id, { active: true });
    }
    await waitForChatGPTTabReady(matching.id);
    return matching.id;
  }
  // 没找到匹配的标签页，创建新的
  const created = await chrome.tabs.create({ url: targetUrl, active: true });
  if (!created.id) {
    throw new Error("Failed to create ChatGPT tab");
  }
  debugLog("Background", "ensureChatGPTTab created", {
    tabId: created.id,
    targetUrl,
  });
  await waitForChatGPTTabReady(created.id);
  return created.id;
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function waitForContentTask(taskId, timeoutMs = 30 * 60 * 1000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingTaskResolvers.delete(taskId);
      reject(new Error("Content script task timed out"));
    }, timeoutMs);
    pendingTaskResolvers.set(taskId, {
      resolve: (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      reject: (error) => {
        clearTimeout(timeout);
        reject(error);
      },
    });
  });
}

function settleContentTask(taskId, error) {
  const resolver = pendingTaskResolvers.get(taskId);
  if (!resolver) {
    return;
  }
  pendingTaskResolvers.delete(taskId);
  if (error) {
    resolver.reject(error);
  } else {
    resolver.resolve();
  }
}

async function runSummarizeTask(task) {
  if (await shortCircuitCanceledTask(task)) {
    return;
  }
  debugLog("Background", "runSummarizeTask start", {
    workerInstanceId: WORKER_INSTANCE_ID,
    taskId: task.taskId,
    projectUrl: task.projectUrl || CHATGPT_URL,
    existingConversationUrl: task.existingConversationUrl || "",
  });
  // task 在 claim 时已自动设为 opening_chat 状态，无需再重复上报
  // 此处仅更新 debugMessage 以便调试
  const targetUrl = task.projectUrl || CHATGPT_URL;
  let tabId = 0;
  try {
    debugLog("Background", "runSummarizeTask report opening_chat begin", {
      workerInstanceId: WORKER_INSTANCE_ID,
      taskId: task.taskId,
      targetUrl,
    });
    await withTimeout(
      reportTaskStatus(task.taskId, {
        status: "opening_chat",
        debugMessage: `开始打开目标页面: ${targetUrl}`,
      }),
      4000,
      "report opening_chat start timeout",
    ).catch(() => {});
    debugLog("Background", "runSummarizeTask ensureChatGPTTab begin", {
      workerInstanceId: WORKER_INSTANCE_ID,
      taskId: task.taskId,
      targetUrl,
    });
    tabId = await ensureChatGPTTab(targetUrl);
    debugLog("Background", "runSummarizeTask ensureChatGPTTab returned", {
      workerInstanceId: WORKER_INSTANCE_ID,
      taskId: task.taskId,
      tabId,
    });
    await withTimeout(
      reportTaskStatus(task.taskId, {
        status: "opening_chat",
        debugMessage: `已定位 ChatGPT 标签页 tabId=${tabId}，准备检测页面脚本`,
      }),
      4000,
      "report tab-selected timeout",
    ).catch(() => {});
  } catch (error) {
    await reportTaskFailure(task.taskId, {
      errorCode: "INTERNAL_ERROR",
      errorMessage: `打开 ChatGPT 标签页失败: ${error instanceof Error ? error.message : String(error)}`,
    }).catch(() => {});
    throw error;
  }
  await sendCompatibilityHeartbeat("before-summarize-task", true);
  runningTaskTabId = tabId;
  await withTimeout(
    reportTaskStatus(task.taskId, {
      status: "opening_chat",
      debugMessage: `已定位 ChatGPT 标签页 tabId=${tabId}，等待页面脚本就绪`,
    }),
    4000,
    "report tab-selected timeout",
  ).catch(() => {});
  try {
    debugLog("Background", "runSummarizeTask ensureContentScript begin", {
      workerInstanceId: WORKER_INSTANCE_ID,
      taskId: task.taskId,
      tabId,
    });
    await ensureContentScript(tabId);
    debugLog("Background", "runSummarizeTask ensureContentScript returned", {
      workerInstanceId: WORKER_INSTANCE_ID,
      taskId: task.taskId,
      tabId,
    });
    await withTimeout(
      reportTaskStatus(task.taskId, {
        status: "opening_chat",
        debugMessage: `页面脚本已就绪，准备下发任务到 tabId=${tabId}`,
      }),
      4000,
      "report content-ready timeout",
    ).catch(() => {});
  } catch (error) {
    await reportTaskFailure(task.taskId, {
      errorCode: "INTERNAL_ERROR",
      errorMessage: `ChatGPT 页面脚本未就绪: ${error instanceof Error ? error.message : String(error)}`,
    }).catch(() => {});
    throw error;
  }
  const completion = waitForContentTask(task.taskId);
  let response;
  try {
    debugLog("Background", "runSummarizeTask dispatchTaskMessage begin", {
      workerInstanceId: WORKER_INSTANCE_ID,
      taskId: task.taskId,
      tabId,
    });
    response = await dispatchTaskMessage(tabId, {
      type: "ainote-run-summarize-task",
      task,
      logLevel: getLogLevel(),
      autoSend: true,
      projectUrl: task.projectUrl || "",
      chatgptMode: task.chatgptMode || "thinking",
    });
    debugLog("Background", "runSummarizeTask dispatchTaskMessage returned", {
      workerInstanceId: WORKER_INSTANCE_ID,
      taskId: task.taskId,
      responseOk: !!response?.ok,
      response,
    });
  } catch (error) {
    await reportTaskFailure(task.taskId, {
      errorCode: "INTERNAL_ERROR",
      errorMessage: `向页面脚本派发任务失败: ${error instanceof Error ? error.message : String(error)}`,
    }).catch(() => {});
    throw error;
  }
  if (!response?.ok) {
    pendingTaskResolvers.delete(task.taskId);
    const error = new Error(response?.error || "Content script task failed");
    await reportTaskFailure(task.taskId, {
      errorCode: "INTERNAL_ERROR",
      errorMessage: `页面脚本拒绝执行任务: ${error.message}`,
    }).catch(() => {});
    throw error;
  }
  debugLog("Background", "runSummarizeTask awaiting completion", {
    workerInstanceId: WORKER_INSTANCE_ID,
    taskId: task.taskId,
  });
  await completion;
  debugLog("Background", "runSummarizeTask completion resolved", {
    workerInstanceId: WORKER_INSTANCE_ID,
    taskId: task.taskId,
  });
}

async function runOpenConversationTask(task) {
  if (await shortCircuitCanceledTask(task)) {
    return;
  }
  debugLog("Background", "runOpenConversationTask start", {
    taskId: task.taskId,
    url: task.existingConversationUrl || CHATGPT_URL,
  });
  await sendCompatibilityHeartbeat("before-open-conversation-task", true);
  await withTimeout(
    reportTaskStatus(task.taskId, {
      status: "opening_chat",
      debugMessage: "扩展已领取任务，准备打开现有对话",
    }),
    4000,
    "report opening_chat timeout",
  ).catch((error) => {
    errorLog("Background", "report opening_chat failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  });
  const url = task.existingConversationUrl || CHATGPT_URL;
  let tabId = 0;
  try {
    tabId = await ensureChatGPTTab(url);
  } catch (error) {
    await reportTaskFailure(task.taskId, {
      errorCode: "INTERNAL_ERROR",
      errorMessage: `打开历史对话页面失败: ${error instanceof Error ? error.message : String(error)}`,
    }).catch(() => {});
    throw error;
  }
  runningTaskTabId = tabId;
  await withTimeout(
    reportTaskStatus(task.taskId, {
      status: "opening_chat",
      debugMessage: `已定位现有对话标签页 tabId=${tabId}，等待页面脚本就绪`,
    }),
    4000,
    "report tab-selected timeout",
  ).catch(() => {});
  try {
    await ensureContentScript(tabId);
    await withTimeout(
      reportTaskStatus(task.taskId, {
        status: "opening_chat",
        debugMessage: `历史对话页面脚本已就绪，准备下发任务到 tabId=${tabId}`,
      }),
      4000,
      "report content-ready timeout",
    ).catch(() => {});
  } catch (error) {
    await reportTaskFailure(task.taskId, {
      errorCode: "INTERNAL_ERROR",
      errorMessage: `历史对话页面脚本未就绪: ${error instanceof Error ? error.message : String(error)}`,
    }).catch(() => {});
    throw error;
  }
  const completion = waitForContentTask(task.taskId);
  let response;
  try {
    response = await dispatchTaskMessage(tabId, {
      type: "ainote-open-conversation-task",
      task,
      logLevel: getLogLevel(),
    });
  } catch (error) {
    await reportTaskFailure(task.taskId, {
      errorCode: "INTERNAL_ERROR",
      errorMessage: `向历史对话页面派发任务失败: ${error instanceof Error ? error.message : String(error)}`,
    }).catch(() => {});
    throw error;
  }
  if (!response?.ok) {
    pendingTaskResolvers.delete(task.taskId);
    const error = new Error(response?.error || "Open conversation failed");
    await reportTaskFailure(task.taskId, {
      errorCode: "INTERNAL_ERROR",
      errorMessage: `历史对话页面拒绝执行任务: ${error.message}`,
    }).catch(() => {});
    throw error;
  }
  await completion;
}

async function claimNextTaskWithLongPoll(waitMs = TASK_CLAIM_WAIT_MS) {
  if (activeClaimPromise) {
    return activeClaimPromise;
  }
  activeClaimPromise = claimNextTask(waitMs)
    .then((result) => {
      markBridgeActivity();
      return result;
    })
    .finally(() => {
      activeClaimPromise = null;
    });
  return activeClaimPromise;
}

async function processNextTask(stopToken) {
  debugLog("Background", "processNextTask enter", {
    workerInstanceId: WORKER_INSTANCE_ID,
    stopToken,
    workerLoopStopToken,
    runningTaskId,
  });
  if (runningTaskId) {
    return "busy";
  }

  await sendCompatibilityHeartbeat("poll-loop");

  let data;
  try {
    data = await claimNextTaskWithLongPoll(TASK_CLAIM_WAIT_MS);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || "");
    if (message.includes("/api/ext/tasks/next") && message.includes("Failed to fetch")) {
      debugLog("Background", "claimNextTask long-poll interrupted", {
        waitMs: TASK_CLAIM_WAIT_MS,
        error: message,
      });
      return "idle";
    }
    throw error;
  }
  if (stopToken !== workerLoopStopToken) {
    return "stale";
  }
  if (runningTaskId) {
    return "busy";
  }
  const task = data?.task;
  if (!task) {
    return "idle";
  }
  debugLog("Background", "processNextTask claimed task", {
    workerInstanceId: WORKER_INSTANCE_ID,
    taskId: task.taskId,
    status: task.status,
    actionType: task.actionType,
  });

  debugLog("Background", "processNextTask set running task", {
    workerInstanceId: WORKER_INSTANCE_ID,
    taskId: task.taskId,
  });
  runningTaskId = task.taskId;
  runningTaskTabId = 0;
  void watchRunningTaskCancellation(task.taskId);
  try {
    debugLog("Background", "processNextTask before task runner", {
      workerInstanceId: WORKER_INSTANCE_ID,
      taskId: task.taskId,
      actionType: task.actionType,
    });
    if (task.actionType === "open_conversation") {
      await runOpenConversationTask(task);
    } else {
      await runSummarizeTask(task);
    }
    debugLog("Background", "processNextTask task runner returned", {
      workerInstanceId: WORKER_INSTANCE_ID,
      taskId: task.taskId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    errorLog("Background", "Task failed", {
      taskId: task.taskId,
      error: message,
    });
    try {
      await reportTaskFailure(task.taskId, {
        errorCode: "INTERNAL_ERROR",
        errorMessage: message,
      });
    } catch (reportError) {
      errorLog(
        "Background",
        "Failed to report task failure",
        {
          taskId: task.taskId,
          error:
            reportError instanceof Error
              ? reportError.message
              : String(reportError),
        },
      );
    }
  } finally {
    debugLog("Background", "processNextTask finally cleanup", {
      workerInstanceId: WORKER_INSTANCE_ID,
      taskId: task.taskId,
    });
    activeCancelWatcherToken += 1;
    clearTaskPort(task.taskId);
    cancelPendingTasks.delete(task.taskId);
    runningTaskId = "";
    runningTaskTabId = 0;
  }
  return "task";
}

async function handleRunningTaskTabClosed(closedTabId) {
  if (!runningTaskId || !runningTaskTabId || closedTabId !== runningTaskTabId) {
    return;
  }
  try {
    const task = await getTask(runningTaskId);
    if (!task) return;

    const earlyStages = new Set([
      "claimed",
      "opening_chat",
      "creating_conversation",
      "downloading_pdf",
      "awaiting_user_send",
    ]);

    if (earlyStages.has(task.status)) {
      await reportTaskFailure(task.taskId, {
        errorCode: "INTERNAL_ERROR",
        errorMessage: "网页在开始总结前被关闭，任务已停止。请重新发起总结。",
      });
      settleContentTask(
        task.taskId,
        new Error("网页在开始总结前被关闭，任务已停止。请重新发起总结。"),
      );
      return;
    }

    if (task.status === "running") {
      const reopenUrl = task.conversationMeta?.conversationUrl || task.existingConversationUrl || "";
      if (!reopenUrl || !/\/c\//.test(reopenUrl)) {
        await reportTaskFailure(task.taskId, {
          errorCode: "INTERNAL_ERROR",
          errorMessage:
            "网页已关闭且尚未拿到对话链接，无法恢复。请重新发起总结。",
        });
        settleContentTask(
          task.taskId,
          new Error("网页已关闭且尚未拿到对话链接，无法恢复。请重新发起总结。"),
        );
        return;
      }
      const tabId = await ensureChatGPTTab(reopenUrl);
      runningTaskTabId = tabId;
      await ensureContentScript(tabId);
      const response = await dispatchTaskMessage(tabId, {
        type: "ainote-open-conversation-task",
        task: {
          ...task,
          existingConversationId: task.conversationMeta?.conversationId || task.existingConversationId,
          existingConversationUrl: task.conversationMeta?.conversationUrl || task.existingConversationUrl,
        },
        logLevel: getLogLevel(),
        recoverRunningTask: true,
      });
      if (!response?.ok) {
        throw new Error(response?.error || "Recovery from closed tab failed");
      }
    }
  } catch (error) {
    errorLog("Background", "Tab-close handler failed", {
      taskId: runningTaskId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function runWorkerLoop(stopToken) {
  debugLog("Background", "runWorkerLoop enter", {
    workerInstanceId: WORKER_INSTANCE_ID,
    stopToken,
    workerLoopStopToken,
    workerLoopRunning,
  });
  if (workerLoopRunning) return;
  workerLoopRunning = true;
  try {
    while (true) {
      if (stopToken !== workerLoopStopToken) {
        debugLog("Background", "runWorkerLoop stopToken changed", {
          workerInstanceId: WORKER_INSTANCE_ID,
          stopToken,
          workerLoopStopToken,
        });
        break;
      }
      try {
        debugLog("Background", "runWorkerLoop iteration begin", {
          workerInstanceId: WORKER_INSTANCE_ID,
          stopToken,
        });
        const result = await processNextTask(stopToken);
        debugLog("Background", "runWorkerLoop iteration result", {
          workerInstanceId: WORKER_INSTANCE_ID,
          stopToken,
          result,
        });
        if (result === "task") {
          continue;
        }
        if (result === "busy" || result === "stale") {
          await sleep(200);
          continue;
        }
        continue;
      } catch (error) {
        errorLog("Background", "Worker loop iteration failed", {
          error: error instanceof Error ? error.message : String(error),
        });
        await sleep(CLAIM_FAILURE_BACKOFF_MS);
      }
    }
  } finally {
    debugLog("Background", "runWorkerLoop finally", {
      workerInstanceId: WORKER_INSTANCE_ID,
      stopToken,
      workerLoopStopToken,
    });
    workerLoopRunning = false;
    // 如果在运行中收到新的 stopToken，确保自动拉起新循环，避免“claimed 后不继续”
    if (stopToken !== workerLoopStopToken) {
      void runWorkerLoop(workerLoopStopToken);
    }
  }
}

async function schedulePolling(reason = "manual") {
  await syncLogLevelFromSettings();
  debugLog("Background", "schedulePolling start", {
    workerInstanceId: WORKER_INSTANCE_ID,
    reason,
    workerLoopStopToken,
  });
  if (pollingTimer) {
    clearInterval(pollingTimer);
    pollingTimer = null;
  }
  workerLoopStopToken += 1;
  debugLog("Background", "schedulePolling new stop token", {
    workerInstanceId: WORKER_INSTANCE_ID,
    reason,
    workerLoopStopToken,
  });
  scheduleWakeAlarm();
  await sendCompatibilityHeartbeat("schedule-polling", true);
  void runWorkerLoop(workerLoopStopToken);
}

chrome.runtime.onInstalled.addListener(() => {
  void ensureBackgroundActive("onInstalled");
});

chrome.runtime.onStartup.addListener(() => {
  void ensureBackgroundActive("onStartup");
});

chrome.storage.onChanged.addListener(() => {
  void syncLogLevelFromSettings();
  void ensureBackgroundActive("storage.onChanged");
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm?.name !== CLAIM_WAKE_ALARM_NAME) {
    return;
  }
  void ensureBackgroundActive("alarm");
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void handleRunningTaskTabClosed(tabId);
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "ainote-task") {
    return;
  }
  let boundTaskId = "";
  port.onMessage.addListener((message) => {
    if (message?.type !== "task-bind" || !message.taskId) {
      return;
    }
    boundTaskId = message.taskId;
    taskPorts.set(boundTaskId, {
      port,
      tabId: message.tabId || 0,
    });
    const pendingCancel = cancelPendingTasks.get(boundTaskId);
    if (pendingCancel) {
      pushTaskCancelToContent(boundTaskId, pendingCancel);
    }
  });
  port.onDisconnect.addListener(() => {
    if (boundTaskId) {
      clearTaskPort(boundTaskId, port);
    }
  });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "ainote-force-heartbeat") {
    void ensureBackgroundActive("force-heartbeat")
      .then(async () => {
        await sendCompatibilityHeartbeat("force-heartbeat", true);
        sendResponse({ ok: true });
      })
      .catch((error) =>
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    return true;
  }
  if (message?.type === "ainote-page-ready") {
    debugLog("Background", "ainote-page-ready", message.payload);
    void sendCompatibilityHeartbeat("content-page-ready")
      .then(async () => {
        markBridgeActivity();
        sendResponse({ ok: true });
      })
      .catch((error) =>
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    return true;
  }
  if (message?.type === "ainote-task-status" && message.taskId) {
    debugLog("Background", "ainote-task-status", {
      taskId: message.taskId,
      payload: message.payload,
    });
    void reportTaskStatus(message.taskId, message.payload)
      .then(() => {
        markBridgeActivity();
        sendResponse({ ok: true });
      })
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }
  if (message?.type === "ainote-fetch-task-pdf" && message.taskId) {
    void fetchTaskPdf(message.taskId)
      .then((pdfBuffer) => {
        markBridgeActivity();
        sendResponse({ ok: true, pdfBase64: arrayBufferToBase64(pdfBuffer) });
      })
      .catch((error) =>
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    return true;
  }
  if (message?.type === "ainote-get-task" && message.taskId) {
    void getTask(message.taskId)
      .then((task) => {
        markBridgeActivity();
        sendResponse({ ok: true, task });
      })
      .catch((error) =>
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    return true;
  }
  if (message?.type === "ainote-task-result" && message.taskId) {
    void reportTaskResult(message.taskId, message.payload)
      .then(() => {
        markBridgeActivity();
        settleContentTask(message.taskId);
        sendResponse({ ok: true });
      })
      .catch((error) => {
        settleContentTask(
          message.taskId,
          error instanceof Error ? error : new Error(String(error)),
        );
        sendResponse({ ok: false, error: String(error) });
      });
    return true;
  }
  if (message?.type === "ainote-task-canceled" && message.taskId) {
    void reportTaskStatus(message.taskId, {
      status: "canceled",
      errorCode: "INTERNAL_ERROR",
      errorMessage: message.payload?.errorMessage || "已停止当前条目的AI总结",
      conversationId: message.payload?.conversationId,
      conversationUrl: message.payload?.conversationUrl,
      conversationTitle: message.payload?.conversationTitle,
      folderName: message.payload?.folderName,
      folderResolved: message.payload?.folderResolved,
    })
      .then(() => {
        markBridgeActivity();
        settleContentTask(message.taskId);
        sendResponse({ ok: true });
      })
      .catch((error) => {
        settleContentTask(message.taskId);
        sendResponse({ ok: false, error: String(error) });
      });
    return true;
  }
  if (message?.type === "ainote-task-failure" && message.taskId) {
    void reportTaskFailure(message.taskId, message.payload)
      .then(() => {
        markBridgeActivity();
        settleContentTask(
          message.taskId,
          new Error(
            message.payload?.errorMessage || "Content script task failed",
          ),
        );
        sendResponse({ ok: true });
      })
      .catch((error) => {
        settleContentTask(
          message.taskId,
          error instanceof Error ? error : new Error(String(error)),
        );
        sendResponse({ ok: false, error: String(error) });
      });
    return true;
  }
  return false;
});

debugLog("Background", "module-load", {
  workerInstanceId: WORKER_INSTANCE_ID,
});
void ensureBackgroundActive("module-load");
