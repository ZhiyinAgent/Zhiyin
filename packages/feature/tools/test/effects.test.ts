/**
 * What each built-in tool call declares it does (ADR 0012), from its
 * arguments and the files they name. A file downloaded from the internet is
 * marked here as a browser marks it, by its `Zone.Identifier` stream.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ActionEffects, ToolCallInspection } from "@zhiyin/contract";
import { TemporaryFolders } from "@zhiyin/test-support";
import {
  WorkspaceTools,
  type CommandContainment,
  type ConversationItems,
  type RecycleBin,
} from "../src/index.js";

const folders = new TemporaryFolders();

afterEach(() => folders.removeAll());

/** A call that does nothing at all: each test names what it does. */
const nothing: ActionEffects = {
  reads: "none",
  changes: "none",
  sends: "none",
  actsAsPerson: "none",
  runs: "none",
  lasting: false,
  brings: "none",
};

/** A folder holding `files`, each with the text it is named with. */
async function folderWith(files: Record<string, string> = {}) {
  const root = await folders.make("zhiyin-effects-");
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), text);
  }
  return root;
}

/** Marks a file as Windows marks one downloaded from a zone. */
async function markDownloaded(path: string, zone = 3): Promise<void> {
  await writeFile(
    `${path}:Zone.Identifier`,
    `[ZoneTransfer]\r\nZoneId=${zone}\r\nHostUrl=https://example.com/file\r\n`,
  );
}

function effectsOf(inspection: ToolCallInspection): ActionEffects | undefined {
  if (!inspection.ok) throw new Error(inspection.reason);
  return inspection.effects;
}

/** A Recycle Bin that takes everything. */
const recycleBin: RecycleBin = {
  recyclable: async (paths) => new Map(paths.map((path) => [path, true])),
  recycle: async () => undefined,
};

/** What a conversation kept, which inspecting never opens. */
const items: ConversationItems = {
  locate: async () => ({ status: "missing", reason: "Not kept." }),
  keepOutput: async () => ({ status: "refused", reason: "Not kept." }),
  lastRead: async () => undefined,
  noteRead: async () => undefined,
};

describe("reading declares where it reads, and outside content when a file is downloaded", () => {
  it("read_file reads the workspace, elsewhere, or what the conversation kept", async () => {
    const root = await folderWith({ "notes.md": "notes" });
    const outside = join(await folderWith({ "other.md": "x" }), "other.md");
    const tools = new WorkspaceTools(root, { items });

    expect(
      effectsOf(await tools.inspect("read_file", { path: "notes.md" })),
    ).toEqual({ ...nothing, reads: "workspace" });
    expect(
      effectsOf(await tools.inspect("read_file", { path: outside })),
    ).toEqual({ ...nothing, reads: "elsewhere" });
    expect(
      effectsOf(await tools.inspect("read_file", { path: "output://out-1" })),
    ).toEqual({ ...nothing, reads: "app" });
  });

  it("read_file brings outside content from a file downloaded from the internet", async () => {
    const root = await folderWith({
      "download.txt": "from a website",
      "restricted.txt": "from a restricted site",
      "trusted.txt": "from a trusted site",
    });
    const outside = join(await folderWith({ "other.md": "x" }), "other.md");
    await markDownloaded(join(root, "download.txt"), 3);
    await markDownloaded(join(root, "restricted.txt"), 4);
    await markDownloaded(join(root, "trusted.txt"), 2);
    await markDownloaded(outside, 3);
    const tools = new WorkspaceTools(root);

    expect(
      effectsOf(await tools.inspect("read_file", { path: "download.txt" })),
    ).toEqual({ ...nothing, reads: "workspace", brings: "outside" });
    expect(
      effectsOf(await tools.inspect("read_file", { path: "restricted.txt" })),
    ).toEqual({ ...nothing, reads: "workspace", brings: "outside" });
    expect(
      effectsOf(await tools.inspect("read_file", { path: "trusted.txt" })),
    ).toEqual({ ...nothing, reads: "workspace" });
    expect(
      effectsOf(await tools.inspect("read_file", { path: outside })),
    ).toEqual({ ...nothing, reads: "elsewhere", brings: "outside" });
  });

  it("read_files brings outside content when any of its files is downloaded", async () => {
    const root = await folderWith({ "a.md": "a", "b.md": "b" });
    const tools = new WorkspaceTools(root);

    expect(
      effectsOf(await tools.inspect("read_files", { paths: ["a.md", "b.md"] })),
    ).toEqual({ ...nothing, reads: "workspace" });

    await markDownloaded(join(root, "b.md"));
    expect(
      effectsOf(await tools.inspect("read_files", { paths: ["a.md", "b.md"] })),
    ).toEqual({ ...nothing, reads: "workspace", brings: "outside" });
  });

  it("read_document reads the workspace, elsewhere, or an attached picture", async () => {
    const root = await folderWith({ "report.pdf": "%PDF", "web.pdf": "%PDF" });
    const outside = join(await folderWith({ "o.pdf": "%PDF" }), "o.pdf");
    await markDownloaded(join(root, "web.pdf"));
    const tools = new WorkspaceTools(root, { items });

    expect(
      effectsOf(await tools.inspect("read_document", { path: "report.pdf" })),
    ).toEqual({ ...nothing, reads: "workspace" });
    expect(
      effectsOf(await tools.inspect("read_document", { path: "web.pdf" })),
    ).toEqual({ ...nothing, reads: "workspace", brings: "outside" });
    expect(
      effectsOf(await tools.inspect("read_document", { path: outside })),
    ).toEqual({ ...nothing, reads: "elsewhere" });
    expect(
      effectsOf(
        await tools.inspect("read_document", { path: "attachment://shot" }),
      ),
    ).toEqual({ ...nothing, reads: "app" });
  });

  it("compare_pictures reads where its pictures are, and brings a downloaded one", async () => {
    const root = await folderWith({ "a.png": "png", "b.png": "png" });
    const outside = join(await folderWith({ "o.png": "png" }), "o.png");
    const tools = new WorkspaceTools(root, { items });

    expect(
      effectsOf(
        await tools.inspect("compare_pictures", {
          first: "a.png",
          second: "b.png",
        }),
      ),
    ).toEqual({ ...nothing, reads: "workspace" });
    expect(
      effectsOf(
        await tools.inspect("compare_pictures", {
          first: "a.png",
          second: outside,
        }),
      ),
    ).toEqual({ ...nothing, reads: "elsewhere" });
    expect(
      effectsOf(
        await tools.inspect("compare_pictures", {
          first: "attachment://before",
          second: "attachment://after",
        }),
      ),
    ).toEqual({ ...nothing, reads: "app" });

    await markDownloaded(join(root, "b.png"));
    expect(
      effectsOf(
        await tools.inspect("compare_pictures", {
          first: "a.png",
          second: "b.png",
        }),
      ),
    ).toEqual({ ...nothing, reads: "workspace", brings: "outside" });
  });

  it("list_directory and find_files read where they look, and return only names", async () => {
    const root = await folderWith({ "web.txt": "x" });
    await markDownloaded(join(root, "web.txt"));
    const parent = dirname(root);
    const tools = new WorkspaceTools(root);

    expect(
      effectsOf(await tools.inspect("list_directory", { path: ".", depth: 1 })),
    ).toEqual({ ...nothing, reads: "workspace" });
    expect(
      effectsOf(
        await tools.inspect("list_directory", { path: parent, depth: 1 }),
      ),
    ).toEqual({ ...nothing, reads: "elsewhere" });
    expect(
      effectsOf(await tools.inspect("find_files", { pattern: "*.txt" })),
    ).toEqual({ ...nothing, reads: "workspace" });
  });

  it("search_files declares a workspace read before it runs, whatever it will find", async () => {
    const root = await folderWith({ "web.md": "a page about the budget" });
    await markDownloaded(join(root, "web.md"));
    const tools = new WorkspaceTools(root);

    expect(
      effectsOf(await tools.inspect("search_files", { query: "budget" })),
    ).toEqual({ ...nothing, reads: "workspace" });
  });

  it("search_files's answer brings outside content only when a line it shows is from a downloaded file", async () => {
    const root = await folderWith({
      "plan.md": "budget for spring",
      "web.md": "a page about the budget",
      "other.md": "nothing to see",
    });
    await markDownloaded(join(root, "web.md"));
    const tools = new WorkspaceTools(root);

    const fromThePerson = await tools.execute("search_files", {
      query: "spring",
    });
    expect(fromThePerson).toMatchObject({ ok: true });
    expect(fromThePerson).not.toHaveProperty("brings");
    expect(
      await tools.execute("search_files", { query: "budget" }),
    ).toMatchObject({ ok: true, brings: "outside" });
    expect(
      await tools.execute("search_files", { query: "budget", files: "p*" }),
    ).not.toHaveProperty("brings");
  });

  it("search_files's answer does not bring a downloaded file whose lines fall past those it shows", async () => {
    const root = await folderWith({
      "a.md": Array.from({ length: 150 }, (_, i) => `budget ${i}`).join("\n"),
      "z.md": "budget from the web",
    });
    await markDownloaded(join(root, "z.md"));
    const tools = new WorkspaceTools(root);

    const answer = await tools.execute("search_files", { query: "budget" });
    expect(answer).toMatchObject({ ok: true, value: { truncated: true } });
    expect(answer).not.toHaveProperty("brings");
  });
});

describe("writing declares the workspace, elsewhere, and what runs later", () => {
  it("write_file changes the workspace with a backup, or elsewhere", async () => {
    const root = await folderWith({ "notes.md": "old" });
    const outside = join(await folderWith(), "new.md");
    const tools = new WorkspaceTools(root);

    expect(
      effectsOf(
        await tools.inspect("write_file", { path: "draft.md", content: "x" }),
      ),
    ).toEqual({ ...nothing, reads: "workspace", changes: "workspace" });
    expect(
      effectsOf(
        await tools.inspect("write_file", { path: "notes.md", content: "x" }),
      ),
    ).toEqual({ ...nothing, reads: "workspace", changes: "workspace" });
    expect(
      effectsOf(
        await tools.inspect("write_file", { path: outside, content: "x" }),
      ),
    ).toEqual({ ...nothing, reads: "elsewhere", changes: "elsewhere" });
  });

  it("write_file into a .git folder or a Startup folder leaves something that runs later", async () => {
    const root = await folderWith({ ".git/HEAD": "ref: refs/heads/main" });
    const startup = join(
      await folderWith(),
      "AppData",
      "Roaming",
      "Microsoft",
      "Windows",
      "Start Menu",
      "Programs",
      "Startup",
    );
    await mkdir(startup, { recursive: true });
    const tools = new WorkspaceTools(root);

    expect(
      effectsOf(
        await tools.inspect("write_file", {
          path: ".git/hooks/pre-commit",
          content: "#!/bin/sh",
        }),
      ),
    ).toEqual({
      ...nothing,
      reads: "workspace",
      changes: "workspace",
      lasting: true,
    });
    expect(
      effectsOf(
        await tools.inspect("write_file", {
          path: ".GIT/config",
          content: "[core]",
        }),
      ),
    ).toEqual({
      ...nothing,
      reads: "workspace",
      changes: "workspace",
      lasting: true,
    });
    expect(
      effectsOf(
        await tools.inspect("write_file", {
          path: join(startup, "run.cmd"),
          content: "echo",
        }),
      ),
    ).toEqual({
      ...nothing,
      reads: "elsewhere",
      changes: "elsewhere",
      lasting: true,
    });
  });

  it("multi_edit changes the workspace, elsewhere, and what runs later", async () => {
    const root = await folderWith({
      "notes.md": "Owner: Dana",
      ".git/config": "[core]\n\tbare = false",
    });
    const outside = join(
      await folderWith({ "plan.md": "Owner: Dana" }),
      "plan.md",
    );
    const tools = new WorkspaceTools(root);
    const edit = (path: string, find: string) => ({
      edits: [{ path, replacements: [{ find, replace: "changed" }] }],
    });

    expect(
      effectsOf(await tools.inspect("multi_edit", edit("notes.md", "Dana"))),
    ).toEqual({ ...nothing, reads: "workspace", changes: "workspace" });
    expect(
      effectsOf(await tools.inspect("multi_edit", edit(outside, "Dana"))),
    ).toEqual({ ...nothing, reads: "elsewhere", changes: "elsewhere" });
    expect(
      effectsOf(
        await tools.inspect("multi_edit", edit(".git/config", "false")),
      ),
    ).toEqual({
      ...nothing,
      reads: "workspace",
      changes: "workspace",
      lasting: true,
    });
  });
});

describe("deleting declares whether Zhiyin can put it back", () => {
  it("to the Recycle Bin in the workspace, for good, and outside it", async () => {
    const root = await folderWith({ "a.md": "a", "b.md": "b" });
    const outside = join(await folderWith({ "o.md": "o" }), "o.md");
    const tools = new WorkspaceTools(root, { recycleBin });

    expect(
      effectsOf(await tools.inspect("delete_file", { paths: ["a.md"] })),
    ).toEqual({ ...nothing, reads: "workspace", changes: "workspace" });
    expect(
      effectsOf(
        await tools.inspect("delete_file", {
          paths: ["a.md"],
          mode: "permanent",
        }),
      ),
    ).toEqual({
      ...nothing,
      reads: "workspace",
      changes: "workspace-for-good",
    });
    expect(
      effectsOf(await tools.inspect("delete_file", { paths: [outside] })),
    ).toEqual({ ...nothing, reads: "elsewhere", changes: "elsewhere" });
  });

  it("is for good when there is no Recycle Bin", async () => {
    const root = await folderWith({ "a.md": "a" });
    const tools = new WorkspaceTools(root);

    expect(
      effectsOf(await tools.inspect("delete_file", { paths: ["a.md"] })),
    ).toEqual({
      ...nothing,
      reads: "workspace",
      changes: "workspace-for-good",
    });
  });
});

describe("commands declare the person's full access", () => {
  /** Inspecting never starts a process, so no container is ever opened. */
  const containment: CommandContainment = {
    open: () => {
      throw new Error("Inspecting opened a container.");
    },
  };

  it("a shell command runs with full access, reaches anywhere and anything, and brings what it prints", async () => {
    const tools = new WorkspaceTools(await folderWith(), {
      shell: "bash.exe",
    });

    expect(
      effectsOf(
        await tools.inspect("bash", {
          command: "git status",
          purpose: "Shows what changed.",
        }),
      ),
    ).toEqual({
      ...nothing,
      reads: "elsewhere",
      changes: "elsewhere",
      sends: "chosen",
      runs: "full-access",
      brings: "outside",
    });
  });

  it("a shell command may change any file in the workspace, which is copied first, and nothing is held from it", async () => {
    const tools = new WorkspaceTools(await folderWith(), {
      shell: "bash.exe",
    });

    expect(
      await tools.inspect("bash", {
        command: "python convert.py",
        purpose: "Converts the data.",
      }),
    ).toMatchObject({ ok: true, changesAnyFile: { writable: [] } });
  });

  it("looking at a job reads Zhiyin's own records, and stopping one changes them", async () => {
    const tools = new WorkspaceTools(await folderWith(), {
      shell: "bash.exe",
      containment,
    });

    expect(effectsOf(await tools.inspect("job_output", { job: "J1" }))).toEqual(
      { ...nothing, reads: "app", brings: "outside" },
    );
    expect(effectsOf(await tools.inspect("stop_job", { job: "J1" }))).toEqual({
      ...nothing,
      reads: "app",
      changes: "app",
    });
  });
});

describe("closing the document beside the conversation", () => {
  it("reads and changes nothing", async () => {
    const tools = new WorkspaceTools(await folderWith());

    expect(effectsOf(await tools.inspect("close_document", {}))).toEqual(
      nothing,
    );
  });
});

describe("what a read of something the conversation kept shows the person", () => {
  it("says where it comes from in words, never by its id", async () => {
    const root = await folderWith({ "notes.md": "notes" });
    const tools = new WorkspaceTools(root, { items });

    const output = await tools.inspect("read_file", { path: "output://out-1" });
    const attached = await tools.inspect("read_document", {
      path: "attachment://pic-1",
    });
    const several = await tools.inspect("read_files", {
      paths: ["notes.md", "output://out-1"],
    });

    expect(output).toMatchObject({
      ok: true,
      target: "kept in this conversation",
    });
    expect(attached).toMatchObject({
      ok: true,
      target: "attached to this conversation",
    });
    expect(several).toMatchObject({
      ok: true,
      target: "notes.md, a saved output kept in this conversation",
    });
  });
});
