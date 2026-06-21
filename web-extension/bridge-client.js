// @ts-check

import { getSettings } from "./storage.js";
import { debugLog, errorLog, setLogLevel } from "./debug.js";

function shouldLogBridgeClientRequest(path, method) {
  const normalizedMethod = String(method || "GET").toUpperCase();
  const normalizedPath = String(path || "");
  if (normalizedMethod === "GET" && normalizedPath === "/api/health") {
    return false;
  }
  if (normalizedMethod === "POST" && normalizedPath === "/api/ext/handshake") {
    return false;
  }
  if (normalizedMethod === "GET" && normalizedPath.startsWith("/api/ext/tasks/next")) {
    return false;
  }
  return true;
}

/**
 * @param {string} path
 * @param {RequestInit} [init]
 */
async function request(path, init = {}) {
  const settings = await getSettings();
  setLogLevel(settings.logLevel);
  const url = `${settings.bridgeUrl}${path}`;
  const method = init.method || "GET";
  if (shouldLogBridgeClientRequest(path, method)) {
    debugLog("BridgeClient", "request", {
      method,
      url,
    });
  }
  const headers = new Headers(init.headers || {});
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  let response;
  try {
    response = await fetch(url, {
      ...init,
      headers,
    });
  } catch (error) {
    errorLog("BridgeClient", "request failed", {
      method,
      url,
      error: error instanceof Error ? error.message : String(error),
    });
    throw new Error(
      `Bridge 请求失败: ${method} ${url} - ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  let json;
  try {
    json = await response.json();
  } catch (error) {
    errorLog("BridgeClient", "response json parse failed", {
      method,
      url,
      status: response.status,
      error: error instanceof Error ? error.message : String(error),
    });
    throw new Error(
      `Bridge 响应解析失败: ${method} ${url} - HTTP ${response.status}`,
    );
  }
  if (!response.ok || !json?.ok) {
    errorLog("BridgeClient", "response returned error", {
      method,
      url,
      status: response.status,
      errorMessage: json?.error?.message || `HTTP ${response.status}`,
    });
    throw new Error(
      `Bridge 返回错误: ${method} ${url} - ${json?.error?.message || `HTTP ${response.status}`}`,
    );
  }
  if (shouldLogBridgeClientRequest(path, method)) {
    debugLog("BridgeClient", "response", {
      method,
      url,
      ok: true,
    });
  }
  return json.data;
}

/**
 * @param {string} path
 * @param {RequestInit} [init]
 */
async function requestArrayBuffer(path, init = {}) {
  const settings = await getSettings();
  setLogLevel(settings.logLevel);
  const url = `${settings.bridgeUrl}${path}`;
  const method = init.method || "GET";
  if (shouldLogBridgeClientRequest(path, method)) {
    debugLog("BridgeClient", "requestArrayBuffer", {
      method,
      url,
    });
  }
  let response;
  try {
    response = await fetch(url, init);
  } catch (error) {
    errorLog("BridgeClient", "requestArrayBuffer failed", {
      method,
      url,
      error: error instanceof Error ? error.message : String(error),
    });
    throw new Error(
      `Bridge 请求失败: ${method} ${url} - ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    try {
      const json = await response.json();
      message = json?.error?.message || message;
    } catch {
      // ignore non-JSON error bodies
    }
    errorLog("BridgeClient", "requestArrayBuffer returned error", {
      method,
      url,
      status: response.status,
      errorMessage: message,
    });
    throw new Error(
      `Bridge 返回错误: ${method} ${url} - ${message}`,
    );
  }
  try {
    const buffer = await response.arrayBuffer();
    if (shouldLogBridgeClientRequest(path, method)) {
      debugLog("BridgeClient", "responseArrayBuffer", {
        method,
        url,
        byteLength: buffer.byteLength,
      });
    }
    return buffer;
  } catch (error) {
    errorLog("BridgeClient", "responseArrayBuffer parse failed", {
      method,
      url,
      status: response.status,
      error: error instanceof Error ? error.message : String(error),
    });
    throw new Error(
      `Bridge 响应解析失败: ${method} ${url} - HTTP ${response.status}`,
    );
  }
}

export async function healthCheck() {
  return request("/api/health");
}

export async function reportHandshake(payload) {
  return request("/api/ext/handshake", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function claimNextTask(waitMs = 0) {
  const timeout = Number.isFinite(waitMs) ? Math.max(0, Math.floor(waitMs)) : 0;
  return request(`/api/ext/tasks/next?waitMs=${encodeURIComponent(String(timeout))}`);
}

export async function getTask(taskId) {
  return request(`/api/tasks/${encodeURIComponent(taskId)}`);
}

export async function fetchTaskPdf(taskId) {
  return requestArrayBuffer(`/api/ext/tasks/${encodeURIComponent(taskId)}/pdf`);
}

export async function reportTaskStatus(taskId, payload) {
  return request(`/api/ext/tasks/${encodeURIComponent(taskId)}/status`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function reportTaskResult(taskId, payload) {
  return request(`/api/ext/tasks/${encodeURIComponent(taskId)}/result`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function reportTaskFailure(taskId, payload) {
  return request(`/api/ext/tasks/${encodeURIComponent(taskId)}/fail`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function cancelTask(taskId, reason) {
  return request(`/api/tasks/${encodeURIComponent(taskId)}/cancel`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  });
}
