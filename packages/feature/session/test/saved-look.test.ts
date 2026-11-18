/**
 * The look is read before the window exists, as the appearance is, so the
 * first frame already wears it. A look that is no longer on the list is
 * forgotten, never taken for damage.
 */

import { afterEach, describe, expect, it } from "vitest";
import { TemporaryFolders } from "@zhiyin/test-support";
import { FileSessions, type SavedWorkspace } from "../src/index.js";
import { damage, plantHistory, settingsFile } from "./planted-history.js";

const folders = new TemporaryFolders();

afterEach(() => folders.removeAll());

async function temporaryRoot() {
  return folders.make("zhiyin-look-");
}

const empty: SavedWorkspace = {
  tasks: [],
  selectedTaskId: null,
  recentWorkspaces: [],
};

describe("the saved look", () => {
  it("is read on its own, without opening the history", async () => {
    const root = await temporaryRoot();
    await new FileSessions(root).saveWorkspace({
      ...empty,
      look: { look: "neutral", strength: "vivid" },
    });

    await expect(new FileSessions(root).savedLook()).resolves.toEqual({
      look: "neutral",
      strength: "vivid",
    });
    await expect(new FileSessions(root).loadWorkspace()).resolves.toMatchObject(
      { look: { look: "neutral", strength: "vivid" } },
    );
  });

  it("is nothing when there is no history, or it cannot be read", async () => {
    const root = await temporaryRoot();
    await expect(new FileSessions(root).savedLook()).resolves.toBeUndefined();

    await damage(settingsFile(root));
    await expect(new FileSessions(root).savedLook()).resolves.toBeUndefined();
  });

  it("forgets a look or a strength that is not on the list, and keeps every other choice", async () => {
    for (const look of [
      { look: "sepia", strength: "default" },
      { look: "ink", strength: "loud" },
    ]) {
      const root = await temporaryRoot();
      await plantHistory(root, { ...empty, appearance: "dark", look });

      await expect(new FileSessions(root).savedLook()).resolves.toBeUndefined();
      const loaded = await new FileSessions(root).loadWorkspace();
      expect(loaded?.look).toBeUndefined();
      expect(loaded?.appearance).toBe("dark");
    }
  });

  it("takes a look that is not shaped like one as damage, as any other setting", async () => {
    const root = await temporaryRoot();
    await plantHistory(root, { ...empty, look: "ink" });

    await expect(new FileSessions(root).savedLook()).resolves.toBeUndefined();
    await expect(new FileSessions(root).loadWorkspace()).rejects.toThrow();
  });
});
