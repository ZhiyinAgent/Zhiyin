import { describe, expect, it } from "vitest";
import { newestFirst } from "../src/index.js";

const conversation = (id: string, updatedAt: string) => ({ id, updatedAt });

describe("newestFirst", () => {
  it("lists the conversation changed last first", () => {
    const listed = [
      conversation("a", "2026-09-01T10:00:00.000Z"),
      conversation("b", "2026-09-03T10:00:00.000Z"),
      conversation("c", "2026-09-02T10:00:00.000Z"),
    ].sort(newestFirst);

    expect(listed.map((item) => item.id)).toEqual(["b", "c", "a"]);
  });

  it("orders conversations changed at the same moment by id, whatever order they came in", () => {
    const at = "2026-09-01T10:00:00.000Z";
    const one = [conversation("b", at), conversation("a", at)].sort(
      newestFirst,
    );
    const other = [conversation("a", at), conversation("b", at)].sort(
      newestFirst,
    );

    expect(one.map((item) => item.id)).toEqual(["a", "b"]);
    expect(other.map((item) => item.id)).toEqual(["a", "b"]);
  });
});
