import { expect } from "chai";
import {
  isActiveTask,
  isHistoryTask,
  sortActiveTasks,
  sortHistoryTasks,
} from "../src/modules/summaryTaskPartition";
import { isTerminalStatus, SummaryTask } from "../src/modules/summaryTaskTypes";

function makeTask(
  id: string,
  status: SummaryTask["status"],
  createdAt: number,
  updatedAt = createdAt,
  finishedAt?: number,
): SummaryTask {
  return {
    id,
    kind: "api",
    itemID: Number(id.replace(/\D/g, "") || 1),
    title: id,
    status,
    content: "",
    createdAt,
    updatedAt,
    finishedAt,
  };
}

describe("summaryTaskTypes", function () {
  it("should detect terminal statuses", function () {
    expect(isTerminalStatus("completed")).to.equal(true);
    expect(isTerminalStatus("failed")).to.equal(true);
    expect(isTerminalStatus("cancelled")).to.equal(true);
    expect(isTerminalStatus("pending")).to.equal(false);
    expect(isTerminalStatus("running")).to.equal(false);
  });

  it("should classify active and history tasks", function () {
    expect(isActiveTask(makeTask("r", "running", 1))).to.equal(true);
    expect(isActiveTask(makeTask("p", "pending", 1))).to.equal(true);
    expect(isActiveTask(makeTask("f", "failed", 1))).to.equal(true);
    expect(isActiveTask(makeTask("c", "cancelled", 1))).to.equal(true);
    expect(isActiveTask(makeTask("d", "completed", 1))).to.equal(false);

    expect(isHistoryTask(makeTask("d", "completed", 1))).to.equal(true);
    expect(isHistoryTask(makeTask("f", "failed", 1))).to.equal(false);
  });

  it("should sort active tasks by running, pending, handled", function () {
    const tasks = [
      makeTask("f1", "failed", 10, 20),
      makeTask("p2", "pending", 2, 2),
      makeTask("r1", "running", 1, 5),
      makeTask("p1", "pending", 1, 1),
      makeTask("c1", "cancelled", 9, 21),
      makeTask("r2", "running", 3, 6),
    ];
    const sorted = sortActiveTasks(tasks);
    expect(sorted.map((task) => task.id)).to.deep.equal([
      "r1",
      "r2",
      "p1",
      "p2",
      "c1",
      "f1",
    ]);
  });

  it("should sort history tasks by finishedAt desc", function () {
    const tasks = [
      makeTask("c1", "completed", 1, 2, 100),
      makeTask("c2", "completed", 1, 2, 120),
      makeTask("f1", "failed", 1, 2, 150),
    ];
    const sorted = sortHistoryTasks(tasks);
    expect(sorted.map((task) => task.id)).to.deep.equal(["c2", "c1"]);
  });
});
