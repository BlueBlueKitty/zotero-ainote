import {
  BridgeErrorCode,
  CreatePairingRequest,
  PairingRequest,
  PairingStatusResponse,
  WebSummaryBridgeStatus,
  WebSummaryPairedExecutor,
  WEB_SUMMARY_PAIRING_REQUEST_COOLDOWN_MS,
  WEB_SUMMARY_PAIRING_REQUEST_TTL_MS,
  WEB_SUMMARY_EXTENSION_ONLINE_TTL_MS,
  WEB_SUMMARY_PROTOCOL_VERSION,
  WEB_SUMMARY_REQUIRED_CAPABILITIES,
} from "./webSummaryTypes";

export interface StoredPairing {
  token: string;
  executor: WebSummaryPairedExecutor;
}

export interface PairingPersistence {
  load(): StoredPairing | null;
  save(value: StoredPairing): void;
  clear(): void;
}

export interface PairingStoreOptions {
  now?: () => number;
  randomId?: () => string;
  randomToken?: () => string;
  requestTtlMs?: number;
  requestCooldownMs?: number;
  executorOnlineTtlMs?: number;
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

function defaultToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join(
    "",
  );
}

function constantTimeEqual(left: string, right: string): boolean {
  const maxLength = Math.max(left.length, right.length);
  let mismatch = left.length ^ right.length;
  for (let index = 0; index < maxLength; index += 1) {
    mismatch |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return mismatch === 0;
}

export class WebSummaryPairingStore {
  private pendingRequest: PairingRequest | null = null;
  private pendingToken: string | null = null;
  private activePairing: StoredPairing | null;
  private lastRequestAt = 0;
  private readonly now: () => number;
  private readonly randomId: () => string;
  private readonly randomToken: () => string;
  private readonly requestTtlMs: number;
  private readonly requestCooldownMs: number;
  private readonly executorOnlineTtlMs: number;

  constructor(
    private readonly persistence: PairingPersistence,
    options: PairingStoreOptions = {},
  ) {
    this.now = options.now || (() => Date.now());
    this.randomId = options.randomId || (() => crypto.randomUUID());
    this.randomToken = options.randomToken || defaultToken;
    this.requestTtlMs = Math.max(
      1_000,
      options.requestTtlMs ?? WEB_SUMMARY_PAIRING_REQUEST_TTL_MS,
    );
    this.requestCooldownMs = Math.max(
      0,
      options.requestCooldownMs ?? WEB_SUMMARY_PAIRING_REQUEST_COOLDOWN_MS,
    );
    this.executorOnlineTtlMs = Math.max(
      1_000,
      options.executorOnlineTtlMs ?? WEB_SUMMARY_EXTENSION_ONLINE_TTL_MS,
    );
    this.activePairing = persistence.load();
  }

  public createPairingRequest(payload: CreatePairingRequest): PairingRequest {
    this.expirePendingRequestIfNeeded();
    this.validateIdentity(payload);
    const now = this.now();
    if (this.pendingRequest?.status === "pending") {
      if (this.pendingRequest.installId === payload.installId) {
        return this.cloneRequest(this.pendingRequest);
      }
      throw bridgeError(
        "INVALID_REQUEST",
        "Another pairing request is already pending",
      );
    }
    if (
      this.lastRequestAt &&
      now < this.lastRequestAt + this.requestCooldownMs
    ) {
      throw bridgeError(
        "INVALID_REQUEST",
        "Pairing requests are temporarily rate limited",
      );
    }
    const request: PairingRequest = {
      ...payload,
      capabilities: [...new Set(payload.capabilities.map(String))],
      requestId: this.randomId(),
      requestedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + this.requestTtlMs).toISOString(),
      status: "pending",
    };
    this.pendingRequest = request;
    this.pendingToken = null;
    this.lastRequestAt = now;
    return this.cloneRequest(request);
  }

  public getPairingStatus(requestId: string): PairingStatusResponse {
    this.expirePendingRequestIfNeeded();
    const request = this.requireRequest(requestId);
    return {
      request: this.cloneRequest(request),
      token:
        request.status === "approved"
          ? this.pendingToken || undefined
          : undefined,
    };
  }

  public approvePairingRequest(requestId: string): WebSummaryBridgeStatus {
    this.expirePendingRequestIfNeeded();
    const request = this.requireRequest(requestId);
    if (request.status !== "pending") {
      throw bridgeError(
        "INVALID_REQUEST",
        `Pairing request is already ${request.status}`,
      );
    }
    this.validateIdentity(request);
    const now = this.now();
    const token = this.randomToken();
    if (token.length < 32) {
      throw bridgeError(
        "INTERNAL_ERROR",
        "Generated pairing token is too short",
      );
    }
    const executor: WebSummaryPairedExecutor = {
      installId: request.installId,
      extensionVersion: request.extensionVersion,
      protocolVersion: request.protocolVersion,
      browser: request.browser,
      capabilities: [...request.capabilities],
      pairedAt: new Date(now).toISOString(),
    };
    this.activePairing = { token, executor };
    this.persistence.save(this.activePairing);
    request.status = "approved";
    this.pendingToken = token;
    return this.getStatus();
  }

  public rejectPairingRequest(
    requestId: string,
    reason = "用户拒绝了扩展配对",
  ): WebSummaryBridgeStatus {
    const request = this.requireRequest(requestId);
    request.status = "rejected";
    request.rejectionReason = reason;
    this.pendingToken = null;
    return this.getStatus();
  }

  public authenticate(
    token: string,
    installId: string,
    protocolVersion: number,
  ): WebSummaryPairedExecutor {
    const pairing = this.activePairing;
    if (
      !pairing ||
      !token ||
      !constantTimeEqual(pairing.token, token) ||
      pairing.executor.installId !== installId
    ) {
      throw bridgeError("UNAUTHORIZED", "Unauthorized");
    }
    if (protocolVersion !== WEB_SUMMARY_PROTOCOL_VERSION) {
      throw bridgeError("PROTOCOL_MISMATCH", "Protocol version mismatch");
    }
    pairing.executor.lastSeenAt = new Date(this.now()).toISOString();
    this.persistence.save(pairing);
    if (
      this.pendingRequest?.installId === installId &&
      this.pendingRequest.status === "approved"
    ) {
      this.pendingRequest.status = "delivered";
      this.pendingToken = null;
    }
    return {
      ...pairing.executor,
      capabilities: [...pairing.executor.capabilities],
    };
  }

  public revoke(): WebSummaryBridgeStatus {
    this.activePairing = null;
    this.pendingToken = null;
    this.persistence.clear();
    return this.getStatus();
  }

  public isExecutorOnline(): boolean {
    const lastSeenAt = this.activePairing?.executor.lastSeenAt;
    if (!lastSeenAt) return false;
    const lastSeen = Date.parse(lastSeenAt);
    return (
      Number.isFinite(lastSeen) &&
      this.now() - lastSeen <= this.executorOnlineTtlMs
    );
  }

  public getStatus(running = true): WebSummaryBridgeStatus {
    this.expirePendingRequestIfNeeded();
    return {
      running,
      protocolVersion: WEB_SUMMARY_PROTOCOL_VERSION,
      paired: !!this.activePairing,
      extensionOnline: this.isExecutorOnline(),
      executor: this.activePairing
        ? {
            ...this.activePairing.executor,
            capabilities: [...this.activePairing.executor.capabilities],
          }
        : undefined,
      pendingPairingRequest: this.pendingRequest
        ? this.cloneRequest(this.pendingRequest)
        : undefined,
      updatedAt: new Date(this.now()).toISOString(),
    };
  }

  private validateIdentity(payload: CreatePairingRequest): void {
    if (
      typeof payload.installId !== "string" ||
      typeof payload.extensionVersion !== "string" ||
      !payload.installId.trim() ||
      !payload.extensionVersion.trim() ||
      payload.installId.length > 128 ||
      payload.extensionVersion.length > 64 ||
      !Array.isArray(payload.capabilities)
    ) {
      throw bridgeError("INVALID_REQUEST", "Extension identity is incomplete");
    }
    if (payload.protocolVersion !== WEB_SUMMARY_PROTOCOL_VERSION) {
      throw bridgeError("PROTOCOL_MISMATCH", "Protocol version mismatch");
    }
    const missing = WEB_SUMMARY_REQUIRED_CAPABILITIES.filter(
      (capability) => !payload.capabilities.includes(capability),
    );
    if (missing.length) {
      throw bridgeError(
        "REQUIRED_CAPABILITY_MISSING",
        `Missing required capabilities: ${missing.join(", ")}`,
      );
    }
    if (payload.browser !== "chrome" && payload.browser !== "edge") {
      throw bridgeError("INVALID_REQUEST", "Unsupported browser identity");
    }
  }

  private requireRequest(requestId: string): PairingRequest {
    if (!this.pendingRequest || this.pendingRequest.requestId !== requestId) {
      throw bridgeError(
        "PAIRING_REQUEST_NOT_FOUND",
        "Pairing request not found",
      );
    }
    return this.pendingRequest;
  }

  private expirePendingRequestIfNeeded(): void {
    if (
      this.pendingRequest?.status === "pending" &&
      Date.parse(this.pendingRequest.expiresAt) <= this.now()
    ) {
      this.pendingRequest.status = "expired";
      this.pendingToken = null;
    }
  }

  private cloneRequest(request: PairingRequest): PairingRequest {
    return { ...request, capabilities: [...request.capabilities] };
  }
}
