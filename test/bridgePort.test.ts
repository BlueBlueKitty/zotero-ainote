import { expect } from "chai";
import {
  assertListeningProcessIdsAvailable,
  parseListeningProcessIds,
} from "../scripts/bridge-port.mjs";

describe("bridge port guard", () => {
  it("finds every Zotero process listening on the bridge port", () => {
    const output = [
      "  TCP    127.0.0.1:23123        0.0.0.0:0              LISTENING       34700",
      "  TCP    127.0.0.1:23123        0.0.0.0:0              LISTENING       76840",
      "  TCP    127.0.0.1:23123        127.0.0.1:17392        TIME_WAIT       0",
    ].join("\n");

    expect(parseListeningProcessIds(output)).to.deep.equal([34700, 76840]);
  });

  it("rejects a second process instead of allowing ambiguous routing", () => {
    expect(() => assertListeningProcessIdsAvailable([34700, 76840])).to.throw(
      "Conflicting PID(s): 34700, 76840",
    );
    let message = "";
    try {
      assertListeningProcessIdsAvailable([34700]);
    } catch (error) {
      message = String(error);
    }
    expect(message).to.include("Stop-Process -Id 34700");
    expect(message).to.include("taskkill /PID 34700 /T /F");
  });
});
