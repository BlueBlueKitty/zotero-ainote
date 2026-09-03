import { assert } from "chai";
import { getWebSummaryModelLabel } from "../src/modules/webSummaryWorkflow";

describe("webSummaryModelLabel", function () {
  it("uses a stable label without automating a ChatGPT mode", function () {
    assert.equal(getWebSummaryModelLabel(), "ChatGPT Web");
  });
});
