import { assert } from "chai";
import { WebSummaryTaskStore } from "../src/modules/webSummaryTaskStore";
import {
  shouldFallbackToNewConversation,
  throwIfWebSummaryCanceled,
} from "../src/modules/webSummaryWorkflow";

describe("webSummaryTaskStore", function () {
  it("should create and claim queued tasks in order", function () {
    const store = new WebSummaryTaskStore();
    const first = store.createTask({
      itemId: 1,
      libraryId: 1,
      title: "Paper A",
      platform: "chatgpt",
      actionType: "summarize",
      conversationMode: "new-per-item",
    });
    store.createTask({
      itemId: 2,
      libraryId: 1,
      title: "Paper B",
      platform: "chatgpt",
      actionType: "summarize",
      conversationMode: "new-per-item",
    });

    const claimed = store.claimNextTask();
    assert.equal(claimed?.taskId, first.taskId);
    assert.equal(claimed?.status, "opening_chat");
  });

  it("should reject invalid status transitions", function () {
    const store = new WebSummaryTaskStore();
    const task = store.createTask({
      itemId: 1,
      libraryId: 1,
      title: "Paper A",
      platform: "chatgpt",
      actionType: "summarize",
      conversationMode: "new-per-item",
    });

    assert.throws(() => {
      store.completeTask(task.taskId, {
        clientId: "client-a",
        resultMarkdown: "done",
      });
    }, "Invalid task status transition");
  });

  it("should persist conversation metadata on success", function () {
    const store = new WebSummaryTaskStore();
    const task = store.createTask({
      itemId: 1,
      libraryId: 1,
      title: "Paper A",
      platform: "chatgpt",
      actionType: "summarize",
      conversationMode: "new-per-item",
    });

    store.claimNextTask();
    store.updateStatus(task.taskId, { status: "running" });
    const completed = store.completeTask(task.taskId, {
      resultMarkdown: "# Summary",
      conversationId: "cid-1",
      conversationUrl: "https://chatgpt.com/c/cid-1",
      conversationTitle: "Author-2024-Paper A",
      folderName: "文献总结",
      folderResolved: true,
    });

    assert.equal(completed.status, "succeeded");
    assert.equal(completed.conversationMeta?.conversationId, "cid-1");
    assert.equal(completed.resultMarkdown, "# Summary");
  });

  it("should allow status update after claim under new contract", function () {
    const store = new WebSummaryTaskStore();
    const task = store.createTask({
      itemId: 1,
      libraryId: 1,
      title: "Paper A",
      platform: "chatgpt",
      actionType: "summarize",
      conversationMode: "new-per-item",
    });
    store.claimNextTask();
    const updated = store.updateStatus(task.taskId, { status: "running" });
    assert.equal(updated.status, "running");
  });

  it("should detect recoverable conversation errors for fallback", function () {
    assert.isTrue(
      shouldFallbackToNewConversation(
        new Error("当前页面不是预期的历史会话"),
      ),
    );
    assert.isFalse(
      shouldFallbackToNewConversation(new Error("Bridge 离线，请检查端口")),
    );
  });

  it("should notify task listeners on status changes", function () {
    const store = new WebSummaryTaskStore();
    const task = store.createTask({
      itemId: 1,
      libraryId: 1,
      title: "Paper A",
      platform: "chatgpt",
      actionType: "summarize",
      conversationMode: "new-per-item",
    });
    const updates: string[] = [];
    const unsubscribe = store.subscribeTask(task.taskId, (nextTask) => {
      updates.push(nextTask.status);
    });

    store.claimNextTask();
    store.updateStatus(task.taskId, { status: "running" });
    unsubscribe();
    store.completeTask(task.taskId, { resultMarkdown: "done" });

    assert.deepEqual(updates, ["opening_chat", "running"]);
  });

  it("should wake long-poll waiters when tasks are created", async function () {
    const store = new WebSummaryTaskStore();
    const waitingTask = store.claimNextTaskOrWait(200);
    setTimeout(() => {
      store.createTask({
        itemId: 3,
        libraryId: 1,
        title: "Paper C",
        platform: "chatgpt",
        actionType: "summarize",
        conversationMode: "new-per-item",
      });
    }, 20);

    const claimed = await waitingTask;
    assert.isOk(claimed);
    assert.equal(claimed?.status, "opening_chat");
  });

  it("should remove tasks from the store completely", function () {
    const store = new WebSummaryTaskStore();
    const task = store.createTask({
      itemId: 9,
      libraryId: 1,
      title: "Paper Z",
      platform: "chatgpt",
      actionType: "summarize",
      conversationMode: "new-per-item",
    });

    const removed = store.removeTask(task.taskId);

    assert.equal(removed?.taskId, task.taskId);
    assert.isNull(store.getTask(task.taskId));
    assert.isNull(store.claimNextTask());
  });

  it("should emit a canceled snapshot when removing an active task", function () {
    const store = new WebSummaryTaskStore();
    const task = store.createTask({
      itemId: 10,
      libraryId: 1,
      title: "Paper Remove",
      platform: "chatgpt",
      actionType: "summarize",
      conversationMode: "new-per-item",
    });

    store.claimNextTask();
    const removed = store.removeTask(task.taskId);

    assert.equal(removed?.status, "canceled");
    assert.equal(removed?.errorMessage, "网页总结任务已从活动列表移除");
    assert.isNull(store.getTask(task.taskId));
  });

  it("should immediately cancel tasks that are still opening chat", function () {
    const store = new WebSummaryTaskStore();
    const task = store.createTask({
      itemId: 11,
      libraryId: 1,
      title: "Paper Cancel",
      platform: "chatgpt",
      actionType: "summarize",
      conversationMode: "new-per-item",
    });

    store.claimNextTask();
    const canceled = store.requestCancel(task.taskId, "用户停止");

    assert.equal(canceled.status, "canceled");
    assert.equal(canceled.errorMessage, "用户停止");
    assert.equal(store.getTask(task.taskId)?.status, "canceled");
  });

  it("should throw a canceled error before a bridge task exists", function () {
    assert.throws(() => {
      throwIfWebSummaryCanceled(true);
    }, "已停止当前条目的AI总结");
  });

  it("should not throw when submit-stage cancellation is not requested", function () {
    assert.doesNotThrow(() => {
      throwIfWebSummaryCanceled(false);
    });
  });

  it("should preserve a user-facing canceled message when wrapping submit-stage errors", function () {
    assert.throws(() => {
      throwIfWebSummaryCanceled(true);
    }, "已停止当前条目的AI总结");
  });
});
