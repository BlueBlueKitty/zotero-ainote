import { expect } from "chai";
import { formatLogDetails } from "../web-extension/debug.js";

describe("web extension debug formatting", () => {
  it("serializes bridge context instead of coercing it to [object Object]", () => {
    expect(
      formatLogDetails({ path: "/bridge/v2/pair/requests", status: 403 }),
    ).to.equal('{"path":"/bridge/v2/pair/requests","status":403}');
  });

  it("preserves useful Error text", () => {
    expect(formatLogDetails(new Error("bridge failed"))).to.match(
      /Error: bridge failed/,
    );
  });
});
