// @ts-check

import { getSettings } from "./storage.js";

/**
 * @param {string} path
 * @param {RequestInit} [init]
 */
async function request(path, init = {}) {
  const settings = await getSettings();
  const url = `${settings.bridgeUrl}${path}`;
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
    throw new Error(
      `Bridge 请求失败: ${init.method || "GET"} ${url} - ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  let json;
  try {
    json = await response.json();
  } catch (error) {
    throw new Error(
      `Bridge 响应解析失败: ${init.method || "GET"} ${url} - HTTP ${response.status}`,
    );
  }
  if (!response.ok || !json?.ok) {
    throw new Error(
      `Bridge 返回错误: ${init.method || "GET"} ${url} - ${json?.error?.message || `HTTP ${response.status}`}`,
    );
  }
  return json.data;
}

/**
 * @param {string} path
 * @param {RequestInit} [init]
 */
async function requestArrayBuffer(path, init = {}) {
  const settings = await getSettings();
  const url = `${settings.bridgeUrl}${path}`;
  let response;
  try {
    response = await fetch(url, init);
  } catch (error) {
    throw new Error(
      `Bridge 请求失败: ${init.method || "GET"} ${url} - ${error instanceof Error ? error.message : String(error)}`,
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
    throw new Error(
      `Bridge 返回错误: ${init.method || "GET"} ${url} - ${message}`,
    );
  }
  try {
    return await response.arrayBuffer();
  } catch (error) {
    throw new Error(
      `Bridge 响应解析失败: ${init.method || "GET"} ${url} - HTTP ${response.status}`,
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
