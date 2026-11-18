import { execSync } from "node:child_process";
import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { holdOpen, TemporaryFolders } from "@zhiyin/test-support";
import { afterEach, describe, expect, it } from "vitest";
import { replaceFile, WrittenFiles } from "../src/index.js";

const folders = new TemporaryFolders();

/** The short name Windows gives a folder, or nothing when it gives none. */
function shortName(path: string): string | undefined {
  try {
    return execSync(`for %I in ("${path}") do @echo %~sI`, {
      encoding: "utf8",
      shell: "cmd.exe",
    }).trim();
  } catch {
    return undefined;
  }
}

afterEach(() => folders.removeAll());

/** A workspace with a drawing in it, and the folder a conversation keeps its record in. */
async function setUp() {
  const workspace = await folders.make("zhiyin-written-");
  const conversation = await folders.make("zhiyin-written-record-");
  const drawing = join(workspace, "engine.pdf");
  await writeFile(drawing, "drawn once");
  return { workspace, record: join(conversation, "written.json"), drawing };
}

describe("files a tool wrote", () => {
  it("knows a file it wrote while nothing has changed it", async () => {
    const { record, drawing } = await setUp();
    const written = new WrittenFiles(record, replaceFile);

    await written.wrote([drawing]);

    expect(await written.unchanged(drawing)).toBe(true);
  });

  it("does not know a file it never wrote, nor one that is missing", async () => {
    const { workspace, record, drawing } = await setUp();
    const written = new WrittenFiles(record, replaceFile);

    expect(await written.unchanged(drawing)).toBe(false);
    expect(await written.unchanged(join(workspace, "gone.pdf"))).toBe(false);
  });

  it("does not know a file changed since it wrote it, until it writes it again", async () => {
    const { record, drawing } = await setUp();
    const written = new WrittenFiles(record, replaceFile);
    await written.wrote([drawing]);

    await writeFile(drawing, "edited by the person");
    expect(await written.unchanged(drawing)).toBe(false);

    await writeFile(drawing, "drawn again");
    await written.wrote([drawing]);
    expect(await written.unchanged(drawing)).toBe(true);
  });

  it("does not know a file the same size and name as one it wrote, with other content", async () => {
    const { record, drawing } = await setUp();
    const written = new WrittenFiles(record, replaceFile);
    await written.wrote([drawing]);

    await writeFile(drawing, "drawn twice");

    expect(await written.unchanged(drawing)).toBe(false);
  });

  it("keeps what it knows for the conversation, after the app starts again", async () => {
    const { record, drawing } = await setUp();
    await new WrittenFiles(record, replaceFile).wrote([drawing]);

    expect(await new WrittenFiles(record, replaceFile).unchanged(drawing)).toBe(
      true,
    );
  });

  it("tells a path by the file it names, whatever its case or way of writing", async () => {
    const { workspace, record, drawing } = await setUp();
    const written = new WrittenFiles(record, replaceFile);
    await written.wrote([drawing]);

    expect(await written.unchanged(join(workspace, ".", "ENGINE.pdf"))).toBe(
      true,
    );
  });

  it("tells a file noted through a folder link by the file itself, either way round", async () => {
    const { workspace, record } = await setUp();
    await mkdir(join(workspace, "renders"));
    await symlink(
      join(workspace, "renders"),
      join(workspace, "out"),
      "junction",
    );
    const real = join(workspace, "renders", "part.png");
    const linked = join(workspace, "out", "part.png");
    await writeFile(real, "rendered");
    const written = new WrittenFiles(record, replaceFile);

    await written.wrote([linked]);
    expect(await written.unchanged(real)).toBe(true);

    await writeFile(join(workspace, "renders", "side.png"), "rendered");
    await written.wrote([join(workspace, "renders", "side.png")]);
    expect(await written.unchanged(join(workspace, "out", "side.png"))).toBe(
      true,
    );
  });

  /** Windows makes short names only on drives set to, so this is skipped where it makes none. */
  it("tells a file by the file itself when its path is given by a short name", async () => {
    const { workspace, record } = await setUp();
    const long = join(workspace, "my drawings folder");
    await mkdir(long);
    const drawing = join(long, "engine.pdf");
    await writeFile(drawing, "drawn once");
    const short = shortName(long);
    if (!short || short.toLowerCase() === long.toLowerCase()) return;
    const written = new WrittenFiles(record, replaceFile);

    await written.wrote([drawing]);

    expect(await written.unchanged(join(short, "engine.pdf"))).toBe(true);
  });

  it("keeps every file of calls that finish at once", async () => {
    const { workspace, record } = await setUp();
    const written = new WrittenFiles(record, replaceFile);
    const paths = await Promise.all(
      Array.from({ length: 8 }, async (_, index) => {
        const path = join(workspace, `sheet-${index}.png`);
        await writeFile(path, `sheet ${index}`);
        return path;
      }),
    );

    await Promise.all(paths.map((path) => written.wrote([path])));

    for (const path of paths) expect(await written.unchanged(path)).toBe(true);
  });

  it("notes a file while another program briefly holds the record open", async () => {
    const { workspace, record, drawing } = await setUp();
    const written = new WrittenFiles(record, replaceFile);
    await written.wrote([drawing]);
    const sheet = join(workspace, "sheet.png");
    await writeFile(sheet, "drawn");
    const release = holdOpen(record);
    setTimeout(release, 300);

    await written.wrote([sheet]);

    expect(await written.unchanged(sheet)).toBe(true);
    expect(await written.unchanged(drawing)).toBe(true);
  });

  it("knows nothing from a record that cannot be read, and writes a new one", async () => {
    const { record, drawing } = await setUp();
    await writeFile(record, "{ half written");
    const written = new WrittenFiles(record, replaceFile);

    expect(await written.unchanged(drawing)).toBe(false);
    await written.wrote([drawing]);
    expect(JSON.parse(await readFile(record, "utf8"))).toBeTypeOf("object");
    expect(await written.unchanged(drawing)).toBe(true);
  });
});
