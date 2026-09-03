import { assert } from "chai";
import { removeLinkedWebTask } from "../src/modules/summaryTaskManager";

describe("summary task bridge cleanup", function () {
  it("removes a running linked web task after canceling it", async function () {
    const calls: string[] = [];
    const previousAddon = (globalThis as any).addon;
    (globalThis as any).addon = {
      data: {
        webSummaryBridge: {
          cancelTask: async () => {
            calls.push("cancel");
            return {};
          },
          removeTask: async () => {
            calls.push("remove");
            return {};
          },
        },
      },
    };

    try {
      await removeLinkedWebTask({
        id: "local-1",
        kind: "web",
        itemID: 1,
        title: "Running task",
        status: "running",
        content: "",
        webTaskId: "bridge-1",
        createdAt: 0,
        updatedAt: 0,
      });
      assert.deepEqual(calls, ["cancel", "remove"]);
    } finally {
      (globalThis as any).addon = previousAddon;
    }
  });
});
