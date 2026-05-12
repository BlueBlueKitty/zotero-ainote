// @ts-check

import {
  getTask,
  claimNextTask,
  fetchTaskPdf,
  reportTaskFailure,
  reportTaskResult,
  reportTaskStatus,
} from "./bridge-client.js";
import { getSettings } from "./storage.js";

const CHATGPT_URL = "https://chatgpt.com/";
const CHATGPT_URL_PREFIXES = [
  "https://chatgpt.com/",
  "https://chat.openai.com/",
];
let pollingTimer = null;
let runningTaskId = "";
const pendingTaskResolvers = new Map();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForChatGPTTabReady(tabId, timeoutMs = 45000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const tab = await chrome.tabs.get(tabId);
    const url = tab.url || "";
    if (
      tab.status === "complete" &&
      CHATGPT_URL_PREFIXES.some((prefix) => url.startsWith(prefix))
    ) {
      return tab;
    }
    await sleep(300);
  }
  throw new Error("ChatGPT tab did not finish loading in time");
}

async function ensureContentScript(tabId) {
  await waitForChatGPTTabReady(tabId);
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["content.js"],
  });
}

async function ensureChatGPTTab(url = CHATGPT_URL, options = {}) {
  const { reuseExisting = true } = options;
  if (!reuseExisting) {
    const created = await chrome.tabs.create({ url, active: true });
    if (!created.id) {
      throw new Error("Failed to create ChatGPT tab");
    }
    await waitForChatGPTTabReady(created.id);
    return created.id;
  }
  const tabs = await chrome.tabs.query({
    url: ["https://chatgpt.com/*", "https://chat.openai.com/*"],
  });
  const tab = tabs[0];
  if (tab?.id) {
    await chrome.tabs.update(tab.id, { active: true, url });
    await waitForChatGPTTabReady(tab.id);
    return tab.id;
  }
  const created = await chrome.tabs.create({ url, active: true });
  if (!created.id) {
    throw new Error("Failed to create ChatGPT tab");
  }
  await waitForChatGPTTabReady(created.id);
  return created.id;
}

/**
 * @param {number} tabId
 * @param {unknown} payload
 * @returns {Promise<any>}
 */
function sendTabMessage(tabId, payload) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, payload, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(response);
    });
  });
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
  const settings = await getSettings();
  await reportTaskStatus(task.taskId, { status: "opening_chat" });
  const targetUrl = task.projectUrl || CHATGPT_URL;
  const tabId = await ensureChatGPTTab(targetUrl, { reuseExisting: true });
  await ensureContentScript(tabId);
  const completion = waitForContentTask(task.taskId);
  const response = await sendTabMessage(tabId, {
    type: "ainote-run-summarize-task",
    task,
    autoSend: settings.autoSend,
    projectUrl: task.projectUrl || "",
    autoRenameConversation: settings.autoRenameConversation,
    chatgptMode: task.chatgptMode || "thinking",
  });
  if (!response?.ok) {
    pendingTaskResolvers.delete(task.taskId);
    throw new Error(response?.error || "Content script task failed");
  }
  await completion;
}

async function runOpenConversationTask(task) {
  await reportTaskStatus(task.taskId, { status: "opening_chat" });
  const url = task.existingConversationUrl || CHATGPT_URL;
  const tabId = await ensureChatGPTTab(url);
  await ensureContentScript(tabId);
  const completion = waitForContentTask(task.taskId);
  const response = await sendTabMessage(tabId, {
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
    return;
  }

  const settings = await getSettings();
  if (!settings.pollingEnabled) {
    return;
  }

  const data = await claimNextTask();
  const task = data?.task;
  if (!task) {
    return;
  }

  runningTaskId = task.taskId;
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
  }
}

async function schedulePolling() {
  const settings = await getSettings();
  if (pollingTimer) {
    clearInterval(pollingTimer);
    pollingTimer = null;
  }
  if (!settings.pollingEnabled) {
    return;
  }
  pollingTimer = setInterval(
    () => {
      void processNextTask();
    },
    Math.max(1000, settings.pollingIntervalMs || 1500),
  );
  void processNextTask();
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
