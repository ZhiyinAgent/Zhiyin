/**
 * The appearance is read before the window exists, so the first frame is
 * already the right colour. That read must never stop the app opening.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  FileSessions,
  SessionStoreError,
  type SavedWorkspace,
} from "../src/index.js";
import { damage, plantHistory, settingsFile } from "./planted-history.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function temporaryRoot() {
  const root = await mkdtemp(join(tmpdir(), "zhiyin-appearance-"));
  roots.push(root);
  return root;
}

const empty: SavedWorkspace = {
  tasks: [],
  selectedTaskId: null,
  recentWorkspaces: [],
};

describe("the saved appearance", () => {
  it("is read on its own, without opening the history", async () => {
    const root = await temporaryRoot();
    await new FileSessions(root).saveWorkspace({
      ...empty,
      appearance: "light",
    });

    await expect(new FileSessions(root).savedAppearance()).resolves.toBe(
      "light",
    );
    await expect(new FileSessions(root).loadWorkspace()).resolves.toMatchObject(
      { appearance: "light" },
    );
  });

  it("is nothing when there is no history, or it cannot be read", async () => {
    const root = await temporaryRoot();
    await expect(
      new FileSessions(root).savedAppearance(),
    ).resolves.toBeUndefined();

    await damage(settingsFile(root));
    await expect(
      new FileSessions(root).savedAppearance(),
    ).resolves.toBeUndefined();
  });

  it("refuses a colour scheme Zhiyin does not have", async () => {
    const root = await temporaryRoot();
    await plantHistory(root, { ...empty, appearance: "sepia" });

    await expect(
      new FileSessions(root).savedAppearance(),
    ).resolves.toBeUndefined();
    await expect(new FileSessions(root).loadWorkspace()).rejects.toBeInstanceOf(
      SessionStoreError,
    );
  });
});
