import { assert } from "chai";
import {
  getEditorItem,
  getEditorPopup,
  getEditorWindow,
  getFullTextAPI,
  getZoteroRuntimeInfo,
  parseZoteroVersion,
} from "../src/modules/zoteroCompat";

describe("zoteroCompat", function () {
  it("should parse complete and partial Zotero versions", function () {
    assert.deepEqual(parseZoteroVersion("10.0.1"), {
      version: "10.0.1",
      major: 10,
      minor: 0,
      patch: 1,
    });
    assert.deepEqual(parseZoteroVersion("9.0"), {
      version: "9.0",
      major: 9,
      minor: 0,
      patch: null,
    });
    assert.deepEqual(parseZoteroVersion("unknown"), {
      version: "unknown",
      major: null,
      minor: null,
      patch: null,
    });
  });

  it("should expose the running Zotero runtime version", function () {
    const runtime = getZoteroRuntimeInfo();
    assert.equal(runtime.version, Zotero.version);
    assert.equal(runtime.major, Number(Zotero.version.split(".")[0]));
  });

  it("should resolve Zotero's full-text API alias", function () {
    const fullText = getFullTextAPI();
    assert.isFunction(fullText.getIndexedState);
    assert.isFunction(fullText.indexItems);
    assert.isFunction(fullText.getItemCacheFile);
    assert.isNumber(fullText.INDEX_STATE_INDEXED);
  });

  it("should safely handle editors whose private fields are unavailable", function () {
    const editor = {} as Zotero.EditorInstance;
    assert.isNull(getEditorWindow(editor));
    assert.isNull(getEditorItem(editor));
    assert.isNull(getEditorPopup(editor));
  });
});
