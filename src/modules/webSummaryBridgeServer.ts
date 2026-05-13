import { getPref } from "../utils/prefs";
import {
  BridgeEnvelope,
  BridgeErrorCode,
  CancelTaskResponse,
  ClaimNextTaskResponse,
  CreateTaskRequest,
  CreateTaskResponse,
  ReportTaskFailureRequest,
  ReportTaskResultRequest,
  ReportTaskStatusRequest,
  WebSummaryTask,
} from "./webSummaryTypes";
import { WebSummaryTaskStore } from "./webSummaryTaskStore";

const LOG_PREFIX = "[AiNote][WebSummaryBridge]";
const JSON_MIME = "application/json; charset=utf-8";
const MAX_REQUEST_SIZE = 10 * 1024 * 1024;
const READ_WAIT_LIMIT = 60;

declare let ztoolkit: ZToolkit;

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

function getByteLength(str: string): number {
  try {
    return new TextEncoder().encode(str).length;
  } catch {
    let bytes = 0;
    for (let index = 0; index < str.length; index += 1) {
      const code = str.charCodeAt(index);
      if (code < 0x80) bytes += 1;
      else if (code < 0x800) bytes += 2;
      else if (code < 0xd800 || code >= 0xe000) bytes += 3;
      else {
        index += 1;
        bytes += 4;
      }
    }
    return bytes;
  }
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
  return typeof value === "string" ? (value as BridgeErrorCode) : "UNKNOWN_ERROR";
}

function buildCorsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Private-Network": "true",
    "Cache-Control": "no-store",
  };
}

function buildJsonResponse(status: number, payload: unknown): HttpResponse {
  const statusText =
    (Zotero.Server.responseCodes as Record<number, string>)[status] || "OK";
  return {
    status,
    statusText,
    headers: {
      "Content-Type": JSON_MIME,
      ...buildCorsHeaders(),
    },
    body: JSON.stringify(payload),
  };
}

function buildBinaryResponse(
  status: number,
  contentType: string,
  body: Uint8Array,
): HttpResponse {
  const statusText =
    (Zotero.Server.responseCodes as Record<number, string>)[status] || "OK";
  return {
    status,
    statusText,
    headers: {
      "Content-Type": contentType,
      ...buildCorsHeaders(),
    },
    body,
  };
}

function getResponseBodyLength(body: string | Uint8Array): number {
  return typeof body === "string" ? getByteLength(body) : body.byteLength;
}

function writeBytesToStream(output: nsIOutputStream, bytes: Uint8Array): void {
  const binaryOutputFactory = Components.classes[
    "@mozilla.org/binaryoutputstream;1" as keyof typeof Components.classes
  ] as any;
  const binaryOutput = binaryOutputFactory.createInstance(
    Components.interfaces.nsIBinaryOutputStream,
  ) as any;
  binaryOutput.setOutputStream(output);
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.byteLength; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binaryOutput.writeByteArray(Array.from(chunk), chunk.byteLength);
  }
}

function writeBodyToStream(
  output: nsIOutputStream,
  body: string | Uint8Array,
): void {
  if (typeof body === "string") {
    writeBytesToStream(output, new TextEncoder().encode(body));
    return;
  }
  writeBytesToStream(output, body);
}

function parseQueryString(queryString: string): Record<string, string> {
  const params = new URLSearchParams(queryString);
  return Object.fromEntries(params.entries());
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
  const [pathname, queryString = ""] = rawTarget.split("?");
  const headers: Record<string, string> = {};
  for (const line of headerLines) {
    const separator = line.indexOf(":");
    if (separator <= 0) continue;
    headers[line.slice(0, separator).trim().toLowerCase()] = line
      .slice(separator + 1)
      .trim();
  }
  return {
    method,
    pathname,
    query: parseQueryString(queryString),
    headers,
    bodyText,
  };
}

function parseJsonBody<T>(request: ParsedHttpRequest): T {
  if (!request.bodyText.trim()) {
    return {} as T;
  }
  return JSON.parse(request.bodyText) as T;
}

function extractTaskId(pathname: string, suffix: string): string {
  return pathname
    .replace("/api/ext/tasks/", "")
    .replace("/api/tasks/", "")
    .replace(suffix, "")
    .replace(/^\/+|\/+$/g, "");
}

function getPort(): number {
  const raw = parseInt(String(getPref("webSummaryBridgePort" as any) || "23123"), 10);
  return Number.isFinite(raw) && raw > 0 ? raw : 23123;
}

export class WebSummaryBridgeServer {
  private readonly taskStore = new WebSummaryTaskStore();
  private serverSocket: nsIServerSocket | null = null;
  private isRunning = false;
  private readonly activeTransports = new Set<nsISocketTransport>();

  public getTaskStore(): WebSummaryTaskStore {
    return this.taskStore;
  }

  public createTask(request: CreateTaskRequest): CreateTaskResponse {
    return { task: this.taskStore.createTask(request) };
  }

  public getTask(taskId: string): WebSummaryTask {
    const task = this.taskStore.getTask(taskId);
    if (!task) {
      const error = new Error("Task not found") as Error & {
        bridgeCode?: BridgeErrorCode;
      };
      error.bridgeCode = "TASK_NOT_FOUND";
      throw error;
    }
    return task;
  }

  public cancelTask(taskId: string, reason?: string): CancelTaskResponse {
    return {
      task: this.taskStore.requestCancel(taskId, reason),
    };
  }

  public start(): void {
    if (this.isRunning) {
      return;
    }
    const port = getPort();
    const socketFactory = Components.classes[
      "@mozilla.org/network/server-socket;1" as keyof typeof Components.classes
    ] as any;
    this.serverSocket = socketFactory.createInstance(
      Components.interfaces.nsIServerSocket,
    ) as nsIServerSocket;
    this.serverSocket.init(port, true, -1);
    this.serverSocket.asyncListen(this.listener);
    this.isRunning = true;
    ztoolkit.log(`${LOG_PREFIX} started`, { port, baseUrl: `http://127.0.0.1:${port}` });
  }

  public stop(): void {
    for (const transport of this.activeTransports) {
      try {
        transport.close(0);
      } catch {
        // ignore
      }
    }
    this.activeTransports.clear();
    if (this.serverSocket) {
      try {
        this.serverSocket.close();
      } catch {
        // ignore
      }
    }
    this.serverSocket = null;
    this.isRunning = false;
  }

  private async readRequestText(input: nsIInputStream): Promise<string> {
    const binaryInputFactory = Components.classes[
      "@mozilla.org/binaryinputstream;1" as keyof typeof Components.classes
    ] as any;
    const binaryInput = binaryInputFactory.createInstance(
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
      if (available === 0) {
        waitAttempts += 1;
        if (waitAttempts > READ_WAIT_LIMIT) break;
        await Zotero.Promise.delay(10);
        continue;
      }
      const readSize = Math.min(available, 4096);
      const chunk = Uint8Array.from(binaryInput.readByteArray(readSize));
      if (!chunk.byteLength) break;
      chunks.push(chunk);
      totalLength += chunk.byteLength;
      const merged = concatBytes(chunks, totalLength);
      headerEndIndex = findHeaderEnd(merged);
      if (headerEndIndex !== -1) {
        headersComplete = true;
        const headerSection = new TextDecoder().decode(
          merged.subarray(0, headerEndIndex),
        );
        const match = headerSection.match(/Content-Length:\s*(\d+)/i);
        if (match) {
          contentLength = parseInt(match[1], 10) || 0;
        }
      }
    }

    if (headersComplete && contentLength > 0) {
      const bodyStart = headerEndIndex + 4;
      waitAttempts = 0;
      while (totalLength - bodyStart < contentLength && totalLength < MAX_REQUEST_SIZE) {
        const available = input.available();
        if (available === 0) {
          waitAttempts += 1;
          if (waitAttempts > READ_WAIT_LIMIT) break;
          await Zotero.Promise.delay(10);
          continue;
        }
        const remaining = contentLength - (totalLength - bodyStart);
        const readSize = Math.min(available, remaining, 4096);
        const chunk = Uint8Array.from(binaryInput.readByteArray(readSize));
        if (!chunk.byteLength) break;
        chunks.push(chunk);
        totalLength += chunk.byteLength;
      }
    }

    try {
      binaryInput.close();
    } catch {
      // ignore
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
    if (getResponseBodyLength(body) > 0) {
      writeBodyToStream(output, body);
    }
    try {
      output.flush();
    } catch {
      // ignore
    }
  }

  private async routeRequest(request: ParsedHttpRequest): Promise<HttpResponse> {
    if (request.method === "OPTIONS") {
      return {
        status: 204,
        statusText: "No Content",
        headers: buildCorsHeaders(),
        body: "",
      };
    }

    if (request.pathname === "/api/health" && request.method === "GET") {
      return buildJsonResponse(200, jsonEnvelope({ status: "ok" }));
    }

    if (request.pathname === "/api/tasks" && request.method === "POST") {
      const payload = parseJsonBody<CreateTaskRequest>(request);
      return buildJsonResponse(201, jsonEnvelope(this.createTask(payload)));
    }

    if (request.pathname.startsWith("/api/tasks/") && request.method === "GET") {
      const taskId = extractTaskId(request.pathname, "");
      return buildJsonResponse(200, jsonEnvelope(this.getTask(taskId)));
    }

    if (
      request.pathname.startsWith("/api/tasks/") &&
      request.pathname.endsWith("/cancel") &&
      request.method === "POST"
    ) {
      const taskId = extractTaskId(request.pathname, "/cancel");
      const payload = parseJsonBody<{ reason?: string }>(request);
      return buildJsonResponse(200, jsonEnvelope(this.cancelTask(taskId, payload.reason)));
    }

    if (request.pathname === "/api/ext/tasks/next" && request.method === "GET") {
      const waitMs = Math.max(
        0,
        Math.min(
          30000,
          parseInt(String(request.query.waitMs || "0"), 10) || 0,
        ),
      );
      const payload: ClaimNextTaskResponse = {
        task: await this.taskStore.claimNextTaskOrWait(waitMs),
      };
      return buildJsonResponse(200, jsonEnvelope(payload));
    }

    if (
      request.pathname.startsWith("/api/ext/tasks/") &&
      request.pathname.endsWith("/status") &&
      request.method === "POST"
    ) {
      const taskId = extractTaskId(request.pathname, "/status");
      const payload = parseJsonBody<ReportTaskStatusRequest>(request);
      return buildJsonResponse(
        200,
        jsonEnvelope(this.taskStore.updateStatus(taskId, payload)),
      );
    }

    if (
      request.pathname.startsWith("/api/ext/tasks/") &&
      request.pathname.endsWith("/result") &&
      request.method === "POST"
    ) {
      const taskId = extractTaskId(request.pathname, "/result");
      const payload = parseJsonBody<ReportTaskResultRequest>(request);
      return buildJsonResponse(
        200,
        jsonEnvelope(this.taskStore.completeTask(taskId, payload)),
      );
    }

    if (
      request.pathname.startsWith("/api/ext/tasks/") &&
      request.pathname.endsWith("/fail") &&
      request.method === "POST"
    ) {
      const taskId = extractTaskId(request.pathname, "/fail");
      const payload = parseJsonBody<ReportTaskFailureRequest>(request);
      return buildJsonResponse(
        200,
        jsonEnvelope(this.taskStore.failTask(taskId, payload)),
      );
    }

    if (
      request.pathname.startsWith("/api/ext/tasks/") &&
      request.pathname.endsWith("/pdf") &&
      request.method === "GET"
    ) {
      const taskId = extractTaskId(request.pathname, "/pdf");
      const task = this.getTask(taskId);
      if (!task.pdfPath) {
        return buildJsonResponse(
          404,
          jsonError("PDF_NOT_FOUND", "PDF not found"),
        );
      }
      const bytes = new Uint8Array(await IOUtils.read(task.pdfPath));
      return buildBinaryResponse(200, "application/pdf", bytes);
    }

    return buildJsonResponse(
      404,
      jsonError("INVALID_REQUEST", "Endpoint not found"),
    );
  }

  private readonly listener = {
    onSocketAccepted: async (_socket: nsIServerSocket, transport: nsISocketTransport) => {
      this.activeTransports.add(transport);
      let input: nsIInputStream | null = null;
      let output: nsIOutputStream | null = null;
      try {
        input = transport.openInputStream(0, 0, 0);
        output = transport.openOutputStream(0, 0, 0);
        const requestText = await this.readRequestText(input);
        if (!requestText.trim()) {
          return;
        }
        const request = parseHttpRequest(requestText);
        const response = await this.routeRequest(request);
        this.sendResponse(output, response);
      } catch (error: any) {
        ztoolkit.log(`${LOG_PREFIX} request failed`, error);
        if (output) {
          try {
            this.sendResponse(
              output,
              buildJsonResponse(
                500,
                jsonError(
                  normalizeErrorCode(error?.bridgeCode),
                  error?.message || "Internal error",
                ),
              ),
            );
          } catch {
            // ignore
          }
        }
      } finally {
        this.activeTransports.delete(transport);
        try {
          output?.close();
        } catch {
          // ignore
        }
        try {
          input?.close();
        } catch {
          // ignore
        }
      }
    },
    onStopListening: (_socket: nsIServerSocket, _status: nsresult) => {
      this.isRunning = false;
    },
  };
}
