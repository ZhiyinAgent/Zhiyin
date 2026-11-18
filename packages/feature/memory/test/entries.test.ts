import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FileMemory } from "../src/index.js";
import { conversation, folders, memoryIn, typst } from "./fixture.js";

afterEach(() => folders.removeAll());

async function knowledgeFiles(folder: string, scope = "everything") {
  const where = join(folder, scope, "knowledge");
  return (await readdir(where)).map((name) => join(where, name));
}

describe("the memory folder", () => {
  it("is made when it is asked for before anything is kept", async () => {
    const { memory, folder } = await memoryIn();

    expect(await memory.folder()).toBe(folder);
    expect(await readdir(folder)).toEqual([]);
  });
});

describe("entries are Markdown files", () => {
  it("keeps a Knowledge entry as a file whose first lines say what it is", async () => {
    const { memory, folder } = await memoryIn();

    const kept = await memory.remember(typst, conversation());

    expect(kept.ok).toBe(true);
    const [file] = await knowledgeFiles(folder);
    const content = await readFile(file!, "utf8");
    expect(content).toBe(
      [
        "---",
        "number: 1",
        "title: Typst over LaTeX",
        "summary: The university template needs a grid the LaTeX class breaks",
        "section: knowledge",
        "written: 2026-10-31T09:00:00.000Z",
        "used: 2026-10-31T09:00:00.000Z",
        "conversation-id: c1",
        "conversation: Thesis template setup",
        "---",
        "",
        "Chosen on 3 October. The title page needs the logo and the jury list on a grid.",
        "",
      ].join("\n"),
    );
  });

  it("names the file after the entry's number and title", async () => {
    const { memory, folder } = await memoryIn();

    await memory.remember(typst, conversation());

    expect(await knowledgeFiles(folder)).toEqual([
      join(folder, "everything", "knowledge", "1 typst-over-latex.md"),
    ]);
  });

  it("reads what an earlier start of the app kept", async () => {
    const { memory, folder } = await memoryIn();
    await memory.remember(typst, conversation());

    const again = new FileMemory({
      folder,
      now: () => new Date(),
      newId: () => "x",
      broadFolders: [],
      recycle: async () => {},
    });

    expect((await again.state()).entries).toMatchObject([
      { number: 1, title: "Typst over LaTeX", scope: "everything" },
    ]);
  });

  it("never gives a number again, even after its entry is removed and the app restarts", async () => {
    const { memory, folder } = await memoryIn();
    await memory.remember(typst, conversation());
    await memory.remember(
      { ...typst, title: "Zotero library" },
      conversation(),
    );
    await memory.remember({ number: 2, remove: true }, conversation());

    const again = new FileMemory({
      folder,
      now: () => new Date(),
      newId: () => "x",
      broadFolders: [],
      recycle: async () => {},
    });
    const kept = await again.remember(
      { ...typst, title: "Météo-France open data" },
      conversation(),
    );

    expect(kept.ok && kept.answer["number"]).toBe(3);
  });

  it("reads a file changed outside Zhiyin again, and the change holds", async () => {
    const { memory, folder } = await memoryIn();
    await memory.remember(typst, conversation());
    const [file] = await knowledgeFiles(folder);

    const content = await readFile(file!, "utf8");
    await writeFile(
      file!,
      content.replace("on 3 October", "on 4 October, after a call"),
    );

    expect((await memory.state()).entries[0]?.text).toBe(
      "Chosen on 4 October, after a call. The title page needs the logo and the jury list on a grid.",
    );
  });

  it("forgets an entry whose file was deleted outside Zhiyin", async () => {
    const { memory, folder } = await memoryIn();
    await memory.remember(typst, conversation());
    const [file] = await knowledgeFiles(folder);

    await rm(file!);

    expect((await memory.state()).entries).toEqual([]);
  });

  it("takes a Markdown file the person put in a scope's folder as a new entry", async () => {
    const { memory, folder } = await memoryIn();
    await memory.remember(typst, conversation());
    const where = join(folder, "everything", "knowledge");
    await writeFile(
      join(where, "zotero.md"),
      "# Zotero library\n\nReferences live in the Zotero group “Thèse”.\n",
    );

    const entries = (await memory.state()).entries;

    expect(entries).toContainEqual(
      expect.objectContaining({
        number: 2,
        title: "Zotero library",
        section: "knowledge",
        text: "References live in the Zotero group “Thèse”.",
      }),
    );
    expect(await readFile(join(where, "zotero.md"), "utf8")).toMatch(
      /^---\nnumber: 2\ntitle: Zotero library\n/,
    );
  });

  it("gives a copied file a number of its own, so two entries never share one", async () => {
    const { memory, folder } = await memoryIn();
    await memory.remember(typst, conversation());
    const [file] = await knowledgeFiles(folder);
    const copy = join(folder, "everything", "knowledge", "copy.md");
    await writeFile(copy, await readFile(file!, "utf8"));

    const numbers = (await memory.state()).entries.map((entry) => entry.number);

    expect(numbers.sort()).toEqual([1, 2]);
  });

  it("keeps a project's entries in the project's folder", async () => {
    const { memory, folder } = await memoryIn();
    const made = await memory.createProject("Thèse");
    const project = made.project!.id;

    await memory.remember(
      { ...typst, scope: "project" },
      conversation([], { project }),
    );

    expect(
      await readdir(join(folder, "projects", "these", "knowledge")),
    ).toEqual(["1 typst-over-latex.md"]);
    expect((await memory.state()).entries[0]?.scope).toBe(project);
  });

  it("reads nothing from a memory folder that does not exist yet", async () => {
    const parent = await folders.make("zhiyin-memory-");
    const { memory } = await memoryIn({ folder: join(parent, "absent") });

    expect(await memory.state()).toMatchObject({
      on: true,
      entries: [],
      projects: [],
    });
  });

  it("skips a folder in a scope that is not a Markdown file", async () => {
    const { memory, folder } = await memoryIn();
    await memory.remember(typst, conversation());
    await mkdir(join(folder, "everything", "knowledge", "pictures"));
    await writeFile(join(folder, "everything", "knowledge", "notes.txt"), "x");

    expect((await memory.state()).entries).toHaveLength(1);
  });
});

describe("telling of changes", () => {
  it("tells its listeners after each change, not after a refusal or a plain read", async () => {
    const { memory } = await memoryIn();
    let told = 0;
    const stop = memory.onChange(() => (told += 1));

    await memory.remember(typst, conversation());
    await memory.add({ scope: "everything", section: "how", text: "Short." });
    await memory.state();
    await memory.edit(999, { text: "Nothing is there." });
    await memory.switch(false);
    stop();
    await memory.switch(true);

    expect(told).toBe(3);
  });

  it("keeps the change when a listener fails", async () => {
    const { memory } = await memoryIn();
    memory.onChange(() => {
      throw new Error("The window is gone.");
    });

    await expect(memory.remember(typst, conversation())).resolves.toMatchObject(
      { ok: true },
    );
    expect((await memory.state()).entries).toHaveLength(1);
  });
});
