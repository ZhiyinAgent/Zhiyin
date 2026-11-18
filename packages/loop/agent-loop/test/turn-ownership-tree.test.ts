/**
 * Ownership of nested work. A parent is the authority that keeps descendants
 * alive: stopping it ends the whole branch and leaves unrelated roots alone,
 * while a parent that finishes on its own leaves its children running.
 */

import { describe, expect, it } from "vitest";
import { TurnOwnership } from "../src/turn/turn-ownership.js";

describe("TurnOwnership descendants", () => {
  it("cancels every descendant when its parent is cancelled", () => {
    const turns = new TurnOwnership();
    const parent = turns.start("parent");
    const child = turns.start("child", "parent");
    const grandchild = turns.start("grandchild", "child");

    turns.cancel("parent");

    expect(parent.signal.aborted).toBe(true);
    expect(child.signal.aborted).toBe(true);
    expect(grandchild.signal.aborted).toBe(true);
    expect(turns.running("parent")).toBe(false);
    expect(turns.running("child")).toBe(false);
    expect(turns.running("grandchild")).toBe(false);
  });

  it("does not cancel an unrelated turn", () => {
    const turns = new TurnOwnership();
    turns.start("parent");
    const child = turns.start("child", "parent");
    const unrelated = turns.start("unrelated");

    turns.cancel("parent");

    expect(child.signal.aborted).toBe(true);
    expect(unrelated.signal.aborted).toBe(false);
    expect(turns.running("unrelated")).toBe(true);
  });

  it("refuses to attach new work to a missing or stopped parent", () => {
    const turns = new TurnOwnership();

    expect(() => turns.start("child", "missing")).toThrow(
      "The parent turn is not running.",
    );
    turns.start("parent");
    turns.cancel("parent");
    expect(() => turns.start("child", "parent")).toThrow(
      "The parent turn is not running.",
    );
  });

  it("lets a child outlive its parent's own natural finish", () => {
    const turns = new TurnOwnership();
    const parent = turns.start("parent");
    const child = turns.start("child", "parent");

    expect(turns.finish("parent", parent)).toBe(true);

    expect(turns.running("parent")).toBe(false);
    expect(turns.running("child")).toBe(true);
    expect(child.signal.aborted).toBe(false);
  });

  it("still cancels a child left running after its parent's natural finish", () => {
    const turns = new TurnOwnership();
    const parent = turns.start("parent");
    const child = turns.start("child", "parent");
    turns.finish("parent", parent);

    turns.cancel("parent");

    expect(child.signal.aborted).toBe(true);
    expect(turns.running("child")).toBe(false);
  });
});
