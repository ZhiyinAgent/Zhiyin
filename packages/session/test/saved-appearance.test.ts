/**
 * The appearance is read before the window exists, so the first frame is
 * already the right colour. That read must never stop the app opening.
 */

import { afterEach, describe, expect, it } from "vitest";
import { TemporaryFolders } from "@zhiyin/temporary-folders";
import {
  FileSessions,
  SessionStoreError,
  type SavedWorkspace,
} from "../src/index.js";
import { damage, plantHistory, settingsFile } from "./planted-history.js";

const folders = new TemporaryFolders();

afterEach(() => folders.removeAll());

async function temporaryRoot() {
  return folders.make("zhiyin-appearance-");
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
