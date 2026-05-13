import { expect } from "chai";
import { isTerminalStatus } from "../src/modules/summaryTaskTypes";

describe("summaryTaskTypes", function () {
  it("should detect terminal statuses", function () {
    expect(isTerminalStatus("completed")).to.equal(true);
    expect(isTerminalStatus("failed")).to.equal(true);
    expect(isTerminalStatus("cancelled")).to.equal(true);
    expect(isTerminalStatus("interrupted")).to.equal(true);
    expect(isTerminalStatus("pending")).to.equal(false);
    expect(isTerminalStatus("running")).to.equal(false);
  });
});
