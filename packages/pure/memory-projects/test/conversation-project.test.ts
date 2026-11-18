/** Which project a conversation is in (ADR 0026). */

import { describe, expect, it } from "vitest";
import type { MemoryProject } from "@zhiyin/contract";
import { isBroadFolder, projectOfConversation } from "../src/index.js";

const created = "2026-10-01T09:00:00.000Z";
const thesis: MemoryProject = {
  id: "thesis",
  name: "Thesis",
  folders: ["C:\\Users\\Lea\\Thesis"],
  created,
};
const chapter: MemoryProject = {
  id: "chapter",
  name: "Chapter 3",
  folders: ["C:\\Users\\Lea\\Thesis\\Chapter 3\\"],
  created,
};
const kitchen: MemoryProject = {
  id: "kitchen",
  name: "Kitchen",
  folders: [],
  created,
};
const projects = [thesis, chapter, kitchen];
const inFolder = (path: string) => ({ workspace: { path } });

describe("the project a conversation is in", () => {
  it("is the one the person put it in, whatever its folder", () => {
    expect(
      projectOfConversation(
        { project: "kitchen", workspace: { path: "C:\\Users\\Lea\\Thesis" } },
        projects,
      ),
    ).toBe(kitchen);
  });

  it("is none when the person put it in none, even in a linked folder", () => {
    expect(
      projectOfConversation(
        { project: null, workspace: { path: "C:\\Users\\Lea\\Thesis" } },
        projects,
      ),
    ).toBeUndefined();
  });

  it("is otherwise the project its folder, or a folder holding it, is linked to, the nearest one first", () => {
    expect(
      projectOfConversation(inFolder("C:\\Users\\Lea\\Thesis\\data"), projects),
    ).toBe(thesis);
    expect(
      projectOfConversation(
        inFolder("C:\\Users\\Lea\\Thesis\\Chapter 3\\figures"),
        projects,
      ),
    ).toBe(chapter);
  });

  it("compares folders as Windows does: whatever their case, either slash, and a trailing one", () => {
    expect(
      projectOfConversation(inFolder("c:/users/lea/thesis/"), projects),
    ).toBe(thesis);
    expect(
      projectOfConversation(
        inFolder("C:\\USERS\\LEA\\THESIS\\CHAPTER 3"),
        projects,
      ),
    ).toBe(chapter);
  });

  it("does not count a folder whose name only starts like a linked one", () => {
    expect(
      projectOfConversation(inFolder("C:\\Users\\Lea\\Thesis-old"), projects),
    ).toBeUndefined();
  });

  it("is none for a conversation without a folder or a choice", () => {
    expect(projectOfConversation({}, projects)).toBeUndefined();
  });

  it("is never an archived project, chosen or by its folder", () => {
    const archived = projects.map((project) => ({
      ...project,
      archived: true as const,
    }));
    expect(
      projectOfConversation({ project: "kitchen" }, archived),
    ).toBeUndefined();
    expect(
      projectOfConversation(inFolder("C:\\Users\\Lea\\Thesis"), archived),
    ).toBeUndefined();
  });

  it("is the project a chosen one was merged into", () => {
    const merged = { ...kitchen, merged: ["old-kitchen"] };

    expect(
      projectOfConversation({ project: "old-kitchen" }, [thesis, merged]),
    ).toBe(merged);
  });

  it("is none for a chosen project no longer kept", () => {
    expect(
      projectOfConversation({ project: "gone" }, projects),
    ).toBeUndefined();
  });
});

describe("a folder where work of every kind passes", () => {
  const broad = ["C:\\Users\\Lea", "C:\\Users\\Lea\\Documents"];

  it("is a drive's root or one of the person's broad folders, however spelled", () => {
    expect(isBroadFolder("C:\\", broad)).toBe(true);
    expect(isBroadFolder("d:/", broad)).toBe(true);
    expect(isBroadFolder("c:/users/lea/documents/", broad)).toBe(true);
  });

  it("is not a folder inside one", () => {
    expect(isBroadFolder("C:\\Users\\Lea\\Documents\\Thesis", broad)).toBe(
      false,
    );
    expect(isBroadFolder("D:\\Work", broad)).toBe(false);
  });
});
