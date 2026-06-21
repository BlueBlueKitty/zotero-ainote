import { assert } from "chai";
import {
  getWebSummaryChatGPTModeLabel,
  normalizeWebSummaryChatGPTMode,
} from "../src/modules/webSummaryTypes";
import { getWebSummaryModelLabel } from "../src/modules/webSummaryWorkflow";

describe("webSummaryChatGPTMode", function () {
  it("should normalize legacy and new mode values", function () {
    assert.equal(normalizeWebSummaryChatGPTMode("instant"), "fast");
    assert.equal(normalizeWebSummaryChatGPTMode("thinking"), "advanced");
    assert.equal(normalizeWebSummaryChatGPTMode("balanced"), "balanced");
    assert.equal(normalizeWebSummaryChatGPTMode(""), "advanced");
  });

  it("should render updated mode labels for note metadata", function () {
    assert.equal(getWebSummaryChatGPTModeLabel("fast"), "Fast");
    assert.equal(getWebSummaryModelLabel("balanced"), "ChatGPT Web (Balanced)");
    assert.equal(getWebSummaryModelLabel("advanced"), "ChatGPT Web (Advanced)");
  });
});
