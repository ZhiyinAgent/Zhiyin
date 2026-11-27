/**
 * The order permission work is written in: which work walks beside other
 * work, and which waits for it.
 */

import { describe, expect, it } from "vitest";
import { Walks } from "../src/permission-walks.js";

/** Work that starts when the queue lets it, and ends when the test says. */
function standInWork() {
  const started: string[] = [];
  const ends = new Map<string, () => void>();
  return {
    started,
    work: (name: string) => () => {
      started.push(name);
      return new Promise<void>((resolve) => ends.set(name, resolve));
    },
    end: (name: string) => ends.get(name)?.(),
  };
}

/** Lets the queue start what it will. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

describe("permission walks", () => {
  it("walks a grant a run waits for beside a grant behind a run, when neither folder holds the other", async () => {
    const walks = new Walks();
    const { started, work, end } = standInWork();

    void walks.run(work("environment again"), false, "C:\\data\\environment");
    void walks.run(work("home"), true, "C:\\data\\homes\\run");
    await settle();

    expect(started).toEqual(["environment again", "home"]);
    end("environment again");
    end("home");
  });

  it("waits for a grant walking a folder that holds the new one, or that it holds", async () => {
    const walks = new Walks();
    const { started, work, end } = standInWork();

    void walks.run(work("environment"), false, "C:\\data\\environment");
    void walks.run(work("inside"), true, "C:\\data\\environment\\inside");
    void walks.run(work("around"), true, "C:\\DATA");
    await settle();
    expect(started).toEqual(["environment"]);

    end("environment");
    await settle();
    expect(started).toEqual(["environment", "inside"]);
    end("inside");
    await settle();
    expect(started).toEqual(["environment", "inside", "around"]);
    end("around");
  });

  it("keeps the order grants were asked in: one apart from both waits behind one that waits", async () => {
    const walks = new Walks();
    const { started, work, end } = standInWork();

    void walks.run(work("outer"), true, "C:\\outer");
    void walks.run(work("inner"), true, "C:\\outer\\inner");
    void walks.run(work("apart"), true, "C:\\apart");
    await settle();
    expect(started).toEqual(["outer"]);

    end("outer");
    await settle();
    expect(started).toEqual(["outer", "inner", "apart"]);
    end("inner");
    end("apart");
  });

  it("walks two grants at most at once", async () => {
    const walks = new Walks();
    const { started, work, end } = standInWork();

    void walks.run(work("first"), true, "C:\\first");
    void walks.run(work("second"), true, "C:\\second");
    void walks.run(work("third"), true, "C:\\third");
    await settle();
    expect(started).toEqual(["first", "second"]);

    end("second");
    await settle();
    expect(started).toEqual(["first", "second", "third"]);
    end("first");
    end("third");
  });

  it("walks work that names no folder, as a hold, alone, and what was asked after it waits for it", async () => {
    const walks = new Walks();
    const { started, work, end } = standInWork();

    void walks.run(work("grant"), true, "C:\\granted");
    void walks.run(work("hold"), true);
    void walks.run(work("later grant"), true, "C:\\elsewhere");
    await settle();
    expect(started).toEqual(["grant"]);

    end("grant");
    await settle();
    expect(started).toEqual(["grant", "hold"]);
    end("hold");
    await settle();
    expect(started).toEqual(["grant", "hold", "later grant"]);
    end("later grant");
  });

  it("starts a grant behind a run only once nothing walks", async () => {
    const walks = new Walks();
    const { started, work, end } = standInWork();

    void walks.run(work("awaited"), true, "C:\\home");
    void walks.run(work("behind"), false, "C:\\environment");
    await settle();
    expect(started).toEqual(["awaited"]);

    end("awaited");
    await settle();
    expect(started).toEqual(["awaited", "behind"]);
    end("behind");
  });

  it("answers each work's own outcome, and goes on after one fails", async () => {
    const walks = new Walks();

    const failed = walks.run(
      async () => {
        throw new Error("refused");
      },
      true,
      "C:\\one",
    );
    const done = walks.run(async () => "granted", true, "C:\\one");

    await expect(failed).rejects.toThrow("refused");
    await expect(done).resolves.toBe("granted");
  });
});
