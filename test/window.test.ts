import { assert } from "chai";
import { showToast } from "../src/utils/window";

describe("window notifications", function () {
  it("falls back to the Zotero main-window alert when Notifier has no toast API", function () {
    const zotero = (globalThis as any).Zotero;
    const originalNotifier = zotero.Notifier;
    const originalGetMainWindow = zotero.getMainWindow;
    const messages: string[] = [];
    zotero.Notifier = {};
    zotero.getMainWindow = () => ({
      alert: (message: string) => messages.push(message),
    });
    try {
      showToast("pairing instructions", "info");
    } finally {
      zotero.Notifier = originalNotifier;
      zotero.getMainWindow = originalGetMainWindow;
    }
    assert.deepEqual(messages, ["pairing instructions"]);
  });
});
