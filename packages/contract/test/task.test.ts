import { describe, expect, it } from "vitest";
import { turnUnderWay } from "../src/index.js";

describe("turnUnderWay", () => {
  it.each(["working", "approval", "input"] as const)(
    "counts a turn that is %s as under way",
    (kind) => {
      expect(turnUnderWay(kind)).toBe(true);
    },
  );

  it.each(["draft", "completed", "failed", "interrupted"] as const)(
    "counts a conversation that is %s as having no turn under way",
    (kind) => {
      expect(turnUnderWay(kind)).toBe(false);
    },
  );
});
