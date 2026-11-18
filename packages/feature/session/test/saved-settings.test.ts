/**
 * Every personal setting is saved, read back as saved, and refused as damage
 * when it is malformed. The settings below name every one the contract
 * declares, so a setting added there fails to compile here until it has a
 * value and a malformed form.
 */

import { afterEach, describe, expect, it } from "vitest";
import type { PersonalSettings } from "@zhiyin/contract";
import { TemporaryFolders } from "@zhiyin/test-support";
import { FileSessions, SessionStoreError } from "../src/index.js";
import { plantHistory } from "./planted-history.js";

const folders = new TemporaryFolders();
afterEach(() => folders.removeAll());

const every: Required<PersonalSettings> = {
  contextBudget: "low",
  notifications: "off",
  studioReviews: "off",
  reviewerModel: {
    provider: "deepseek",
    model: "deepseek-reasoner",
    providers: [],
  },
  workPauses: { rounds: 80, minutes: 45, dollars: 20, yuan: 140 },
  appearance: "dark",
  look: { look: "dots", strength: "vivid" },
  spellingChoice: { enabled: true, languages: ["fr"] },
  folderInstructionChoices: [
    { root: "C:\\Projects\\notes", hash: "abc123", use: true },
  ],
  preferences: { onboarded: true, interests: ["writing"] },
};

const malformed: { readonly [Name in keyof PersonalSettings]-?: unknown } = {
  contextBudget: "huge",
  notifications: "on",
  studioReviews: false,
  reviewerModel: { provider: "deepseek" },
  workPauses: { rounds: "many" },
  appearance: "sepia",
  look: { look: "dots" },
  spellingChoice: { enabled: "yes", languages: [] },
  folderInstructionChoices: "all",
  preferences: { onboarded: true },
};

const empty = { selectedTaskId: null, recentWorkspaces: [], tasks: [] };

describe("the person's settings", () => {
  it("are each read back as saved, after a restart", async () => {
    const root = await folders.make("zhiyin-settings-");
    const first = new FileSessions(root);
    await first.claim();
    await first.saveWorkspace({ ...empty, ...every });
    await first.release();

    const index = await new FileSessions(root).loadIndex();

    expect(index).toMatchObject(every);
  });

  it.each(Object.entries(malformed))(
    "are refused as damaged when %s is malformed",
    async (name, value) => {
      const root = await folders.make("zhiyin-settings-");
      await plantHistory(root, { ...empty, [name]: value });

      await expect(new FileSessions(root).loadIndex()).rejects.toBeInstanceOf(
        SessionStoreError,
      );
    },
  );
});
