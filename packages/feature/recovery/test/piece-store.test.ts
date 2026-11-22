import { createHash, randomBytes } from "node:crypto";
import { appendFile, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { TemporaryFolders } from "@zhiyin/test-support";
import { DamagedVersionError, PieceStore } from "../src/pieces/piece-store.js";

const folders = new TemporaryFolders();
const opened: PieceStore[] = [];
afterAll(async () => {
  for (const each of opened) await each.close();
  await folders.removeAll();
});

const sha = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

/** Text-like bytes that compress as real data does, about 3 to 1. */
function table(rows: number, seed = 1): Buffer {
  let state = seed;
  const next = () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state;
  };
  const lines: string[] = [];
  for (let row = 0; row < rows; row++)
    lines.push(
      `${row},station-${next() % 400},${(next() % 4000) / 100},${(next() % 1000) / 10},${next().toString(36)}`,
    );
  return Buffer.from(`${lines.join("\n")}\n`);
}

async function store() {
  const folder = await folders.make("zhiyin-pieces-");
  const made = new PieceStore(join(folder, "store"));
  opened.push(made);
  return { folder, store: made };
}

describe("the store of pieces", () => {
  it("gives back a kept file's exact bytes, named by its SHA-256", async () => {
    const { folder, store: pieces } = await store();
    const original = Buffer.concat([table(60_000), randomBytes(3 << 20)]);
    await writeFile(join(folder, "data.csv"), original);

    const kept = await pieces.put(join(folder, "data.csv"));
    await pieces.materialize(kept.digest, join(folder, "back.csv"));

    expect(kept).toEqual({ digest: sha(original), bytes: original.length });
    expect(sha(await readFile(join(folder, "back.csv")))).toBe(sha(original));
    expect(sha(await pieces.read(kept.digest))).toBe(sha(original));
  });

  it("keeps nothing of a file the opened check refuses, and keeps the others put with it", async () => {
    const { folder, store: pieces } = await store();
    await writeFile(join(folder, "kept.txt"), "kept");
    await writeFile(join(folder, "refused.txt"), "never read");

    const answers = await pieces.putAll([
      { source: join(folder, "kept.txt"), opened: async () => true },
      { source: join(folder, "refused.txt"), opened: async () => false },
    ]);
    const alone = pieces.put(join(folder, "refused.txt"), {
      opened: async () => false,
    });

    expect(answers[0]).toEqual({ digest: sha(Buffer.from("kept")), bytes: 4 });
    expect(answers[1]).toEqual({ failed: expect.stringMatching(/link/) });
    await expect(alone).rejects.toThrow(/link/);
    expect(await pieces.has(sha(Buffer.from("never read")))).toBe(false);
  });

  it("gives back the exact bytes of a file it reads in several parts, a piece across each part's end", async () => {
    const { folder, store: pieces } = await store();
    // Past two of the store's reads, with no piece the same as another.
    const original = randomBytes(40 << 20);
    await writeFile(join(folder, "volume.raw"), original);

    const kept = await pieces.put(join(folder, "volume.raw"));
    await pieces.materialize(kept.digest, join(folder, "back.raw"));

    expect(kept.digest).toBe(sha(original));
    expect((await readFile(join(folder, "back.raw"))).equals(original)).toBe(
      true,
    );
  });

  it("keeps a later version that changed a few places for a small part of a whole copy", async () => {
    const { folder, store: pieces } = await store();
    const first = table(400_000);
    await writeFile(join(folder, "v1.csv"), first);
    const one = await pieces.put(join(folder, "v1.csv"));
    const afterFirst = await pieces.used();
    // Scattered edits, and a line inserted near the start, which moves every
    // byte after it.
    const second = Buffer.from(first);
    for (let at = 1_000_000; at < second.length; at += 3_000_000)
      second.write("99.99", at);
    const inserted = Buffer.concat([
      second.subarray(0, 5_000),
      Buffer.from("an inserted line\n"),
      second.subarray(5_000),
    ]);
    await writeFile(join(folder, "v2.csv"), inserted);

    const two = await pieces.put(join(folder, "v2.csv"), {
      earlier: one.digest,
    });
    const grown = (await pieces.used()) - afterFirst;

    expect(afterFirst).toBeLessThan(first.length / 2);
    expect(grown).toBeLessThan(inserted.length / 50);
    await pieces.materialize(two.digest, join(folder, "back2.csv"));
    await pieces.materialize(one.digest, join(folder, "back1.csv"));
    expect(sha(await readFile(join(folder, "back2.csv")))).toBe(sha(inserted));
    expect(sha(await readFile(join(folder, "back1.csv")))).toBe(sha(first));
  });

  it("lets go of what only versions no longer needed held, and frees their room", async () => {
    const { folder, store: pieces } = await store();
    await writeFile(join(folder, "a.bin"), randomBytes(8 << 20));
    await writeFile(join(folder, "b.bin"), randomBytes(8 << 20));
    const a = await pieces.put(join(folder, "a.bin"));
    const b = await pieces.put(join(folder, "b.bin"));
    const full = await pieces.used();

    await pieces.retain(new Set([b.digest]));

    expect(await pieces.has(a.digest)).toBe(false);
    expect(await pieces.has(b.digest)).toBe(true);
    expect(await pieces.used()).toBeLessThan(full * 0.7);
    await pieces.materialize(b.digest, join(folder, "b-back.bin"));
    expect(sha(await readFile(join(folder, "b-back.bin")))).toBe(
      sha(await readFile(join(folder, "b.bin"))),
    );
    // As read again after a restart.
    await pieces.close();
    const again = new PieceStore(join(folder, "store"));
    expect(await again.has(a.digest)).toBe(false);
    expect(await again.has(b.digest)).toBe(true);
  });

  it("keeps many files at once, each given back exactly across a restart, and answers why for one it could not read", async () => {
    const { folder, store: pieces } = await store();
    const files = Array.from({ length: 2_000 }, (_, at) => ({
      source: join(folder, `note-${at}.txt`),
      bytes: Buffer.from(`a small note, number ${at}\n`),
    }));
    for (const file of files) await writeFile(file.source, file.bytes);
    const large = randomBytes(6 << 20);
    await writeFile(join(folder, "large.bin"), large);

    const answers = await pieces.putAll([
      ...files.slice(0, 1_000),
      { source: join(folder, "missing.txt") },
      { source: join(folder, "large.bin") },
      ...files.slice(1_000),
    ]);

    expect(answers[1_000]).toMatchObject({
      failed: expect.stringContaining("ENOENT"),
    });
    const kept = answers.filter((answer) => "digest" in answer);
    expect(kept).toHaveLength(2_001);
    // Small files kept together take about what they hold, not a frame each.
    const held = files.reduce((sum, file) => sum + file.bytes.length, 0);
    expect((await pieces.used()) - large.length).toBeLessThan(held);
    await pieces.close();
    const again = new PieceStore(join(folder, "store"));
    opened.push(again);
    for (const [index, file] of [
      ...files.slice(0, 1_000),
      { bytes: large },
      ...files.slice(1_000),
    ].entries())
      expect(
        (await again.read((kept[index] as { digest: string }).digest)).equals(
          file.bytes,
        ),
      ).toBe(true);
  });

  it("takes what goes out of its files at once when asked, keeping whole a later version that was a delta on it", async () => {
    const { folder, store: pieces } = await store();
    // Random bytes are kept as they are, so they can be looked for on disk.
    const first = randomBytes(2 << 20);
    const second = Buffer.from(first);
    randomBytes(4096).copy(second, 1 << 20);
    const other = randomBytes(1 << 20);
    await writeFile(join(folder, "v1.raw"), first);
    await writeFile(join(folder, "v2.raw"), second);
    await writeFile(join(folder, "other.raw"), other);
    const one = await pieces.put(join(folder, "v1.raw"));
    const two = await pieces.put(join(folder, "v2.raw"), {
      earlier: one.digest,
    });
    const kept = await pieces.put(join(folder, "other.raw"));
    // Only the first version holds these bytes; the second shares the rest.
    const own = first.subarray((1 << 20) + 1024, (1 << 20) + 3072);
    const onDisk = async () => {
      const store = join(folder, "store");
      const all = await Promise.all(
        (await readdir(store)).map((name) => readFile(join(store, name))),
      );
      return all.some((bytes) => bytes.includes(own));
    };
    expect(await onDisk()).toBe(true);

    await pieces.retain(new Set([two.digest, kept.digest]), { purge: true });

    expect(await onDisk()).toBe(false);
    expect(await pieces.has(one.digest)).toBe(false);
    expect((await pieces.read(two.digest)).equals(second)).toBe(true);
    expect((await pieces.read(kept.digest)).equals(other)).toBe(true);
    await pieces.close();
    const again = new PieceStore(join(folder, "store"));
    opened.push(again);
    expect((await again.read(two.digest)).equals(second)).toBe(true);
  });

  it("keeps what was written whole across a restart, and none of a version a crash cut short", async () => {
    const { folder, store: pieces } = await store();
    await writeFile(join(folder, "a.bin"), randomBytes(2 << 20));
    const a = await pieces.put(join(folder, "a.bin"));
    await pieces.close();
    // A crash in the middle of naming another version.
    await appendFile(join(folder, "store", "catalog.log"), '{"v":"cut sh');
    const packs = (await readdir(join(folder, "store"))).filter((name) =>
      name.endsWith(".pack"),
    );
    await appendFile(join(folder, "store", packs[0]!), randomBytes(4096));

    const again = new PieceStore(join(folder, "store"));
    await again.materialize(a.digest, join(folder, "back.bin"));

    expect(sha(await readFile(join(folder, "back.bin")))).toBe(a.digest);
    expect([...(await again.versions()).keys()]).toEqual([a.digest]);
  });

  it("refuses to give back a version whose kept bytes were damaged", async () => {
    const { folder, store: pieces } = await store();
    await writeFile(join(folder, "a.bin"), table(50_000));
    const a = await pieces.put(join(folder, "a.bin"));
    await pieces.close();
    const pack = (await readdir(join(folder, "store"))).find((name) =>
      name.endsWith(".pack"),
    )!;
    const bytes = await readFile(join(folder, "store", pack));
    bytes[Math.floor(bytes.length / 2)]! ^= 0xff;
    await writeFile(join(folder, "store", pack), bytes);

    const again = new PieceStore(join(folder, "store"));
    await expect(
      again.materialize(a.digest, join(folder, "back.bin")),
    ).rejects.toBeInstanceOf(DamagedVersionError);
  });

  it.runIf(process.platform === "win32")(
    "keeps a file's alternate data streams with it",
    async () => {
      const { folder, store: pieces } = await store();
      const file = join(folder, "downloaded.txt");
      await writeFile(file, "the file");
      await writeFile(
        `${file}:Zone.Identifier`,
        "[ZoneTransfer]\r\nZoneId=3\r\n",
      );

      const kept = await pieces.put(file, { streams: ["Zone.Identifier"] });
      await pieces.materialize(kept.digest, join(folder, "back.txt"));

      expect(await readFile(join(folder, "back.txt"), "utf8")).toBe("the file");
      expect(
        await readFile(join(folder, "back.txt:Zone.Identifier"), "utf8"),
      ).toBe("[ZoneTransfer]\r\nZoneId=3\r\n");
    },
  );
});
