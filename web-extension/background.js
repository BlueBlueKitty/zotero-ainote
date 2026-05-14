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
import { getSettings } from "./storage.js";
import {
  WEB_SUMMARY_CAPABILITIES,
  WEB_SUMMARY_PROTOCOL_VERSION,
  WEB_SUMMARY_REQUIRED_PERMISSIONS,
  WEB_SUMMARY_TASK_CONTRACT_VERSION,
} from "./compat.js";

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
const SHORT_POLL_WAIT_MS = 0;
const IDLE_POLL_DELAYS_MS = [300, 800, 1500, 3000, 5000];
const CHATGPT_TAB_READY_TIMEOUT_MS = 60000;
const CONTENT_SCRIPT_READY_TIMEOUT_MS = 20000;
const HANDSHAKE_INTERVAL_MS = 15000;
let lastHandshakeAtMs = 0;
let idlePollStreak = 0;

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

async function sendCompatibilityHeartbeat(reason, force = false) {
  const now = Date.now();
  if (!force && now - lastHandshakeAtMs < HANDSHAKE_INTERVAL_MS) {
    return;
  }
  try {
    await healthCheck();
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
    lastHandshakeAtMs = now;
  } catch (error) {
    console.warn(
      `[AiNote][WebExtension] heartbeat failed (${reason})`,
      error instanceof Error ? error.message : String(error),
    );
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
    if (isChatGPTUrlCandidate(url)) {
      return tab;
    }
    await sleep(300);
  }
  throw new Error("ChatGPT 标签页长时间未进入目标页面");
}

async function pingContentScript(tabId) {
  return sendTabMessage(
    tabId,
    { type: "ainote-ping" },
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
  console.log("[AiNote][WebExtension] ensureContentScript start", { tabId });
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
    console.log("[AiNote][WebExtension] Content script already ready");
    return;
  } catch {
    console.log("[AiNote][WebExtension] Content script not ready, will inject programmatically");
  }

  // 冷启动时扩展刚初始化，tab 的渲染进程可能尚未就绪，延长注入重试窗口到 30s
  const COLD_START_INJECT_TIMEOUT = 30000;
  const startedAt = Date.now();
  let lastError = null;
  let injectAttempt = 0;
  while (Date.now() - startedAt < COLD_START_INJECT_TIMEOUT) {
    injectAttempt += 1;
    console.log("[AiNote][WebExtension] Injecting content script, attempt", injectAttempt);
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ["content.js"],
        injectImmediately: true,
      });
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      console.warn("[AiNote][WebExtension] executeScript failed", lastError?.message);
    }
    try {
      await waitForContentScriptReady(tabId, 3000);
      console.log("[AiNote][WebExtension] Content script ready after injection");
      return;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
    await safeSleep(1000);
  }
  console.error("[AiNote][WebExtension] ensureContentScript failed after", injectAttempt, "attempts");
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
        console.warn(
          `[AiNote] sendTabMessage attempt ${attempt} failed, retrying...`,
          error,
        );
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
      console.warn(
        `[AiNote][WebExtension] Task dispatch attempt ${attempt} hit transient port error, retrying...`,
        lastError,
      );
      await sleep(700);
      await ensureContentScript(tabId);
    }
  }
  throw lastError || new Error("Task dispatch failed");
}

async function ensureChatGPTTab(targetUrl) {
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
      await chrome.tabs.update(matching.id, { url: targetUrl, active: true });
    } else {
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
  // task 在 claim 时已自动设为 opening_chat 状态，无需再重复上报
  // 此处仅更新 debugMessage 以便调试
  const targetUrl = task.projectUrl || CHATGPT_URL;
  const tabId = await ensureChatGPTTab(targetUrl);
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
  await ensureContentScript(tabId);
  const completion = waitForContentTask(task.taskId);
  const response = await dispatchTaskMessage(tabId, {
    type: "ainote-run-summarize-task",
    task,
    autoSend: true,
    projectUrl: task.projectUrl || "",
    chatgptMode: task.chatgptMode || "thinking",
  });
  if (!response?.ok) {
    pendingTaskResolvers.delete(task.taskId);
    throw new Error(response?.error || "Content script task failed");
  }
  await completion;
}

async function runOpenConversationTask(task) {
  await sendCompatibilityHeartbeat("before-open-conversation-task", true);
  await withTimeout(
    reportTaskStatus(task.taskId, {
      status: "opening_chat",
      debugMessage: "扩展已领取任务，准备打开现有对话",
    }),
    4000,
    "report opening_chat timeout",
  ).catch((error) => {
    console.warn("[AiNote][WebExtension] report opening_chat failed", error);
  });
  const url = task.existingConversationUrl || CHATGPT_URL;
  const tabId = await ensureChatGPTTab(url);
  runningTaskTabId = tabId;
  await withTimeout(
    reportTaskStatus(task.taskId, {
      status: "opening_chat",
      debugMessage: `已定位现有对话标签页 tabId=${tabId}，等待页面脚本就绪`,
    }),
    4000,
    "report tab-selected timeout",
  ).catch(() => {});
  await ensureContentScript(tabId);
  const completion = waitForContentTask(task.taskId);
  const response = await dispatchTaskMessage(tabId, {
    type: "ainote-open-conversation-task",
    task,
  });
  if (!response?.ok) {
    pendingTaskResolvers.delete(task.taskId);
    throw new Error(response?.error || "Open conversation failed");
  }
  await completion;
}

async function processNextTask() {
  if (runningTaskId) {
    return "busy";
  }

  await sendCompatibilityHeartbeat("poll-loop");

  const data = await claimNextTask(SHORT_POLL_WAIT_MS);
  const task = data?.task;
  if (!task) {
    return "idle";
  }

  runningTaskId = task.taskId;
  runningTaskTabId = 0;
  try {
    if (task.actionType === "open_conversation") {
      await runOpenConversationTask(task);
    } else {
      await runSummarizeTask(task);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[AiNote][WebExtension] Task failed", task.taskId, message);
    try {
      await reportTaskFailure(task.taskId, {
        errorCode: "INTERNAL_ERROR",
        errorMessage: message,
      });
    } catch (reportError) {
      console.error(
        "[AiNote][WebExtension] Failed to report task failure",
        task.taskId,
        reportError instanceof Error
          ? reportError.message
          : String(reportError),
      );
    }
  } finally {
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
        recoverRunningTask: true,
      });
      if (!response?.ok) {
        throw new Error(response?.error || "Recovery from closed tab failed");
      }
    }
  } catch (error) {
    console.error(
      "[AiNote][WebExtension] Tab-close handler failed",
      runningTaskId,
      error instanceof Error ? error.message : String(error),
    );
  }
}

async function runWorkerLoop(stopToken) {
  if (workerLoopRunning) return;
  workerLoopRunning = true;
  try {
    while (true) {
      if (stopToken !== workerLoopStopToken) {
        break;
      }
      try {
        const result = await processNextTask();
        if (result === "task") {
          idlePollStreak = 0;
          continue;
        }
        if (result === "busy") {
          await sleep(200);
          continue;
        }
        idlePollStreak = Math.min(idlePollStreak + 1, IDLE_POLL_DELAYS_MS.length - 1);
        await sleep(IDLE_POLL_DELAYS_MS[idlePollStreak]);
      } catch (error) {
        const delayIndex = Math.min(
          idlePollStreak + 1,
          IDLE_POLL_DELAYS_MS.length - 1,
        );
        idlePollStreak = delayIndex;
        console.warn(
          "[AiNote][WebExtension] Worker loop iteration failed",
          error instanceof Error ? error.message : String(error),
        );
        await sleep(IDLE_POLL_DELAYS_MS[delayIndex]);
      }
    }
  } finally {
    workerLoopRunning = false;
    // 如果在运行中收到新的 stopToken，确保自动拉起新循环，避免“claimed 后不继续”
    if (stopToken !== workerLoopStopToken) {
      void runWorkerLoop(workerLoopStopToken);
    }
  }
}

async function schedulePolling() {
  if (pollingTimer) {
    clearInterval(pollingTimer);
    pollingTimer = null;
  }
  workerLoopStopToken += 1;
  idlePollStreak = 0;
  await sendCompatibilityHeartbeat("schedule-polling", true);
  void runWorkerLoop(workerLoopStopToken);
}

chrome.runtime.onInstalled.addListener(() => {
  void schedulePolling();
});

chrome.runtime.onStartup.addListener(() => {
  void schedulePolling();
});

chrome.storage.onChanged.addListener(() => {
  void schedulePolling();
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void handleRunningTaskTabClosed(tabId);
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "ainote-task-status" && message.taskId) {
    void reportTaskStatus(message.taskId, message.payload)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }
  if (message?.type === "ainote-fetch-task-pdf" && message.taskId) {
    void fetchTaskPdf(message.taskId)
      .then((pdfBuffer) =>
        sendResponse({ ok: true, pdfBase64: arrayBufferToBase64(pdfBuffer) }),
      )
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
      .then((task) => sendResponse({ ok: true, task }))
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

void schedulePolling();
