/**
 * A secret of any length is kept in a credential store whose entries hold at
 * most 1,280 characters, as Windows' do, and a value half written reads as
 * the one before it.
 */

import { describe, expect, it } from "vitest";
import { PiecewiseCredential, type CredentialEntries } from "../src/index.js";

/** Windows' credential store: at most 1,280 characters an entry. */
function limitedStore(failAfterWrites = Infinity) {
  const held = new Map<string, string>();
  let writes = 0;
  const entries: CredentialEntries = (name) => ({
    getPassword: async () => held.get(name),
    setPassword: async (value) => {
      if (value.length > 1280)
        throw new Error("Longer than the platform limit");
      if (++writes > failAfterWrites) throw new Error("The store went away");
      held.set(name, value);
    },
    deletePassword: async () => held.delete(name),
  });
  return { held, entries };
}

/** A store whose writes or removals can be made to fail, and then recover. */
function flakyStore() {
  const held = new Map<string, string>();
  let setsLeft = Infinity;
  let deleting: string | false = false;
  let goneOnceMoved = false;
  /** The store goes away once the entry under the name itself changes. */
  const moved = (name: string) => {
    if (goneOnceMoved && !name.includes("#")) {
      setsLeft = 0;
      deleting = "";
    }
  };
  const entries: CredentialEntries = (name) => ({
    getPassword: async () => held.get(name),
    setPassword: async (value) => {
      if (value.length > 1280)
        throw new Error("Longer than the platform limit");
      if (setsLeft-- <= 0) throw new Error("The store went away");
      held.set(name, value);
      moved(name);
    },
    deletePassword: async () => {
      if (deleting !== false && name.startsWith(deleting))
        throw new Error("The store went away");
      const had = held.delete(name);
      moved(name);
      return had;
    },
  });
  return {
    held,
    entries,
    failSetsAfter: (count: number) => {
      setsLeft = count;
    },
    /** Removals of names starting with `prefix` fail; every one by default. */
    failDeletes: (failing: boolean, prefix = "") => {
      deleting = failing ? prefix : false;
    },
    failOnceTheEntryMoves: (failing: boolean) => {
      goneOnceMoved = failing;
    },
  };
}

describe("a credential kept in pieces", () => {
  it("keeps a value that fits in its one entry, as it always was", async () => {
    const store = limitedStore();
    await new PiecewiseCredential(store.entries, "mcp:docs").set("short-key");

    expect([...store.held]).toEqual([["mcp:docs", "short-key"]]);
  });

  it("keeps a longer value whole, and forgets every piece of it", async () => {
    const store = limitedStore();
    const credential = new PiecewiseCredential(store.entries, "mcp:docs");
    const key = "k".repeat(2_000) + "end";

    await credential.set(key);
    expect(await credential.get()).toBe(key);

    await credential.delete();
    expect(await credential.get()).toBeUndefined();
    expect(store.held.size).toBe(0);
  });

  it("leaves no pieces behind when a long value is replaced by a short one", async () => {
    const store = limitedStore();
    const credential = new PiecewiseCredential(store.entries, "mcp:docs");
    await credential.set("k".repeat(3_000));

    await credential.set("short-key");

    expect([...store.held]).toEqual([["mcp:docs", "short-key"]]);
  });

  it("reads a value half written as the one before it", async () => {
    // The old key is one write; the new one gets one piece in.
    const store = limitedStore(2);
    const credential = new PiecewiseCredential(store.entries, "mcp:docs");
    await credential.set("old-key");

    await expect(credential.set("n".repeat(2_000))).rejects.toThrow();

    expect(await credential.get()).toBe("old-key");
  });

  it("reads a long value half written over a long one as the one before it", async () => {
    // The old key is four writes, its record included; the new one's first fails.
    const store = limitedStore(4);
    const credential = new PiecewiseCredential(store.entries, "mcp:docs");
    const old = "o".repeat(2_000);
    await credential.set(old);

    await expect(credential.set("n".repeat(2_000))).rejects.toThrow();

    expect(await credential.get()).toBe(old);
  });

  it("leaves no pieces behind once a value is written again or deleted after a write that failed part-way", async () => {
    for (const next of ["short", "long", "delete"] as const) {
      const store = flakyStore();
      const credential = new PiecewiseCredential(store.entries, "mcp:docs");
      await credential.set("o".repeat(2_000));
      // The record and three pieces of the new value are written, then the
      // store goes away, and nothing can be removed either.
      store.failSetsAfter(4);
      store.failDeletes(true);
      await expect(credential.set("n".repeat(4_000))).rejects.toThrow();
      store.failSetsAfter(Infinity);
      store.failDeletes(false);

      if (next === "short") await credential.set("short-key");
      if (next === "long") await credential.set("l".repeat(2_000));
      if (next === "delete") await credential.delete();

      if (next === "short")
        expect([...store.held]).toEqual([["mcp:docs", "short-key"]]);
      if (next === "long") {
        expect(await credential.get()).toBe("l".repeat(2_000));
        expect(store.held.size).toBe(3);
      }
      if (next === "delete") expect(store.held.size).toBe(0);
    }
  });

  it("removes the pieces of a write that failed part-way at once, when the store can still remove them", async () => {
    const store = flakyStore();
    const credential = new PiecewiseCredential(store.entries, "mcp:docs");
    await credential.set("o".repeat(2_000));
    const before = [...store.held];
    store.failSetsAfter(2);

    await expect(credential.set("n".repeat(4_000))).rejects.toThrow();

    expect([...store.held]).toEqual(before);
  });

  it("removes an old value's pieces at the next write or delete, though nothing could be removed or recorded once its entry moved on", async () => {
    for (const change of ["delete", "short", "long"] as const) {
      const store = flakyStore();
      const credential = new PiecewiseCredential(store.entries, "mcp:docs");
      await credential.set("o".repeat(3_000));
      store.failOnceTheEntryMoves(true);

      if (change === "delete")
        await expect(credential.delete()).rejects.toThrow();
      if (change === "short") await credential.set("short-key");
      if (change === "long") await credential.set("n".repeat(2_000));
      store.failOnceTheEntryMoves(false);
      store.failSetsAfter(Infinity);
      store.failDeletes(false);
      await credential.delete();

      expect([...store.held.keys()], change).toEqual([]);
    }
  });

  it("keeps a new value whose earlier pieces could not be removed, and removes them at the next write or delete", async () => {
    const store = flakyStore();
    const credential = new PiecewiseCredential(store.entries, "mcp:docs");
    await credential.set("o".repeat(2_000));
    store.failDeletes(true);

    await credential.set("n".repeat(2_000));
    expect(await credential.get()).toBe("n".repeat(2_000));

    store.failDeletes(false);
    await credential.delete();
    expect(store.held.size).toBe(0);
  });

  it("says a delete that could not remove every piece failed, and finishes it when tried again", async () => {
    const store = flakyStore();
    const credential = new PiecewiseCredential(store.entries, "mcp:docs");
    await credential.set("o".repeat(3_000));
    // Its middle piece cannot be removed.
    store.failDeletes(true, "mcp:docs#piece:1:1");

    await expect(credential.delete()).rejects.toThrow();
    expect(await credential.get()).toBeUndefined();

    store.failDeletes(false);
    await credential.delete();
    expect(store.held.size).toBe(0);
  });

  it("removes the pieces of a value kept before pieces took turns, when it is replaced", async () => {
    const store = limitedStore();
    store.held.set("mcp:docs", "zhiyin-pieces:7:2");
    store.held.set("mcp:docs#piece:7:0", "a".repeat(1_200));
    store.held.set("mcp:docs#piece:7:1", "b");
    const credential = new PiecewiseCredential(store.entries, "mcp:docs");
    expect(await credential.get()).toBe("a".repeat(1_200) + "b");

    await credential.set("n".repeat(2_000));

    expect(await credential.get()).toBe("n".repeat(2_000));
    expect(
      [...store.held.keys()].filter((name) => name.includes(":7:")),
    ).toEqual([]);
  });

  it("removes no entry but its own and its pieces", async () => {
    const store = limitedStore();
    store.held.set("openrouter#other", "kept");
    store.held.set("other-name", "kept");
    const credential = new PiecewiseCredential(store.entries, "openrouter");

    await credential.set("k".repeat(2_000));
    await credential.set("short-key");
    await credential.delete();

    expect([...store.held]).toEqual([
      ["openrouter#other", "kept"],
      ["other-name", "kept"],
    ]);
  });

  it("keeps a short value in a store that holds one value whatever the name", async () => {
    let held: string | undefined;
    const credential = new PiecewiseCredential(
      () => ({
        getPassword: async () => held,
        setPassword: async (value) => {
          held = value;
        },
        deletePassword: async () => {
          held = undefined;
          return true;
        },
      }),
      "openrouter",
    );

    await credential.set("short-key");

    expect(await credential.get()).toBe("short-key");
  });

  it("keeps a character outside the basic plane whole where pieces meet", async () => {
    const held = new Map<string, string>();
    // As the keyring does: each entry is stored as UTF-8.
    const entries: CredentialEntries = (name) => ({
      getPassword: async () => held.get(name),
      setPassword: async (value) => {
        if (value.length > 1280)
          throw new Error("Longer than the platform limit");
        held.set(name, Buffer.from(value, "utf8").toString("utf8"));
      },
      deletePassword: async () => held.delete(name),
    });
    const credential = new PiecewiseCredential(entries, "mcp:docs");
    const value = `${"a".repeat(1_199)}😀${"b".repeat(1_300)}`;

    await credential.set(value);

    expect(await credential.get()).toBe(value);
  });

  it("keeps one whole value of two long ones written at the same time", async () => {
    const held = new Map<string, string>();
    // Writes take different times, as a real store's may: the first
    // value's first piece and the second value's last piece land last.
    const entries: CredentialEntries = (name) => ({
      getPassword: async () => held.get(name),
      setPassword: async (value) => {
        const slow =
          (name.endsWith(":0") && value.startsWith("A")) ||
          (name.endsWith(":1") && value.startsWith("B"));
        await new Promise((resolve) => setTimeout(resolve, slow ? 30 : 0));
        held.set(name, value);
      },
      deletePassword: async () => held.delete(name),
    });
    const credential = new PiecewiseCredential(entries, "openrouter");
    const first = "A".repeat(1_300);
    const second = "B".repeat(1_300);

    await Promise.all([credential.set(first), credential.set(second)]);

    expect(await credential.get()).toBe(second);
  });

  it("reads an entry the store answers as null as absent", async () => {
    const credential = new PiecewiseCredential(
      () => ({
        getPassword: async () => null as unknown as undefined,
        setPassword: async () => {},
        deletePassword: async () => true,
      }),
      "openrouter",
    );

    expect(await credential.get()).toBeUndefined();
  });

  it("keeps a value that looks like its own marker as itself", async () => {
    const store = limitedStore();
    const credential = new PiecewiseCredential(store.entries, "mcp:docs");

    await credential.set("zhiyin-pieces:3");

    expect(await credential.get()).toBe("zhiyin-pieces:3");
  });
});
