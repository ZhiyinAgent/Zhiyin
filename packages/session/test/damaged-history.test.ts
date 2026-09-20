/**
 * What happens to a history file that will not open.
 *
 * The rule is that nothing is destroyed and nothing is decided for the person.
 * The damaged bytes are kept before anything else happens, and what can be read
 * is reported so a choice can be made about it — rather than the app either
 * silently starting empty or refusing to start until a file the person has
 * never heard of is repaired by hand.
 */

import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { WorkspaceSnapshot } from "@zhiyin/contract";
import { FileSessions } from "../src/index.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function temporaryRoot() {
  const root = await mkdtemp(join(tmpdir(), "zhiyin-damaged-"));
  roots.push(root);
  return root;
}

function task(id: string) {
  return {
    id,
    title: `Conversation ${id}`,
    titleSource: "generated",
    updatedAt: "2026-09-08T09:00:00.000Z",
    updatedLabel: "Tuesday",
    messages: [
      { id: `${id}-m1`, role: "user", text: "A question", sequence: 0 },
    ],
    actions: [],
    phase: { kind: "completed", outcome: { title: "Done", summary: "Done." } },
  };
}

const base = {
  version: 1,
  runtime: { tasks: "available", capabilities: "available" },
  selectedTaskId: "keep-1",
  tasks: [task("keep-1"), task("keep-2")],
  mcpServers: [],
  usage: { status: "unavailable", reason: "None." },
};

/** One task the reader will refuse, among conversations that are perfectly fine. */
const oneBadTask = {
  ...base,
  tasks: [
    task("keep-1"),
    { id: "broken", phase: { kind: "invented" } },
    task("keep-2"),
  ],
};

async function write(root: string, value: unknown) {
  await writeFile(
    join(root, "workspace.json"),
    typeof value === "string" ? value : JSON.stringify(value),
    "utf8",
  );
}

describe("FileSessions damaged history", () => {
  it("reports how much of a damaged history can still be read", async () => {
    const root = await temporaryRoot();
    await write(root, oneBadTask);

    await expect(new FileSessions(root).inspectDamage()).resolves.toMatchObject(
      { kind: "partial", readable: 2, damaged: 1 },
    );
  });

  it("says when nothing can be read rather than guessing", async () => {
    const root = await temporaryRoot();
    await write(root, "this is not json at all");

    await expect(new FileSessions(root).inspectDamage()).resolves.toMatchObject(
      { kind: "unreadable" },
    );
  });

  it("keeps the damaged bytes before anything is decided about them", async () => {
    const root = await temporaryRoot();
    await write(root, oneBadTask);
    const original = await readFile(join(root, "workspace.json"), "utf8");

    const kept = await new FileSessions(root).preserveDamaged();

    expect(await readFile(kept, "utf8")).toBe(original);
    // And the file it was taken from is still there, untouched.
    expect(await readFile(join(root, "workspace.json"), "utf8")).toBe(original);
  });

  it("keeps each damaged copy rather than overwriting the last one", async () => {
    const root = await temporaryRoot();
    await write(root, oneBadTask);
    const sessions = new FileSessions(root, {
      now: () => new Date("2026-09-10T08:00:00.000Z"),
    });
    const later = new FileSessions(root, {
      now: () => new Date("2026-09-10T09:30:00.000Z"),
    });

    await sessions.preserveDamaged();
    await later.preserveDamaged();

    const kept = (await readdir(join(root, "damaged-history"))).sort();
    expect(kept).toHaveLength(2);
  });

  it("recovers the conversations that could be read and leaves out the one that could not", async () => {
    const root = await temporaryRoot();
    await write(root, oneBadTask);
    const sessions = new FileSessions(root);

    const recovered = await sessions.recoverReadable();

    expect(recovered).toMatchObject({ recovered: 2, discarded: 1 });
    const restored = (await sessions.loadWorkspace()) as WorkspaceSnapshot;
    expect(restored.tasks.map((item) => item.id)).toEqual(["keep-1", "keep-2"]);
  });

  it("keeps the damaged file when it recovers what it can", async () => {
    const root = await temporaryRoot();
    await write(root, oneBadTask);
    const original = await readFile(join(root, "workspace.json"), "utf8");

    await new FileSessions(root).recoverReadable();

    const kept = await readdir(join(root, "damaged-history"));
    expect(kept).toHaveLength(1);
    expect(
      await readFile(join(root, "damaged-history", kept[0]!), "utf8"),
    ).toBe(original);
  });

  it("chooses a selected conversation that survived the recovery", async () => {
    const root = await temporaryRoot();
    await write(root, {
      ...oneBadTask,
      selectedTaskId: "broken",
    });

    await new FileSessions(root).recoverReadable();

    const restored = (await new FileSessions(root).loadWorkspace())!;
    expect(restored.tasks.map((item) => item.id)).toContain(
      restored.selectedTaskId,
    );
  });

  it("refuses to recover a file that holds nothing readable, rather than starting empty behind the person's back", async () => {
    const root = await temporaryRoot();
    await write(root, "not json");

    await expect(
      new FileSessions(root).recoverReadable(),
    ).rejects.toMatchObject({ code: "corrupted" });
    // The damaged file is still there to be preserved or discarded by choice.
    expect(await readFile(join(root, "workspace.json"), "utf8")).toBe(
      "not json",
    );
  });
});
