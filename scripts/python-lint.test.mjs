import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { pinnedRuff } from "./python-lint.mjs";

describe("the Python lint", () => {
  it("runs the one Ruff release ruff.toml pins", async () => {
    const config = await readFile(
      new URL("../ruff.toml", import.meta.url),
      "utf8",
    );
    expect(pinnedRuff(config)).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("refuses a configuration that names no exact release", () => {
    expect(() => pinnedRuff('required-version = ">=0.17"\n')).toThrow(
      /pin one release/,
    );
    expect(() => pinnedRuff("line-length = 120\n")).toThrow(/pin one release/);
  });
});
