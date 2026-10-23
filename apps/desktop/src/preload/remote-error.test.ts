import { describe, expect, it } from "vitest";
import { remoteError } from "./remote-error.js";

const wrapped = (inner: string) =>
  new Error(`Error invoking remote method 'zhiyin:condense-now': ${inner}`);

describe("an error from the core, as the window receives it", () => {
  it("reads as the core's own words, without Electron's wrapping", () => {
    expect(
      remoteError(wrapped("VisibleError: there is nothing old enough yet.")),
    ).toHaveProperty("message", "there is nothing old enough yet.");
    expect(
      remoteError(wrapped("Error: The task does not exist.")),
    ).toHaveProperty("message", "The task does not exist.");
  });

  it("keeps a message that spans lines whole", () => {
    expect(
      remoteError(wrapped("VisibleError: First line.\nSecond line.")),
    ).toHaveProperty("message", "First line.\nSecond line.");
  });

  it("leaves an error Electron did not wrap as it is", () => {
    const plain = new Error("Something else.");
    expect(remoteError(plain)).toBe(plain);
    expect(remoteError("not an error")).toBe("not an error");
  });
});
