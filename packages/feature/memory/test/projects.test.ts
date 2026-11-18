import { access, readdir } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FileMemory } from "../src/index.js";
import { conversation, folders, memoryIn } from "./fixture.js";

afterEach(() => folders.removeAll());

const home = "C:\\Users\\lea";
const broadFolders = [
  home,
  `${home}\\Documents`,
  `${home}\\Desktop`,
  `${home}\\Downloads`,
];
const thesisFolder = `${home}\\Documents\\Thèse`;

describe("which project a folder's conversations belong to", () => {
  it("finds the project a folder is linked to, and every folder inside it", async () => {
    const { memory } = await memoryIn({ broadFolders });
    const thesis = (await memory.createProject("Thesis", [thesisFolder]))
      .project!;

    expect((await memory.projectFor(thesisFolder))?.id).toBe(thesis.id);
    expect((await memory.projectFor(`${thesisFolder}\\chapitres`))?.id).toBe(
      thesis.id,
    );
    expect(
      (await memory.projectFor("c:\\users\\LEA\\documents\\thèse\\"))?.id,
    ).toBe(thesis.id);
  });

  it("finds none for a folder outside every link, or for no folder", async () => {
    const { memory } = await memoryIn({ broadFolders });
    await memory.createProject("Thesis", [thesisFolder]);

    expect(
      await memory.projectFor(`${home}\\Documents\\Taxes`),
    ).toBeUndefined();
    expect(
      await memory.projectFor(`${home}\\Documents\\Thèse old`),
    ).toBeUndefined();
    expect(await memory.projectFor(undefined)).toBeUndefined();
  });

  it("lets the most specific link hold", async () => {
    const { memory } = await memoryIn({ broadFolders });
    await memory.createProject("Thesis", [thesisFolder]);
    const data = (
      await memory.createProject("Data", [`${thesisFolder}\\données`])
    ).project!;

    expect(
      (await memory.projectFor(`${thesisFolder}\\données\\2025`))?.id,
    ).toBe(data.id);
  });

  it("joins several folders to one project", async () => {
    const { memory } = await memoryIn({ broadFolders });
    const app = (
      await memory.createProject("Tessera", ["D:\\code\\tessera-web"])
    ).project!;
    await memory.linkFolder(app.id, "D:\\code\\tessera-api");

    expect((await memory.projectFor("D:\\code\\tessera-api\\src"))?.id).toBe(
      app.id,
    );
    expect((await memory.projectFor("D:\\code\\tessera-web"))?.id).toBe(app.id);
  });

  it("never links a broad folder or a drive's root", async () => {
    const { memory } = await memoryIn({ broadFolders });
    const thesis = (await memory.createProject("Thesis")).project!;

    for (const folder of [
      ...broadFolders,
      "D:\\",
      "c:\\users\\lea\\downloads\\",
    ])
      expect(await memory.linkFolder(thesis.id, folder)).toEqual({
        ok: false,
        reason: `${folder} holds work of every kind, so it is never linked to a project. Pick a folder inside it.`,
      });
  });

  it("refuses a folder already linked to another project", async () => {
    const { memory } = await memoryIn({ broadFolders });
    await memory.createProject("Thesis", [thesisFolder]);
    const other = (await memory.createProject("Other")).project!;

    expect(await memory.linkFolder(other.id, `${thesisFolder}\\`)).toEqual({
      ok: false,
      reason: `${thesisFolder}\\ is already linked to Thesis.`,
    });
  });

  it("keeps the project and its memory when a folder is unlinked", async () => {
    const { memory } = await memoryIn({ broadFolders });
    const thesis = (await memory.createProject("Thesis", [thesisFolder]))
      .project!;

    await memory.unlinkFolder(thesis.id, thesisFolder);

    expect(await memory.projectFor(thesisFolder)).toBeUndefined();
    expect((await memory.state()).projects).toMatchObject([
      { id: thesis.id, name: "Thesis", folders: [] },
    ]);
  });

  it("sends nothing of an archived project by itself", async () => {
    const { memory } = await memoryIn({ broadFolders });
    const thesis = (await memory.createProject("Thesis", [thesisFolder]))
      .project!;

    await memory.archiveProject(thesis.id, true);

    expect(await memory.projectFor(thesisFolder)).toBeUndefined();
    expect((await memory.state()).projects).toMatchObject([{ archived: true }]);
  });
});

describe("making and changing projects", () => {
  it("refuses a name another project has", async () => {
    const { memory } = await memoryIn();
    await memory.createProject("Thesis");

    expect(await memory.createProject(" thesis ")).toEqual({
      ok: false,
      reason: "A project is already called Thesis.",
    });
  });

  it("refuses an empty name", async () => {
    const { memory } = await memoryIn();

    expect(await memory.createProject("  ")).toEqual({
      ok: false,
      reason: "A project needs a name.",
    });
  });

  it("keeps a project's id when it is renamed", async () => {
    const { memory } = await memoryIn();
    const thesis = (await memory.createProject("Thesis")).project!;

    await memory.renameProject(thesis.id, "Thèse");

    expect((await memory.state()).projects).toMatchObject([
      { id: thesis.id, name: "Thèse" },
    ]);
  });

  it("merges a project into another, its entries keeping their numbers", async () => {
    const { memory, folder } = await memoryIn({ broadFolders });
    const thesis = (await memory.createProject("Thesis", [thesisFolder]))
      .project!;
    const data = (await memory.createProject("Data", ["D:\\données"])).project!;
    await memory.remember(
      {
        section: "knowledge",
        scope: "project",
        title: "Station 4 gap",
        summary: "August 2025",
        text: "Lost.",
      },
      conversation([], { project: data.id }),
    );

    await memory.mergeProject(data.id, thesis.id);

    const state = await memory.state();
    expect(state.projects).toMatchObject([
      { id: thesis.id, folders: [thesisFolder, "D:\\données"] },
    ]);
    expect(state.entries).toMatchObject([{ number: 1, scope: thesis.id }]);
    expect(await readdir(join(folder, "projects"))).toEqual(["thesis"]);
  });

  it("names a merged project among those the other now holds, so its conversations follow", async () => {
    const { memory } = await memoryIn();
    const thesis = (await memory.createProject("Thesis")).project!;
    const data = (await memory.createProject("Data")).project!;
    const pilot = (await memory.createProject("Pilot")).project!;

    await memory.mergeProject(pilot.id, data.id);
    await memory.mergeProject(data.id, thesis.id);

    expect((await memory.state()).projects).toEqual([
      expect.objectContaining({ id: thesis.id, merged: [data.id, pilot.id] }),
    ]);
  });

  it("leaves the folders on one project when the merged one cannot go to the Recycle Bin", async () => {
    const folder = join(await folders.make("zhiyin-memory-"), "memory");
    let ids = 0;
    let recycling = false;
    const memory = new FileMemory({
      folder,
      now: () => new Date("2026-10-31T09:00:00.000Z"),
      newId: () => `w${(ids += 1)}`,
      broadFolders,
      recycle: async () => {
        if (!recycling) throw new Error("The Recycle Bin is full.");
        const { rm } = await import("node:fs/promises");
        await rm(join(folder, "projects", "data"), { recursive: true });
      },
    });
    const thesis = (await memory.createProject("Thesis", [thesisFolder]))
      .project!;
    const data = (await memory.createProject("Data", ["D:\\données"])).project!;

    await expect(memory.mergeProject(data.id, thesis.id)).rejects.toThrow(
      "The Recycle Bin is full.",
    );
    const halfway = (await memory.state()).projects;
    recycling = true;
    await memory.mergeProject(data.id, thesis.id);

    expect(halfway).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: thesis.id,
          folders: [thesisFolder, "D:\\données"],
        }),
        expect.objectContaining({ id: data.id, folders: [] }),
      ]),
    );
    expect((await memory.state()).projects).toMatchObject([
      { id: thesis.id, folders: [thesisFolder, "D:\\données"] },
    ]);
  });

  it("still holds the projects merged into it after being archived and brought back", async () => {
    const { memory } = await memoryIn();
    const thesis = (await memory.createProject("Thesis")).project!;
    const data = (await memory.createProject("Data")).project!;
    await memory.mergeProject(data.id, thesis.id);

    await memory.archiveProject(thesis.id, true);
    await memory.archiveProject(thesis.id, false);

    expect((await memory.state()).projects).toEqual([
      expect.objectContaining({ id: thesis.id, merged: [data.id] }),
    ]);
  });

  it("refuses to merge when both projects have a brief or a How to work, so nothing is lost", async () => {
    const { memory } = await memoryIn();
    const one = (await memory.createProject("One")).project!;
    const two = (await memory.createProject("Two")).project!;
    for (const project of [one, two])
      await memory.remember(
        { section: "brief", summary: "x", text: "y" },
        conversation([], { project: project.id }),
      );

    expect(await memory.mergeProject(two.id, one.id)).toEqual({
      ok: false,
      reason:
        "Both projects have a brief. Join the two into one first, then merge.",
    });
  });

  it("moves a deleted project's memory to the Recycle Bin", async () => {
    const recycled: string[] = [];
    const { memory, folder } = await memoryIn({ recycled });
    const thesis = (await memory.createProject("Thesis")).project!;

    await memory.deleteProject(thesis.id);

    expect(recycled).toEqual([join(folder, "projects", "thesis")]);
    expect((await memory.state()).projects).toEqual([]);
    await expect(access(join(folder, "projects", "thesis"))).rejects.toThrow();
  });

  it("keeps a project it cannot move to a Recycle Bin, rather than deleting it for good", async () => {
    const folder = join(await folders.make("zhiyin-memory-"), "memory");
    const memory = new FileMemory({
      folder,
      now: () => new Date("2026-10-31T09:00:00.000Z"),
      newId: () => `p${Math.random()}`,
      broadFolders,
    });
    const thesis = (await memory.createProject("Thesis")).project!;
    const data = (await memory.createProject("Data")).project!;

    expect(await memory.deleteProject(thesis.id)).toEqual({
      ok: false,
      reason: "There is no Recycle Bin here to move it to, so it was kept.",
    });
    expect(await memory.mergeProject(data.id, thesis.id)).toEqual({
      ok: false,
      reason: "There is no Recycle Bin here to move it to, so it was kept.",
    });
    expect((await memory.state()).projects).toHaveLength(2);
    expect(await readdir(join(folder, "projects"))).toEqual(
      expect.arrayContaining(["thesis", "data"]),
    );
  });

  it("never gives a deleted project's id to a new one, even of the same name", async () => {
    const { memory } = await memoryIn();
    const first = (await memory.createProject("Thesis")).project!;
    await memory.deleteProject(first.id);

    const second = (await memory.createProject("Thesis")).project!;

    expect(second.id).not.toBe(first.id);
  });

  it("moves a Knowledge entry only to a scope with room for it", async () => {
    const { memory } = await memoryIn();
    const thesis = (await memory.createProject("Thesis")).project!;
    for (let index = 0; index < 200; index += 1)
      await memory.add({
        scope: "everything",
        section: "knowledge",
        title: `Fact ${index}`,
        text: "x",
      });
    const own = await memory.add({
      scope: thesis.id,
      section: "knowledge",
      title: "Station 4 gap",
      text: "Lost.",
    });

    expect(await memory.move(own.number!, "everything")).toEqual({
      ok: false,
      reason: expect.stringContaining("already holds 200 Knowledge entries"),
    });
    expect(
      await memory.add({
        scope: "everything",
        section: "knowledge",
        title: "One more",
        text: "x",
      }),
    ).toEqual({
      ok: false,
      reason: expect.stringContaining("already holds 200 Knowledge entries"),
    });
  });

  it("moves a Knowledge entry to another scope, keeping its number", async () => {
    const { memory } = await memoryIn();
    const thesis = (await memory.createProject("Thesis")).project!;
    await memory.remember(
      {
        section: "knowledge",
        scope: "project",
        title: "Zotero",
        summary: "Refs",
        text: "x",
      },
      conversation([], { project: thesis.id }),
    );

    await memory.move(1, "everything");

    expect((await memory.state()).entries).toMatchObject([
      { number: 1, scope: "everything" },
    ]);
  });
});
