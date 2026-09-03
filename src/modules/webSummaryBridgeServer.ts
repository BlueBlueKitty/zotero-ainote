import { clearPref, getPref, setPref } from "../utils/prefs";
import {
  BridgeEnvelope,
  BridgeErrorCode,
  BridgeSessionResponse,
  CancelTaskResponse,
  ClaimNextTaskResponse,
  CreatePairingRequest,
  CreatePairingResponse,
  CreateTaskRequest,
  CreateTaskResponse,
  PairingStatusResponse,
  RemoveTaskResponse,
  ReportTaskEventRequest,
  ReportTaskFailureRequest,
  ReportTaskResultRequest,
  WebSummaryBridgeStatus,
  WebSummaryPairedExecutor,
  WebSummaryTask,
  WEB_SUMMARY_BRIDGE_PORT,
  WEB_SUMMARY_LONG_POLL_MS,
  WEB_SUMMARY_PROTOCOL_VERSION,
  WEB_SUMMARY_REQUIRED_CAPABILITIES,
} from "./webSummaryTypes";
import {
  PairingPersistence,
  StoredPairing,
  WebSummaryPairingStore,
} from "./webSummaryPairingStore";
import { debugWebSummaryLog, errorWebSummaryLog } from "./webSummaryDebug";
import { WebSummaryTaskStore } from "./webSummaryTaskStore";

const JSON_MIME = "application/json; charset=utf-8";
const MAX_REQUEST_SIZE = 1024 * 1024;
const READ_WAIT_LIMIT = 60;
const PAIRING_PREF = "webSummaryPairingV2";
const API_PREFIX = "/bridge/v2";
const OPEN_BLOCKING =
  ((Components.interfaces.nsITransport as any)?.OPEN_BLOCKING as number) || 1;

interface ParsedHttpRequest {
  method: string;
  pathname: string;
  query: Record<string, string>;
  headers: Record<string, string>;
  bodyText: string;
}

interface HttpResponse {
  status: number;
  statusText: string;
  headers?: Record<string, string>;
  body?: string | Uint8Array;
}

function bridgeError(
  code: BridgeErrorCode,
  message: string,
): Error & {
  bridgeCode?: BridgeErrorCode;
} {
  const error = new Error(message) as Error & { bridgeCode?: BridgeErrorCode };
  error.bridgeCode = code;
  return error;
}

function jsonEnvelope<T>(data: T): BridgeEnvelope<T> {
  return { ok: true, data };
}

function jsonError(
  code: BridgeErrorCode | "UNKNOWN_ERROR",
  message: string,
): BridgeEnvelope<never> {
  return { ok: false, error: { code, message } };
}

function normalizeErrorCode(value: unknown): BridgeErrorCode | "UNKNOWN_ERROR" {
  return typeof value === "string"
    ? (value as BridgeErrorCode)
    : "UNKNOWN_ERROR";
}

function statusForError(code: BridgeErrorCode | "UNKNOWN_ERROR"): number {
  switch (code) {
    case "UNAUTHORIZED":
      return 401;
    case "TASK_NOT_FOUND":
    case "PAIRING_REQUEST_NOT_FOUND":
    case "PDF_NOT_FOUND":
      return 404;
    case "PROTOCOL_MISMATCH":
    case "REQUIRED_CAPABILITY_MISSING":
    case "LEASE_MISMATCH":
    case "LEASE_EXPIRED":
    case "INVALID_STATUS_TRANSITION":
      return 409;
    case "INVALID_REQUEST":
      return 400;
    default:
      return 500;
  }
}

function isAllowedExtensionOrigin(origin: string): boolean {
  return /^chrome-extension:\/\/[a-z]{32}$/i.test(origin);
}

function buildCorsHeaders(origin = ""): Record<string, string> {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers":
      "Authorization, Content-Type, X-AiNote-Install-ID, X-AiNote-Lease-ID, X-AiNote-Protocol",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Private-Network": "true",
    "Cache-Control": "no-store",
    Vary: "Origin",
  };
  if (isAllowedExtensionOrigin(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
}

function buildJsonResponse(
  status: number,
  payload: unknown,
  origin = "",
): HttpResponse {
  const statusText =
    (Zotero.Server.responseCodes as Record<number, string>)[status] || "OK";
  return {
    status,
    statusText,
    headers: { "Content-Type": JSON_MIME, ...buildCorsHeaders(origin) },
    body: JSON.stringify(payload),
  };
}

function buildBinaryResponse(
  status: number,
  contentType: string,
  body: Uint8Array,
  origin = "",
): HttpResponse {
  const statusText =
    (Zotero.Server.responseCodes as Record<number, string>)[status] || "OK";
  return {
    status,
    statusText,
    headers: { "Content-Type": contentType, ...buildCorsHeaders(origin) },
    body,
  };
}

function getByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function getResponseBodyLength(body: string | Uint8Array): number {
  return typeof body === "string" ? getByteLength(body) : body.byteLength;
}

function writeBytesToStream(output: nsIOutputStream, bytes: Uint8Array): void {
  const factory = Components.classes[
    "@mozilla.org/binaryoutputstream;1" as keyof typeof Components.classes
  ] as any;
  const binaryOutput = factory.createInstance(
    Components.interfaces.nsIBinaryOutputStream,
  ) as any;
  binaryOutput.setOutputStream(output);
  for (let index = 0; index < bytes.byteLength; index += 0x8000) {
    const chunk = bytes.subarray(index, index + 0x8000);
    binaryOutput.writeByteArray(Array.from(chunk), chunk.byteLength);
  }
}

function writeBodyToStream(
  output: nsIOutputStream,
  body: string | Uint8Array,
): void {
  writeBytesToStream(
    output,
    typeof body === "string" ? new TextEncoder().encode(body) : body,
  );
}

function parseQueryString(queryString: string): Record<string, string> {
  return Object.fromEntries(new URLSearchParams(queryString).entries());
}

function findHeaderEnd(bytes: Uint8Array): number {
  for (let index = 0; index <= bytes.length - 4; index += 1) {
    if (
      bytes[index] === 13 &&
      bytes[index + 1] === 10 &&
      bytes[index + 2] === 13 &&
      bytes[index + 3] === 10
    ) {
      return index;
    }
  }
  return -1;
}

function concatBytes(chunks: Uint8Array[], totalLength: number): Uint8Array {
  const merged = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
}

function parseHttpRequest(requestText: string): ParsedHttpRequest {
  const [headerText, bodyText = ""] = requestText.split("\r\n\r\n");
  const [requestLine = "", ...headerLines] = headerText.split("\r\n");
  const [method = "GET", rawTarget = "/"] = requestLine.split(" ");
  const queryOffset = rawTarget.indexOf("?");
  const pathname =
    queryOffset >= 0 ? rawTarget.slice(0, queryOffset) : rawTarget;
  const queryString = queryOffset >= 0 ? rawTarget.slice(queryOffset + 1) : "";
  const headers: Record<string, string> = {};
  for (const line of headerLines) {
    const separator = line.indexOf(":");
    if (separator <= 0) continue;
    headers[line.slice(0, separator).trim().toLowerCase()] = line
      .slice(separator + 1)
      .trim();
  }
  return {
    method: method.toUpperCase(),
    pathname,
    query: parseQueryString(queryString),
    headers,
    bodyText,
  };
}

function parseJsonBody<T>(request: ParsedHttpRequest): T {
  if (!request.bodyText.trim()) return {} as T;
  try {
    return JSON.parse(request.bodyText) as T;
  } catch {
    throw bridgeError("INVALID_REQUEST", "Invalid JSON request body");
  }
}

function extractPathId(pathname: string, prefix: string, suffix = ""): string {
  let value = pathname.slice(prefix.length);
  if (suffix && value.endsWith(suffix)) value = value.slice(0, -suffix.length);
  return decodeURIComponent(value.replace(/^\/+|\/+$/g, ""));
}

function pairingPersistence(): PairingPersistence {
  return {
    load(): StoredPairing | null {
      try {
        const raw = String(getPref(PAIRING_PREF as any) || "").trim();
        if (!raw) return null;
        const parsed = JSON.parse(raw) as StoredPairing;
        return parsed?.token && parsed?.executor?.installId ? parsed : null;
      } catch {
        return null;
      }
    },
    save(value: StoredPairing): void {
      setPref(PAIRING_PREF as any, JSON.stringify(value) as any);
    },
    clear(): void {
      clearPref(PAIRING_PREF);
    },
  };
}

export class WebSummaryBridgeServer {
  private readonly taskStore = new WebSummaryTaskStore();
  private readonly pairingStore = new WebSummaryPairingStore(
    pairingPersistence(),
  );
  private serverSocket: nsIServerSocket | null = null;
  private isRunning = false;
  private readonly activeTransports = new Set<nsISocketTransport>();

  public getTaskStore(): WebSummaryTaskStore {
    return this.taskStore;
  }

  public createTask(request: CreateTaskRequest): CreateTaskResponse {
    const pairingStatus = this.pairingStore.getStatus(this.isRunning);
    if (!pairingStatus.paired) {
      throw bridgeError(
        "EXTENSION_OFFLINE",
        "浏览器扩展尚未与 AiNote 配对，请先在设置中完成配对",
      );
    }
    return { task: this.taskStore.createTask(request) };
  }

  public getTask(taskId: string): WebSummaryTask {
    const task = this.taskStore.getTask(taskId);
    if (!task) throw bridgeError("TASK_NOT_FOUND", "Task not found");
    return task;
  }

  public hasActiveTaskForItem(itemId: number): boolean {
    return this.taskStore.hasActiveTaskForItem(itemId);
  }

  public cancelTask(taskId: string, reason?: string): CancelTaskResponse {
    return { task: this.taskStore.requestCancel(taskId, reason) };
  }

  public removeTask(taskId: string): RemoveTaskResponse {
    const task = this.taskStore.removeTask(taskId);
    return { removed: !!task, task: task || undefined };
  }

  public getStatus(): WebSummaryBridgeStatus {
    return this.pairingStore.getStatus(this.isRunning);
  }

  public approvePairingRequest(requestId: string): WebSummaryBridgeStatus {
    return this.pairingStore.approvePairingRequest(requestId);
  }

  public rejectPairingRequest(
    requestId: string,
    reason?: string,
  ): WebSummaryBridgeStatus {
    return this.pairingStore.rejectPairingRequest(requestId, reason);
  }

  public revokePairing(): WebSummaryBridgeStatus {
    return this.pairingStore.revoke();
  }

  public start(): void {
    if (this.isRunning) return;
    const socketFactory = Components.classes[
      "@mozilla.org/network/server-socket;1" as keyof typeof Components.classes
    ] as any;
    const socket = socketFactory.createInstance(
      Components.interfaces.nsIServerSocket,
    ) as nsIServerSocket;
    try {
      socket.init(WEB_SUMMARY_BRIDGE_PORT, true, -1);
      socket.asyncListen(this.listener);
    } catch (error) {
      try {
        socket.close();
      } catch {
        // Ignore cleanup failures after a bind error.
      }
      throw bridgeError(
        "BRIDGE_PORT_IN_USE",
        `无法启动网页总结桥接：127.0.0.1:${WEB_SUMMARY_BRIDGE_PORT} 已被占用`,
      );
    }
    this.serverSocket = socket;
    this.isRunning = true;
  }

  public stop(): void {
    for (const transport of this.activeTransports) {
      try {
        transport.close(0);
      } catch {
        // Ignore shutdown races.
      }
    }
    this.activeTransports.clear();
    try {
      this.serverSocket?.close();
    } catch {
      // Ignore shutdown races.
    }
    this.serverSocket = null;
    this.isRunning = false;
  }

  private authenticate(request: ParsedHttpRequest): WebSummaryPairedExecutor {
    const authorization = request.headers.authorization || "";
    const token = authorization.replace(/^Bearer\s+/i, "").trim();
    const installId = request.headers["x-ainote-install-id"] || "";
    const protocolVersion = Number(request.headers["x-ainote-protocol"] || NaN);
    return this.pairingStore.authenticate(token, installId, protocolVersion);
  }

  private async routeRequest(
    request: ParsedHttpRequest,
  ): Promise<HttpResponse> {
    const origin = request.headers.origin || "";
    if (request.method === "OPTIONS") {
      return {
        status: 204,
        statusText: "No Content",
        headers: buildCorsHeaders(origin),
        body: "",
      };
    }

    if (
      request.pathname === `${API_PREFIX}/pair/requests` &&
      request.method === "POST"
    ) {
      const payload = parseJsonBody<CreatePairingRequest>(request);
      const response: CreatePairingResponse = {
        request: this.pairingStore.createPairingRequest(payload),
      };
      return buildJsonResponse(201, jsonEnvelope(response), origin);
    }

    if (
      request.pathname.startsWith(`${API_PREFIX}/pair/requests/`) &&
      request.method === "GET"
    ) {
      const requestId = extractPathId(
        request.pathname,
        `${API_PREFIX}/pair/requests/`,
      );
      const response: PairingStatusResponse =
        this.pairingStore.getPairingStatus(requestId);
      return buildJsonResponse(200, jsonEnvelope(response), origin);
    }

    const executor = this.authenticate(request);

    if (
      request.pathname === `${API_PREFIX}/session` &&
      request.method === "GET"
    ) {
      const response: BridgeSessionResponse = {
        protocolVersion: WEB_SUMMARY_PROTOCOL_VERSION,
        executor,
        requiredCapabilities: [...WEB_SUMMARY_REQUIRED_CAPABILITIES],
        updatedAt: new Date().toISOString(),
      };
      return buildJsonResponse(200, jsonEnvelope(response), origin);
    }

    if (
      request.pathname === `${API_PREFIX}/pairing/revoke` &&
      request.method === "POST"
    ) {
      this.pairingStore.revoke();
      return buildJsonResponse(200, jsonEnvelope({ revoked: true }), origin);
    }

    if (
      request.pathname === `${API_PREFIX}/tasks/next` &&
      request.method === "GET"
    ) {
      const waitMs = Math.max(
        0,
        Math.min(
          WEB_SUMMARY_LONG_POLL_MS,
          Number.parseInt(request.query.waitMs || "0", 10) || 0,
        ),
      );
      const task = await this.taskStore.claimNextTaskOrWait(
        waitMs,
        executor.installId,
      );
      const response: ClaimNextTaskResponse = { task };
      return buildJsonResponse(200, jsonEnvelope(response), origin);
    }

    const taskPrefix = `${API_PREFIX}/tasks/`;
    if (request.pathname.startsWith(taskPrefix)) {
      if (request.pathname.endsWith("/events") && request.method === "POST") {
        const taskId = extractPathId(request.pathname, taskPrefix, "/events");
        const payload = parseJsonBody<ReportTaskEventRequest>(request);
        return buildJsonResponse(
          200,
          jsonEnvelope(
            this.taskStore.reportEvent(taskId, payload, executor.installId),
          ),
          origin,
        );
      }
      if (request.pathname.endsWith("/result") && request.method === "POST") {
        const taskId = extractPathId(request.pathname, taskPrefix, "/result");
        const payload = parseJsonBody<ReportTaskResultRequest>(request);
        return buildJsonResponse(
          200,
          jsonEnvelope(
            this.taskStore.completeTask(taskId, payload, executor.installId),
          ),
          origin,
        );
      }
      if (request.pathname.endsWith("/failure") && request.method === "POST") {
        const taskId = extractPathId(request.pathname, taskPrefix, "/failure");
        const payload = parseJsonBody<ReportTaskFailureRequest>(request);
        return buildJsonResponse(
          200,
          jsonEnvelope(
            this.taskStore.failTask(taskId, payload, executor.installId),
          ),
          origin,
        );
      }
      if (request.pathname.endsWith("/pdf") && request.method === "GET") {
        const taskId = extractPathId(request.pathname, taskPrefix, "/pdf");
        const leaseId = request.headers["x-ainote-lease-id"] || "";
        const task = this.taskStore.validateLease(
          taskId,
          leaseId,
          executor.installId,
        );
        if (!task.pdfPath || !(await IOUtils.exists(task.pdfPath))) {
          throw bridgeError("PDF_NOT_FOUND", "PDF not found");
        }
        const bytes = new Uint8Array(await IOUtils.read(task.pdfPath));
        if (!bytes.byteLength)
          throw bridgeError("PDF_NOT_FOUND", "PDF is empty");
        return buildBinaryResponse(200, "application/pdf", bytes, origin);
      }
    }

    throw bridgeError("INVALID_REQUEST", "Endpoint not found");
  }

  private async readRequestText(input: nsIInputStream): Promise<string> {
    const factory = Components.classes[
      "@mozilla.org/binaryinputstream;1" as keyof typeof Components.classes
    ] as any;
    const binaryInput = factory.createInstance(
      Components.interfaces.nsIBinaryInputStream,
    ) as any;
    binaryInput.setInputStream(input);
    const chunks: Uint8Array[] = [];
    let totalLength = 0;
    let waitAttempts = 0;
    let headersComplete = false;
    let contentLength = 0;
    let headerEndIndex = -1;

    while (totalLength < MAX_REQUEST_SIZE && !headersComplete) {
      const available = input.available();
      if (!available) {
        if (++waitAttempts > READ_WAIT_LIMIT) break;
        await Zotero.Promise.delay(10);
        continue;
      }
      const chunk = Uint8Array.from(
        binaryInput.readByteArray(Math.min(available, 4096)),
      );
      if (!chunk.byteLength) break;
      chunks.push(chunk);
      totalLength += chunk.byteLength;
      const merged = concatBytes(chunks, totalLength);
      headerEndIndex = findHeaderEnd(merged);
      if (headerEndIndex >= 0) {
        headersComplete = true;
        const headerSection = new TextDecoder().decode(
          merged.subarray(0, headerEndIndex),
        );
        contentLength = Number.parseInt(
          headerSection.match(/Content-Length:\s*(\d+)/i)?.[1] || "0",
          10,
        );
      }
    }

    if (headersComplete && contentLength > 0) {
      const bodyStart = headerEndIndex + 4;
      waitAttempts = 0;
      while (
        totalLength - bodyStart < contentLength &&
        totalLength < MAX_REQUEST_SIZE
      ) {
        const available = input.available();
        if (!available) {
          if (++waitAttempts > READ_WAIT_LIMIT) break;
          await Zotero.Promise.delay(10);
          continue;
        }
        const remaining = contentLength - (totalLength - bodyStart);
        const chunk = Uint8Array.from(
          binaryInput.readByteArray(Math.min(available, remaining, 4096)),
        );
        if (!chunk.byteLength) break;
        chunks.push(chunk);
        totalLength += chunk.byteLength;
      }
    }
    try {
      binaryInput.close();
    } catch {
      // Ignore input cleanup races.
    }
    return new TextDecoder().decode(concatBytes(chunks, totalLength));
  }

  private sendResponse(output: nsIOutputStream, response: HttpResponse): void {
    const body = response.body || "";
    const headers = response.headers || {};
    const headerText =
      `HTTP/1.1 ${response.status} ${response.statusText}\r\n` +
      `Connection: close\r\n` +
      Object.entries(headers)
        .map(([key, value]) => `${key}: ${value}`)
        .join("\r\n") +
      `\r\nContent-Length: ${getResponseBodyLength(body)}\r\n\r\n`;
    output.write(headerText, headerText.length);
    if (getResponseBodyLength(body)) writeBodyToStream(output, body);
    try {
      output.flush();
    } catch {
      // Ignore output cleanup races.
    }
  }

  private readonly listener = {
    onSocketAccepted: async (
      _socket: nsIServerSocket,
      transport: nsISocketTransport,
    ) => {
      this.activeTransports.add(transport);
      let input: nsIInputStream | null = null;
      let output: nsIOutputStream | null = null;
      let requestOrigin = "";
      try {
        input = transport.openInputStream(0, 0, 0);
        output = transport.openOutputStream(OPEN_BLOCKING, 0, 0);
        const requestText = await this.readRequestText(input);
        if (!requestText.trim()) return;
        const request = parseHttpRequest(requestText);
        requestOrigin = request.headers.origin || "";
        const response = await this.routeRequest(request);
        this.sendResponse(output, response);
      } catch (error: any) {
        const code = normalizeErrorCode(error?.bridgeCode);
        if (code !== "UNAUTHORIZED") {
          errorWebSummaryLog("Bridge", "request failed", {
            code,
            error: error?.message || String(error),
          });
        }
        if (output) {
          const publicMessage =
            code === "UNAUTHORIZED"
              ? "Unauthorized"
              : error?.message || "Internal error";
          this.sendResponse(
            output,
            buildJsonResponse(
              statusForError(code),
              jsonError(code, publicMessage),
              requestOrigin,
            ),
          );
        }
      } finally {
        this.activeTransports.delete(transport);
        try {
          output?.close();
        } catch {
          // Ignore cleanup races.
        }
        try {
          input?.close();
        } catch {
          // Ignore cleanup races.
        }
      }
    },
    onStopListening: (_socket: nsIServerSocket, _status: nsresult) => {
      this.isRunning = false;
    },
  };
}
