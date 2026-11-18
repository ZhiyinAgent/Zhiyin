import { describe, expect, it } from "vitest";
import { Serial, SerialByKey } from "../src/index.js";

/** A promise the test settles itself. */
function gate() {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { open, opened };
}

describe("work run one piece at a time", () => {
  it("starts each piece once the one before it has finished, in the order asked", async () => {
    const serial = new Serial();
    const first = gate();
    const seen: string[] = [];

    const one = serial.run(async () => {
      seen.push("first starts");
      await first.opened;
      seen.push("first ends");
      return 1;
    });
    const two = serial.run(() => {
      seen.push("second runs");
      return 2;
    });
    await Promise.resolve();
    expect(seen).toEqual(["first starts"]);

    first.open();
    expect(await one).toBe(1);
    expect(await two).toBe(2);
    expect(seen).toEqual(["first starts", "first ends", "second runs"]);
  });

  it("fails only the caller of a piece that fails, and runs the next", async () => {
    const serial = new Serial();

    const failed = serial.run(() => {
      throw new Error("the disk is full");
    });
    const next = serial.run(() => "saved");

    await expect(failed).rejects.toThrow("the disk is full");
    expect(await next).toBe("saved");
  });

  it("settles once everything asked for so far has settled", async () => {
    const serial = new Serial();
    const slow = gate();
    let finished = false;
    void serial.run(async () => {
      await slow.opened;
      finished = true;
    });

    const settled = serial.settled();
    slow.open();
    await settled;

    expect(finished).toBe(true);
  });
});

describe("one line of work per key", () => {
  it("runs work under one key in turn and work under another side by side", async () => {
    const queues = new SerialByKey();
    const held = gate();
    const seen: string[] = [];

    const first = queues.run("a", async () => {
      await held.opened;
      seen.push("a first");
    });
    const second = queues.run("a", () => {
      seen.push("a second");
    });
    const other = queues.run("b", () => {
      seen.push("b");
    });

    await other;
    expect(seen).toEqual(["b"]);
    held.open();
    await Promise.all([first, second]);
    expect(seen).toEqual(["b", "a first", "a second"]);
  });

  it("runs the next piece under a key after one that failed", async () => {
    const queues = new SerialByKey();

    const failed = queues.run("a", () => Promise.reject(new Error("refused")));
    const next = queues.run("a", () => "done");

    await expect(failed).rejects.toThrow("refused");
    expect(await next).toBe("done");
  });

  it("settles a key once nothing is left under it, including work asked for while it waits", async () => {
    const queues = new SerialByKey();
    const first = gate();
    const later = gate();
    const seen: string[] = [];
    void queues.run("a", async () => {
      await first.opened;
      seen.push("first");
    });

    const settled = queues.settled("a").then(() => seen.push("settled"));
    first.open();
    void queues.run("a", async () => {
      await later.opened;
      seen.push("later");
    });
    later.open();
    await settled;

    expect(seen).toEqual(["first", "later", "settled"]);
    await queues.settled("never used");
  });
});
