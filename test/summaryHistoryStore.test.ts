import { expect } from "chai";
import { SummaryHistoryStore } from "../src/modules/summaryHistoryStore";
import { SummaryTask } from "../src/modules/summaryTaskTypes";

function makeTask(id: string, status: SummaryTask["status"], updatedAt: number): SummaryTask {
  return {
    id,
    kind: "api",
    itemID: Number(id.replace(/\D/g, "") || 1),
    title: `task-${id}`,
    status,
    content: "",
    createdAt: updatedAt - 100,
    updatedAt,
  };
}

describe("summaryHistoryStore", function () {
  it("should keep all tasks when limit=0", function () {
    const tasks = [
      makeTask("1", "completed", 1),
      makeTask("2", "failed", 2),
      makeTask("3", "pending", 3),
    ];
    const pruned = SummaryHistoryStore.prune(tasks, 0);
    expect(pruned).to.have.length(3);
  });

  it("should prune oldest terminal tasks first", function () {
    const tasks = [
      makeTask("1", "completed", 1),
      makeTask("2", "failed", 2),
      makeTask("3", "pending", 3),
      makeTask("4", "running", 4),
      makeTask("5", "cancelled", 5),
    ];
    const pruned = SummaryHistoryStore.prune(tasks, 3);
    expect(pruned.map((t) => t.id)).to.deep.equal(["2", "3", "4", "5"]);
  });

  it("should prune only completed tasks", function () {
    const tasks = [
      makeTask("1", "completed", 1),
      makeTask("2", "completed", 2),
      makeTask("3", "failed", 3),
      makeTask("4", "cancelled", 4),
    ];
    const pruned = SummaryHistoryStore.prune(tasks, 2);
    expect(pruned.map((t) => t.id)).to.deep.equal(["3", "4"]);
  });
});
