import { assert } from "chai";
import {
  normalizeDetailHeadingLevels,
  showSummaryManagerAlert,
} from "../src/modules/summaryManagerWindow";

describe("summaryManagerWindow", function () {
  before(function () {
    if (typeof DOMParser !== "undefined") {
      return;
    }

    const mainWindow = Zotero.getMainWindows()[0] as Window | undefined;
    if (mainWindow?.DOMParser) {
      // @ts-expect-error provide DOMParser for test runtime
      globalThis.DOMParser = mainWindow.DOMParser;
    }
  });

  it("should keep heading levels unchanged when content already starts at h1", function () {
    const input = "<h1>Summary</h1><h2>Background</h2><p>Body</p>";

    const result = normalizeDetailHeadingLevels(input);

    assert.equal(result, input);
  });

  it("should promote all headings together when content starts at h2", function () {
    const input = "<h2>Summary</h2><h3>Background</h3><h4>Methods</h4>";

    const result = normalizeDetailHeadingLevels(input);

    assert.equal(result, "<h1>Summary</h1><h2>Background</h2><h3>Methods</h3>");
  });

  it("should promote all headings together when content starts at h3", function () {
    const input = "<h3>Summary</h3><p>Body</p><h4>Background</h4>";

    const result = normalizeDetailHeadingLevels(input);

    assert.equal(result, "<h1>Summary</h1><p>Body</p><h2>Background</h2>");
  });

  it("should preserve heading attributes and child nodes during promotion", function () {
    const input =
      '<h3 class="section-title" data-id="intro"><strong>Summary</strong> \\(x+y\\)</h3>';

    const result = normalizeDetailHeadingLevels(input);

    assert.equal(
      result,
      '<h1 class="section-title" data-id="intro"><strong>Summary</strong> \\(x+y\\)</h1>',
    );
  });

  it("should leave content without headings unchanged", function () {
    const input = "<p>Plain text</p><ul><li>Item</li></ul>";

    const result = normalizeDetailHeadingLevels(input);

    assert.equal(result, input);
  });

  it("should prefer native alert for summary-manager errors", function () {
    const originalServices = (globalThis as any).Services;
    const calls: Array<{ win: Window | undefined; title: string; message: string }> = [];

    (globalThis as any).Services = {
      prompt: {
        alert(win: Window | undefined, title: string, message: string) {
          calls.push({ win, title, message });
        },
      },
    };

    try {
      showSummaryManagerAlert("note missing");
    } finally {
      (globalThis as any).Services = originalServices;
    }

    assert.deepEqual(calls, [
      { win: undefined, title: "AiNote", message: "note missing" },
    ]);
  });

  it("should fall back to window alert when native prompt is unavailable", function () {
    const originalServices = (globalThis as any).Services;
    const alertCalls: string[] = [];
    const fakeWindow = {
      alert(message: string) {
        alertCalls.push(message);
      },
    } as unknown as Window;

    try {
      (globalThis as any).Services = undefined;
      showSummaryManagerAlert("note deleted", fakeWindow);
    } finally {
      (globalThis as any).Services = originalServices;
    }

    assert.deepEqual(alertCalls, ["note deleted"]);
  });
});
