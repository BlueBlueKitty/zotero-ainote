// @ts-check

import { BRIDGE_ORIGIN, WEB_SUMMARY_PROTOCOL_VERSION } from "./compat.js";
import { getInstallId, getPairingToken, getSettings } from "./storage.js";
import { debugLog, errorLog, normalizeLogLevel, setLogLevel } from "./debug.js";

export class BridgeRequestError extends Error {
  constructor(message, code = "UNKNOWN_ERROR", status = 0) {
    super(message);
    this.name = "BridgeRequestError";
    this.code = code;
    this.status = status;
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function buildHeaders(init, authenticated) {
  const headers = new Headers(init.headers || {});
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (authenticated) {
    const token = await getPairingToken();
    const installId = await getInstallId();
    if (!token)
      throw new BridgeRequestError("扩展尚未配对", "UNAUTHORIZED", 401);
    headers.set("Authorization", `Bearer ${token}`);
    headers.set("X-AiNote-Install-ID", installId);
    headers.set("X-AiNote-Protocol", String(WEB_SUMMARY_PROTOCOL_VERSION));
  }
  return headers;
}

async function fetchWithRetry(path, init, authenticated, binary = false) {
  const settings = await getSettings();
  setLogLevel(normalizeLogLevel(settings.logLevel));
  const method = String(init.method || "GET").toUpperCase();
  const attempts = method === "GET" && path.includes("/tasks/next") ? 1 : 3;
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const headers = await buildHeaders(init, authenticated);
      debugLog("Bridge", "request started", {
        method,
        path,
        attempt,
        attempts,
        authenticated,
        hasAuthorization: headers.has("Authorization"),
        hasInstallId: headers.has("X-AiNote-Install-ID"),
        protocol: headers.get("X-AiNote-Protocol") || "",
      });
      const response = await fetch(`${BRIDGE_ORIGIN}${path}`, {
        ...init,
        headers,
      });
      if (binary && response.ok) return response.arrayBuffer();
      let payload = null;
      try {
        payload = await response.json();
      } catch {
        throw new BridgeRequestError(
          `Bridge 响应不是有效 JSON（HTTP ${response.status}）`,
          "INVALID_RESPONSE",
          response.status,
        );
      }
      if (!response.ok || !payload?.ok) {
        throw new BridgeRequestError(
          payload?.error?.message || `HTTP ${response.status}`,
          payload?.error?.code || "UNKNOWN_ERROR",
          response.status,
        );
      }
      debugLog("Bridge", "request completed", {
        method,
        path,
        status: response.status,
      });
      return payload.data;
    } catch (error) {
      lastError = error;
      const status = error instanceof BridgeRequestError ? error.status : 0;
      const retryable = status === 0 || status >= 500;
      debugLog("Bridge", "request attempt failed", {
        method,
        path,
        attempt,
        attempts,
        authenticated,
        code:
          error instanceof BridgeRequestError ? error.code : "NETWORK_ERROR",
        status,
        retryable,
        error: error instanceof Error ? error.message : String(error),
      });
      if (!retryable || attempt >= attempts) break;
      await delay(Math.min(2000, 250 * 2 ** (attempt - 1)));
    }
  }
  errorLog("Bridge", "request failed", {
    method,
    path,
    code:
      lastError instanceof BridgeRequestError
        ? lastError.code
        : "NETWORK_ERROR",
    status: lastError instanceof BridgeRequestError ? lastError.status : 0,
  });
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function request(path, init = {}, authenticated = true) {
  return fetchWithRetry(path, init, authenticated, false);
}

export async function createPairingRequest(payload) {
  return request(
    "/bridge/v2/pair/requests",
    { method: "POST", body: JSON.stringify(payload) },
    false,
  );
}

export async function getPairingStatus(requestId) {
  return request(
    `/bridge/v2/pair/requests/${encodeURIComponent(requestId)}`,
    {},
    false,
  );
}

export async function getSession() {
  return request("/bridge/v2/session");
}

export async function claimNextTask(waitMs = 20_000) {
  return request(
    `/bridge/v2/tasks/next?waitMs=${encodeURIComponent(String(waitMs))}`,
  );
}

export async function fetchTaskPdf(taskId, leaseId) {
  return fetchWithRetry(
    `/bridge/v2/tasks/${encodeURIComponent(taskId)}/pdf`,
    { headers: { "X-AiNote-Lease-ID": leaseId } },
    true,
    true,
  );
}

export async function reportTaskEvent(taskId, payload) {
  return request(`/bridge/v2/tasks/${encodeURIComponent(taskId)}/events`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function reportTaskResult(taskId, payload) {
  return request(`/bridge/v2/tasks/${encodeURIComponent(taskId)}/result`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function reportTaskFailure(taskId, payload) {
  return request(`/bridge/v2/tasks/${encodeURIComponent(taskId)}/failure`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
