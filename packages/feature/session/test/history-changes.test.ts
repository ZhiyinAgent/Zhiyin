import { describe, expect, it } from "vitest";
import { applyChanges, changesBetween } from "../src/history-changes.js";

/**
 * A save writes only what changed, and applying what was written to the state
 * before it gives back the state that was saved — to the character, because a
 * pending rewind compares a reloaded conversation with the text it recorded.
 */

function rebuilt(before: unknown, after: unknown): string {
  const stored = JSON.parse(JSON.stringify(before)) as unknown;
  const changes = changesBetween(before, after);
  // Written and read back, the way a log line is.
  const read = JSON.parse(JSON.stringify(changes)) as typeof changes;
  return JSON.stringify(applyChanges(stored, read));
}

describe("a change between two saves", () => {
  it("is nothing when nothing changed", () => {
    const task = { id: "a", messages: [{ id: "m", text: "Hi" }] };
    expect(changesBetween(task, { ...task })).toEqual([]);
  });

  it("records a reply that grew as only the words that were added", () => {
    const before = {
      id: "a",
      messages: [{ id: "m", role: "assistant", text: "The first" }],
    };
    const after = {
      ...before,
      messages: [{ ...before.messages[0]!, text: "The first words" }],
    };

    const changes = changesBetween(before, after);

    expect(JSON.stringify(changes)).not.toContain("The first");
    expect(JSON.stringify(changes)).toContain(" words");
    expect(rebuilt(before, after)).toBe(JSON.stringify(after));
  });

  it("records one changed entry of a long list, not the list", () => {
    const actions = Array.from({ length: 50 }, (_, index) => ({
      id: `action-${index}`,
      evidence: "x".repeat(1_000),
      status: "completed",
    }));
    const before = { id: "a", actions };
    const after = {
      id: "a",
      actions: actions.map((action, index) =>
        index === 7 ? { ...action, status: "failed" } : action,
      ),
    };

    expect(JSON.stringify(changesBetween(before, after)).length).toBeLessThan(
      200,
    );
    expect(rebuilt(before, after)).toBe(JSON.stringify(after));
  });

  describe("in a list whose entries have ids", () => {
    const entries = Array.from({ length: 50 }, (_, index) => ({
      id: `entry-${index}`,
      text: "x".repeat(1_000),
    }));
    const size = (before: unknown, after: unknown) =>
      JSON.stringify(changesBetween(before, after)).length;

    it("records an entry added at the top as that entry, not the list", () => {
      const added = { id: "new", text: "y".repeat(1_000) };
      const before = { items: entries };
      const after = { items: [added, ...entries] };

      expect(size(before, after)).toBeLessThan(1_200);
      expect(rebuilt(before, after)).toBe(JSON.stringify(after));
    });

    it("records an entry removed from the middle as its removal", () => {
      const before = { items: entries };
      const after = { items: entries.filter((_, index) => index !== 20) };

      expect(size(before, after)).toBeLessThan(100);
      expect(rebuilt(before, after)).toBe(JSON.stringify(after));
    });

    it("records an entry moved to the top as the move", () => {
      const before = { items: entries };
      const after = {
        items: [entries[30]!, ...entries.filter((_, index) => index !== 30)],
      };

      expect(size(before, after)).toBeLessThan(100);
      expect(rebuilt(before, after)).toBe(JSON.stringify(after));
    });

    it("names the entry a change is in by its id, not its place", () => {
      const before = { items: entries };
      const after = {
        items: entries.map((entry, index) =>
          index === 12 ? { ...entry, text: `${entry.text}z` } : entry,
        ),
      };

      expect(JSON.stringify(changesBetween(before, after))).toContain(
        '"entry-12"',
      );
      expect(rebuilt(before, after)).toBe(JSON.stringify(after));
    });

    it("rebuilds any sequence of additions, removals, moves and edits exactly", () => {
      let seed = 11;
      const random = () => {
        seed = (seed * 48_271) % 2_147_483_647;
        return seed / 2_147_483_647;
      };
      const at = (length: number) => Math.floor(random() * length);
      let next = 0;
      type Entry = { id: string; text: string; notes: readonly Entry[] };
      const fresh = (): Entry => ({ id: `e${next++}`, text: "a", notes: [] });
      let state: { readonly items: readonly Entry[] } = {
        items: Array.from({ length: 5 }, fresh),
      };

      for (let step = 0; step < 2_000; step += 1) {
        const items = [...state.items];
        const edits = 1 + at(3);
        for (let count = 0; count < edits; count += 1) {
          const choice = random();
          if (choice < 0.25 || !items.length)
            items.splice(at(items.length + 1), 0, fresh());
          else if (choice < 0.45) items.splice(at(items.length), 1);
          else if (choice < 0.65) {
            const [moved] = items.splice(at(items.length), 1);
            items.splice(at(items.length + 1), 0, moved!);
          } else {
            const index = at(items.length);
            const entry = items[index]!;
            items[index] =
              random() < 0.5
                ? { ...entry, text: `${entry.text}b` }
                : { ...entry, notes: [...entry.notes, fresh()] };
          }
        }
        const after = { items };
        expect(rebuilt(state, after)).toBe(JSON.stringify(after));
        state = after;
      }
    });
  });

  it("rebuilds added, removed and shortened entries exactly", () => {
    const before = {
      id: "a",
      title: "Old",
      compaction: { revision: 1 },
      messages: [
        { id: "1", text: "one" },
        { id: "2", text: "two" },
        { id: "3", text: "three" },
      ],
    };
    const after = {
      id: "a",
      title: "New",
      messages: [{ id: "1", text: "one" }],
      plan: [{ step: "Write" }],
    };

    expect(rebuilt(before, after)).toBe(JSON.stringify(after));
  });

  it("keeps the order of fields exactly, even when a field moves", () => {
    const before = { id: "a", title: "T", phase: { kind: "draft" } };
    const moved = { phase: { kind: "draft" }, id: "a", title: "T" };
    const added = { id: "a", workspace: { path: "C:/x" }, title: "T" };

    expect(rebuilt(before, moved)).toBe(JSON.stringify(moved));
    expect(rebuilt(before, added)).toBe(JSON.stringify(added));
  });

  it("treats a field left undefined as absent, as a saved file does", () => {
    const before = { id: "a", compaction: { revision: 1 }, title: "T" };
    const after = { id: "a", compaction: undefined, title: "T" };
    const again = { id: "a", compaction: { revision: 2 }, title: "T" };

    expect(rebuilt(before, after)).toBe(JSON.stringify(after));
    expect(rebuilt(after, again)).toBe(JSON.stringify(again));
  });

  it("rebuilds any sequence of edits exactly", () => {
    let seed = 7;
    const random = () => {
      seed = (seed * 48_271) % 2_147_483_647;
      return seed / 2_147_483_647;
    };
    const pick = <T>(items: readonly T[]): T =>
      items[Math.floor(random() * items.length)]!;
    const value = (depth: number): unknown => {
      const kind = pick(
        depth > 2
          ? ["text", "number", "flag", "none"]
          : ["text", "number", "flag", "none", "list", "record"],
      );
      if (kind === "text") return pick(["", "a", "ab", "b", "abc"]);
      if (kind === "number") return pick([0, 1, 2.5, -3]);
      if (kind === "flag") return random() < 0.5;
      if (kind === "none") return pick([null, undefined]);
      if (kind === "list")
        return Array.from({ length: Math.floor(random() * 4) }, () =>
          value(depth + 1),
        );
      const record: Record<string, unknown> = {};
      for (const key of ["k", "l", "m", "n"])
        if (random() < 0.6) record[key] = value(depth + 1);
      return record;
    };
    const edit = (current: unknown, depth = 0): unknown => {
      if (Array.isArray(current) && current.length && random() < 0.7) {
        const copy = [...current];
        const at = Math.floor(random() * copy.length);
        if (random() < 0.2) copy.length = at;
        else copy[at] = edit(copy[at], depth + 1);
        return copy;
      }
      if (
        current &&
        typeof current === "object" &&
        !Array.isArray(current) &&
        random() < 0.7
      ) {
        const entries = Object.entries(current);
        if (random() < 0.2) entries.reverse();
        const key = pick(["k", "l", "m", "n"]);
        const at = entries.findIndex(([name]) => name === key);
        if (at >= 0) entries[at] = [key, edit(entries[at]![1], depth + 1)];
        else entries.push([key, value(depth + 1)]);
        return Object.fromEntries(entries);
      }
      if (typeof current === "string" && random() < 0.5)
        return current + pick(["x", "yz"]);
      return value(depth);
    };

    let state: { readonly v: unknown } = { v: value(0) };
    for (let step = 0; step < 2_000; step += 1) {
      const next = { v: edit(state.v) };
      expect(rebuilt(state, next)).toBe(JSON.stringify(next));
      state = next;
    }
  });
});
