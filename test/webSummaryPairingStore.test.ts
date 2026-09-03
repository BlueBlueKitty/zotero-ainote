import { assert } from "chai";
import {
  PairingPersistence,
  StoredPairing,
  WebSummaryPairingStore,
} from "../src/modules/webSummaryPairingStore";
import {
  CreatePairingRequest,
  WEB_SUMMARY_PROTOCOL_VERSION,
  WEB_SUMMARY_REQUIRED_CAPABILITIES,
} from "../src/modules/webSummaryTypes";

class MemoryPairingPersistence implements PairingPersistence {
  public value: StoredPairing | null = null;
  load(): StoredPairing | null {
    return this.value;
  }
  save(value: StoredPairing): void {
    this.value = JSON.parse(JSON.stringify(value)) as StoredPairing;
  }
  clear(): void {
    this.value = null;
  }
}

function identity(
  installId = "install-a",
  overrides: Partial<CreatePairingRequest> = {},
): CreatePairingRequest {
  return {
    installId,
    extensionVersion: "0.2.0",
    protocolVersion: WEB_SUMMARY_PROTOCOL_VERSION,
    browser: "chrome",
    capabilities: [...WEB_SUMMARY_REQUIRED_CAPABILITIES],
    ...overrides,
  };
}

describe("webSummaryPairingStore", function () {
  let now: number;
  let sequence: number;
  let persistence: MemoryPairingPersistence;
  let store: WebSummaryPairingStore;

  beforeEach(function () {
    now = Date.parse("2026-09-02T00:00:00.000Z");
    sequence = 0;
    persistence = new MemoryPairingPersistence();
    store = new WebSummaryPairingStore(persistence, {
      now: () => now,
      randomId: () => `request-${++sequence}`,
      randomToken: () => `token-${"a".repeat(64)}-${sequence}`,
      requestTtlMs: 2_000,
      requestCooldownMs: 1_000,
    });
  });

  it("accepts a pairing request without a user-opened window", function () {
    const request = store.createPairingRequest(identity());

    assert.equal(request.status, "pending");
    assert.equal(Date.parse(request.expiresAt) - now, 2_000);
  });

  it("rejects protocol and capability mismatches", function () {
    assert.throws(
      () =>
        store.createPairingRequest(
          identity("install-a", { protocolVersion: 999 }),
        ),
      "Protocol version mismatch",
    );
    assert.throws(
      () =>
        store.createPairingRequest(identity("install-a", { capabilities: [] })),
      "Missing required capabilities",
    );
  });

  it("persists an approved executor and authenticates its token", function () {
    const request = store.createPairingRequest(identity());
    store.approvePairingRequest(request.requestId);
    const pairing = store.getPairingStatus(request.requestId);

    assert.equal(pairing.request.status, "approved");
    assert.isString(pairing.token);
    const executor = store.authenticate(
      pairing.token!,
      "install-a",
      WEB_SUMMARY_PROTOCOL_VERSION,
    );
    assert.equal(executor.installId, "install-a");
    assert.equal(
      store.getPairingStatus(request.requestId).request.status,
      "delivered",
    );
    assert.isUndefined(store.getPairingStatus(request.requestId).token);
    assert.equal(persistence.value?.executor.installId, "install-a");
  });

  it("reports an approved extension offline after its last heartbeat expires without losing pairing", function () {
    store = new WebSummaryPairingStore(persistence, {
      now: () => now,
      randomId: () => `request-${++sequence}`,
      randomToken: () => `token-${"a".repeat(64)}-${sequence}`,
      requestTtlMs: 2_000,
      requestCooldownMs: 1_000,
      executorOnlineTtlMs: 5_000,
    });
    const request = store.createPairingRequest(identity());
    store.approvePairingRequest(request.requestId);
    const token = store.getPairingStatus(request.requestId).token!;

    assert.isFalse(store.getStatus().extensionOnline);
    store.authenticate(token, "install-a", WEB_SUMMARY_PROTOCOL_VERSION);
    assert.isTrue(store.getStatus().extensionOnline);

    now += 5_001;
    assert.isTrue(store.getStatus().paired);
    assert.isFalse(store.getStatus().extensionOnline);
  });

  it("revokes the previous executor when a new install is approved", function () {
    const first = store.createPairingRequest(identity("install-a"));
    store.approvePairingRequest(first.requestId);
    const firstToken = store.getPairingStatus(first.requestId).token!;

    now += 1_001;
    const second = store.createPairingRequest(identity("install-b"));
    store.approvePairingRequest(second.requestId);
    const secondToken = store.getPairingStatus(second.requestId).token!;

    assert.throws(
      () =>
        store.authenticate(
          firstToken,
          "install-a",
          WEB_SUMMARY_PROTOCOL_VERSION,
        ),
      "Unauthorized",
    );
    assert.equal(
      store.authenticate(secondToken, "install-b", WEB_SUMMARY_PROTOCOL_VERSION)
        .installId,
      "install-b",
    );
  });

  it("expires pending requests after their request TTL", function () {
    const request = store.createPairingRequest(identity());
    now += 2_001;

    assert.equal(
      store.getPairingStatus(request.requestId).request.status,
      "expired",
    );
    assert.throws(
      () => store.approvePairingRequest(request.requestId),
      "already expired",
    );
  });

  it("reuses one pending request and rejects a competing install", function () {
    const first = store.createPairingRequest(identity("install-a"));
    const retry = store.createPairingRequest(identity("install-a"));

    assert.equal(retry.requestId, first.requestId);
    assert.throws(
      () => store.createPairingRequest(identity("install-b")),
      "Another pairing request is already pending",
    );
  });

  it("rate limits a new request from the same install", function () {
    const first = store.createPairingRequest(identity("install-a"));
    store.rejectPairingRequest(first.requestId);

    assert.throws(
      () => store.createPairingRequest(identity("install-a")),
      "temporarily rate limited",
    );
    now += 1_001;
    const second = store.createPairingRequest(identity("install-a"));
    assert.notEqual(second.requestId, first.requestId);
  });

  it("applies the cooldown across different installs", function () {
    const first = store.createPairingRequest(identity("install-a"));
    store.rejectPairingRequest(first.requestId);

    assert.throws(
      () => store.createPairingRequest(identity("install-b")),
      "temporarily rate limited",
    );
  });

  it("supports explicit revocation", function () {
    const request = store.createPairingRequest(identity());
    store.approvePairingRequest(request.requestId);
    const token = store.getPairingStatus(request.requestId).token!;
    store.revoke();

    assert.isNull(persistence.value);
    assert.throws(
      () =>
        store.authenticate(token, "install-a", WEB_SUMMARY_PROTOCOL_VERSION),
      "Unauthorized",
    );
  });
});
