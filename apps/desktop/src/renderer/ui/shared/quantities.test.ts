import { describe, expect, it } from "vitest";
import { elapsedTime, fileSize } from "./quantities.js";

describe("a file size", () => {
  it("is written in bytes, then whole kilobytes, then megabytes to a tenth", () => {
    expect(fileSize(1)).toBe("1 byte");
    expect(fileSize(240)).toBe("240 bytes");
    expect(fileSize(1_536)).toBe("2 KB");
    expect(fileSize(48_128)).toBe("47 KB");
    expect(fileSize(10 * 1024 * 1024)).toBe("10.0 MB");
    expect(fileSize(22_463_684)).toBe("21.4 MB");
  });
});

describe("a length of time", () => {
  it("is written in seconds, then minutes and seconds, then hours and minutes", () => {
    expect(elapsedTime(5_400)).toBe("5 s");
    expect(elapsedTime(80_000)).toBe("1 min 20 s");
    expect(elapsedTime(65 * 60_000 + 30_000)).toBe("1 h 5 min");
  });

  it("never goes below nothing", () => {
    expect(elapsedTime(-2_000)).toBe("0 s");
  });
});
