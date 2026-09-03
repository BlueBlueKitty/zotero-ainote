import { assert } from "chai";
import { WebSummaryTaskStore } from "../src/modules/webSummaryTaskStore";
import { CreateTaskRequest } from "../src/modules/webSummaryTypes";

function makeRequest(
  itemId: number,
  actionType: CreateTaskRequest["actionType"] = "summarize",
): CreateTaskRequest {
  return {
    itemId,
    libraryId: 1,
    title: `Paper ${itemId}`,
    platform: "chatgpt",
    actionType,
    pdfFileName: `paper-${itemId}.pdf`,
    prompt: "summarize",
    projectUrl: "https://chatgpt.com/g/g-p-project/project",
  };
}

describe("webSummaryTaskStore", function () {
  let now: number;
  let sequence: number;
  let store: WebSummaryTaskStore;

  beforeEach(function () {
    now = Date.parse("2026-09-02T00:00:00.000Z");
    sequence = 0;
    store = new WebSummaryTaskStore({
      now: () => now,
      randomId: () => `id-${++sequence}`,
      leaseDurationMs: 1_000,
    });
  });

  it("leases queued tasks serially in creation order", function () {
    const first = store.createTask(makeRequest(1));
    store.createTask(makeRequest(2));

    const claimed = store.claimNextTask("install-a");

    assert.equal(claimed?.taskId, first.taskId);
    assert.equal(claimed?.status, "leased");
    assert.equal(claimed?.stage, "claimed");
    assert.equal(claimed?.lease?.executorInstallId, "install-a");
    assert.isNull(store.claimNextTask("install-a"));
  });

  it("rejects a lease owned by another executor", function () {
    store.createTask(makeRequest(1));
    const claimed = store.claimNextTask("install-a")!;

    assert.throws(
      () =>
        store.reportEvent(
          claimed.taskId,
          {
            requestId: "request-1",
            leaseId: claimed.lease!.leaseId,
            stage: "preparing_page",
          },
          "install-b",
        ),
      "Task lease does not match",
    );
  });

  it("accepts monotonic stages and rejects stage regression", function () {
    store.createTask(makeRequest(1));
    const claimed = store.claimNextTask("install-a")!;
    const leaseId = claimed.lease!.leaseId;
    store.reportEvent(
      claimed.taskId,
      { requestId: "request-1", leaseId, stage: "uploading_pdf" },
      "install-a",
    );

    assert.throws(
      () =>
        store.reportEvent(
          claimed.taskId,
          { requestId: "request-2", leaseId, stage: "preparing_page" },
          "install-a",
        ),
      "Invalid task stage transition",
    );
  });

  it("does not turn a pre-send page URL into the retry target", function () {
    store.createTask(makeRequest(1));
    const claimed = store.claimNextTask("install-a")!;
    const leaseId = claimed.lease!.leaseId;

    store.reportEvent(
      claimed.taskId,
      {
        requestId: "request-page",
        leaseId,
        stage: "preparing_page",
        conversationUrl: "https://chatgpt.com/c/old-conversation",
      },
      "install-a",
    );

    assert.isUndefined(store.getTask(claimed.taskId)?.existingConversationUrl);

    const sent = store.reportEvent(
      claimed.taskId,
      {
        requestId: "request-sent",
        leaseId,
        stage: "prompt_sent",
        conversationUrl: "https://chatgpt.com/c/new-conversation",
      },
      "install-a",
    );

    assert.equal(
      sent.existingConversationUrl,
      "https://chatgpt.com/c/new-conversation",
    );
  });

  it("treats repeated request IDs as idempotent", function () {
    store.createTask(makeRequest(1));
    const claimed = store.claimNextTask("install-a")!;
    const request = {
      requestId: "request-1",
      leaseId: claimed.lease!.leaseId,
      stage: "preparing_page" as const,
    };

    const first = store.reportEvent(claimed.taskId, request, "install-a");
    now += 500;
    const repeated = store.reportEvent(claimed.taskId, request, "install-a");

    assert.deepEqual(repeated, first);
  });

  it("requeues an expired lease before prompt submission", function () {
    const task = store.createTask(makeRequest(1));
    const firstLease = store.claimNextTask("install-a")!;
    now += 1_001;

    const reclaimed = store.claimNextTask("install-a");

    assert.equal(reclaimed?.taskId, task.taskId);
    assert.notEqual(reclaimed?.lease?.leaseId, firstLease.lease?.leaseId);
    assert.equal(reclaimed?.sendState, "not_sent");
  });

  it("fails an expired lease after prompt submission without replaying", function () {
    store.createTask(makeRequest(1));
    const claimed = store.claimNextTask("install-a")!;
    store.reportEvent(
      claimed.taskId,
      {
        requestId: "request-sent",
        leaseId: claimed.lease!.leaseId,
        stage: "prompt_sent",
      },
      "install-a",
    );
    now += 1_001;

    store.expireLeases();
    const failed = store.getTask(claimed.taskId)!;

    assert.equal(failed.status, "failed");
    assert.equal(failed.sendState, "unknown");
    assert.equal(failed.errorCode, "SEND_STATE_UNKNOWN");
    assert.isNull(store.claimNextTask("install-a"));
  });

  it("does not accept a summary result before prompt submission", function () {
    store.createTask(makeRequest(1));
    const claimed = store.claimNextTask("install-a")!;

    assert.throws(
      () =>
        store.completeTask(
          claimed.taskId,
          {
            requestId: "request-result",
            leaseId: claimed.lease!.leaseId,
            resultMarkdown: "done",
          },
          "install-a",
        ),
      "before the prompt is sent",
    );
  });

  it("persists result and conversation metadata after prompt submission", function () {
    store.createTask(makeRequest(1));
    const claimed = store.claimNextTask("install-a")!;
    const leaseId = claimed.lease!.leaseId;
    store.reportEvent(
      claimed.taskId,
      { requestId: "request-sent", leaseId, stage: "prompt_sent" },
      "install-a",
    );
    const completed = store.completeTask(
      claimed.taskId,
      {
        requestId: "request-result",
        leaseId,
        resultMarkdown: "# Summary",
        conversationId: "cid-1",
        conversationUrl: "https://chatgpt.com/c/cid-1",
        conversationTitle: "Paper 1",
      },
      "install-a",
    );

    assert.equal(completed.status, "succeeded");
    assert.equal(completed.resultMarkdown, "# Summary");
    assert.equal(completed.conversationMeta?.conversationId, "cid-1");
    assert.isUndefined(completed.lease);
  });

  it("allows an open-conversation command to complete without sending", function () {
    store.createTask(makeRequest(1, "open_conversation"));
    const claimed = store.claimNextTask("install-a")!;
    const completed = store.completeTask(
      claimed.taskId,
      {
        requestId: "request-result",
        leaseId: claimed.lease!.leaseId,
        resultMarkdown: "",
      },
      "install-a",
    );

    assert.equal(completed.status, "succeeded");
  });

  it("wakes a long-poll waiter when a task is created", async function () {
    const waiting = store.claimNextTaskOrWait(200, "install-a");
    setTimeout(() => store.createTask(makeRequest(3)), 20);

    const claimed = await waiting;

    assert.equal(claimed?.status, "leased");
    assert.equal(claimed?.itemId, 3);
  });

  it("cancels an active task immediately and invalidates its lease", function () {
    store.createTask(makeRequest(1));
    const claimed = store.claimNextTask("install-a")!;

    const canceled = store.requestCancel(claimed.taskId, "用户停止");

    assert.equal(canceled.status, "canceled");
    assert.equal(canceled.errorMessage, "用户停止");
    assert.isUndefined(canceled.lease);
  });

  it("notifies task listeners for lease and stage changes", function () {
    const task = store.createTask(makeRequest(1));
    const updates: string[] = [];
    const unsubscribe = store.subscribeTask(task.taskId, (next) => {
      updates.push(`${next.status}:${next.stage || "none"}`);
    });
    const claimed = store.claimNextTask("install-a")!;
    store.reportEvent(
      task.taskId,
      {
        requestId: "request-1",
        leaseId: claimed.lease!.leaseId,
        stage: "preparing_page",
      },
      "install-a",
    );
    unsubscribe();

    assert.deepEqual(updates, ["leased:claimed", "leased:preparing_page"]);
  });
});
