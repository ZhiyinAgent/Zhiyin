/**
 * How the end of each process is told, against a stand-in for Windows' own
 * calls: one wait holds sixty-three processes beside the event that wakes it,
 * so more processes take more waits, and every end is told whichever wait
 * holds it.
 */

import { describe, expect, it } from "vitest";
import { WAIT_TIMEOUT, type Win32 } from "../src/kernel32.js";
import { ProcessEnds } from "../src/process-ends.js";

type Child = { readonly name: number; ended: boolean };
type Wait = {
  readonly handles: readonly unknown[];
  readonly done: (error: unknown, result: number) => void;
};

/** Windows' calls as far as waiting goes, with each wait answered later, as a thread answers. */
function windows(options: { readonly event?: unknown } = {}) {
  const held = new Set<Wait>();
  const answer = (wait: Wait, result: number) => {
    held.delete(wait);
    queueMicrotask(() => wait.done(null, result));
  };
  const event = "event" in options ? options.event : { event: true };
  const api = {
    ended: (child: unknown) => ((child as Child).ended ? 0 : WAIT_TIMEOUT),
    createEvent: () => event,
    setEvent: () => {
      for (const wait of [...held]) answer(wait, 0);
      return true;
    },
    resetEvent: () => true,
    waitForAny: (handles: readonly unknown[], done: Wait["done"]) => {
      held.add({ handles, done });
    },
  } as unknown as Win32;
  return {
    api,
    /** How many processes each wait held now holds, beside its event. */
    sizes: () =>
      [...held].map((wait) => wait.handles.length - 1).sort((a, b) => b - a),
    end(child: Child) {
      child.ended = true;
      const wait = [...held].find((each) => each.handles.includes(child));
      if (wait) answer(wait, wait.handles.indexOf(child));
    },
  };
}

/** Lets every answer already given run its course. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

describe("the end of each running process", () => {
  it("is told for a process past the sixty-third as for the first, and every wait is held again", async () => {
    const machine = windows();
    const ends = new ProcessEnds(machine.api);
    const told: number[] = [];
    const children: Child[] = Array.from({ length: 70 }, (_, name) => ({
      name,
      ended: false,
    }));
    for (const child of children)
      ends.watch(child, () => told.push(child.name));
    await settle();
    expect(machine.sizes()).toEqual([63, 7]);

    machine.end(children[66]!);
    await settle();
    machine.end(children[3]!);
    await settle();

    expect(told).toEqual([66, 3]);
    expect(machine.sizes()).toEqual([63, 5]);
  });

  it("refuses to wait, rather than hold a wait nothing could wake, when no event can be made", () => {
    const machine = windows({ event: null });
    const ends = new ProcessEnds(machine.api);

    expect(() =>
      ends.watch({ name: 1, ended: false }, () => undefined),
    ).toThrow(/Waiting for the process failed/);
    expect(machine.sizes()).toEqual([]);
  });

  it("is full at 189 processes, three waits that leave file work a thread, and waits on another once one ends", async () => {
    const machine = windows();
    const ends = new ProcessEnds(machine.api);
    const children: Child[] = Array.from({ length: 190 }, (_, name) => ({
      name,
      ended: false,
    }));
    for (const child of children.slice(0, 189))
      ends.watch(child, () => undefined);
    await settle();

    expect(ends.full).toBe(true);
    expect(machine.sizes()).toEqual([63, 63, 63]);
    expect(() => ends.watch(children[189]!, () => undefined)).toThrow(
      /189 programs/,
    );

    machine.end(children[0]!);
    await settle();
    expect(ends.full).toBe(false);
    ends.watch(children[189]!, () => undefined);
    await settle();
    expect(machine.sizes()).toEqual([63, 63, 63]);
  });
});
