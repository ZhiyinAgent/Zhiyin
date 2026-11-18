/**
 * A script given folders outside the workspace, which Zhiyin copies before
 * it runs (ADR 0012), is allowed for the conversation by those folders, as a
 * write outside the workspace is (ADR 0012): the grant named by the folder,
 * covering the script's changes there and a file tool's alike. A folder that
 * holds nearly everything, or one where what is written runs later, is
 * never offered or covered.
 */

import { homedir } from "node:os";
import { join, parse, sep } from "node:path";
import { describe, expect, it } from "vitest";
import type { ToolCallInspection } from "@zhiyin/contract";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { matchingFiles, offeredFiles } from "../src/standing-grants.js";

/** What a file holds now, as the agent loop reads it for the rules. */
function contentDigest(path: string): Promise<string | undefined> {
  return readFile(path).then(
    (bytes) => createHash("sha256").update(bytes).digest("hex"),
    () => undefined,
  );
}

type Inspection = Extract<ToolCallInspection, { readonly ok: true }>;

const projects = join(homedir(), "Documents", "Projects");
const exports = join(projects, "Exports");
const renders = join(projects, "Renders");

/** A Python script, as Zhiyin's Python connection declares one given these folders. */
const script = (
  outside: readonly string[],
  changes: "elsewhere" | "workspace-for-good" = "elsewhere",
): Inspection => ({
  ok: true,
  action: "Run a Python script",
  target: "a script",
  command: "print(1)",
  builtInConnection: true,
  effects: {
    reads: "elsewhere",
    changes,
    sends: "none",
    actsAsPerson: "none",
    runs: "sealed",
    lasting: false,
    brings: "none",
  },
  changesAnyFile: { writable: [], unheldBy: "change_locked", outside },
});

const runPython = "mcp__python__run_python";

/** A grant held by the conversation. */
const grantFor = (folder: string, toolName: string) => ({
  id: "rule",
  at: "2026-10-31T00:00:00.000Z",
  kind: "outside-folder" as const,
  label: `Changes to files in ${folder}${sep}`,
  toolName,
  folder,
});

/** A write of one file outside the workspace by Zhiyin's own file tool. */
const writing = (path: string): Inspection => ({
  ok: true,
  action: "Create a file outside the workspace",
  target: path,
  command: "write_file(...)",
  effects: {
    reads: "elsewhere",
    changes: "elsewhere",
    sends: "none",
    actsAsPerson: "none",
    runs: "none",
    lasting: false,
    brings: "none",
  },
  changes: [{ path, change: "created" }],
  grantableByFile: true,
});

describe("a script given a folder outside the workspace", () => {
  it("is offered that folder for the conversation, named as the person picks it", async () => {
    const offer = await offeredFiles("mcp", runPython, script([exports]));

    expect(offer).toEqual({
      folder: {
        kind: "outside-folder",
        label: `Changes to files in ${exports}${sep}`,
        toolName: runPython,
        folder: exports,
      },
    });
  });

  it("given several folders, is offered the folder holding them all", async () => {
    expect(
      await offeredFiles("mcp", runPython, script([exports, renders])),
    ).toEqual({ folder: expect.objectContaining({ folder: projects }) });
  });

  it("is offered nothing when that folder would cover nearly everything", async () => {
    for (const folders of [
      [join(homedir(), "Exports"), join(parse(homedir()).root, "Data")],
      [join(homedir(), "Exports"), join(homedir(), "Renders")],
    ])
      expect(
        await offeredFiles("mcp", runPython, script(folders)),
      ).toBeUndefined();
  });

  it("is offered nothing, and covered by no grant, for a folder in Git's folder or a Startup folder", async () => {
    const startup = join(
      process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"),
      "Microsoft",
      "Windows",
      "Start Menu",
      "Programs",
      "Startup",
    );
    for (const folder of [
      join(projects, ".git", "hooks"),
      startup,
      join(startup, "tools"),
    ]) {
      expect(
        await offeredFiles("mcp", runPython, script([folder])),
      ).toBeUndefined();
      expect(
        await matchingFiles(
          [grantFor(projects, runPython), grantFor(dirname3(startup), "x")],
          "mcp",
          script([folder]),
          contentDigest,
        ),
      ).toBeUndefined();
    }
  });

  it("is offered nothing when a folder could not be copied, which asks each time", async () => {
    expect(
      await offeredFiles(
        "mcp",
        runPython,
        script([exports], "workspace-for-good"),
      ),
    ).toBeUndefined();
  });

  it("is covered when every folder it names is in a folder granted, and not when one is not", async () => {
    const granted = [grantFor(projects, runPython)];

    expect(
      await matchingFiles(
        granted,
        "mcp",
        script([exports, renders]),
        contentDigest,
      ),
    ).toMatchObject({ folder: projects });
    expect(
      await matchingFiles(
        granted,
        "mcp",
        script([exports, join(homedir(), "Downloads")]),
        contentDigest,
      ),
    ).toBeUndefined();
  });

  it("is covered by a grant made for a file tool's write there, and a grant made for it covers such a write", async () => {
    const fromWrite = grantFor(exports, "write_file");
    const fromScript = grantFor(exports, runPython);

    expect(
      await matchingFiles([fromWrite], "mcp", script([exports]), contentDigest),
    ).toEqual(fromWrite);
    expect(
      await matchingFiles(
        [fromScript],
        "built-in",
        writing(join(exports, "table.csv")),
        contentDigest,
      ),
    ).toEqual(fromScript);
  });

  it("is offered nothing, and covered by no grant, for another account's Startup folder", async () => {
    const theirs = join(
      parse(homedir()).root,
      "Users",
      "someone-else",
      "AppData",
      "Roaming",
      "Microsoft",
      "Windows",
      "Start Menu",
      "Programs",
      "Startup",
    );
    expect(
      await offeredFiles("mcp", runPython, script([theirs])),
    ).toBeUndefined();
    expect(
      await matchingFiles(
        [grantFor(parse(homedir()).root, runPython)],
        "mcp",
        script([theirs]),
        contentDigest,
      ),
    ).toBeUndefined();
  });

  it("is covered by a folder's grant by the folder's exact name, with or without a closing separator", async () => {
    const write = writing(join(exports, "table.csv"));
    for (const folder of [exports, `${exports}${sep}`])
      expect(
        await matchingFiles(
          [grantFor(folder, runPython)],
          "built-in",
          write,
          contentDigest,
        ),
      ).toMatchObject({ folder });
    // A sibling whose name starts the same, or differs only in case, is
    // another folder: both names come from the real folder, as stored.
    for (const folder of [
      join(projects, "Exp"),
      exports.toUpperCase(),
      exports.toLowerCase(),
    ])
      expect(
        await matchingFiles(
          [grantFor(folder, runPython)],
          "built-in",
          write,
          contentDigest,
        ),
      ).toBeUndefined();
  });

  it("from a connection Zhiyin does not ship, is offered and covered by nothing", async () => {
    const declared = { ...script([exports]) };
    delete (declared as { builtInConnection?: true }).builtInConnection;

    expect(await offeredFiles("mcp", runPython, declared)).toBeUndefined();
    expect(
      await matchingFiles(
        [grantFor(exports, runPython)],
        "mcp",
        declared,
        contentDigest,
      ),
    ).toBeUndefined();
  });
});

/** The folder three levels up: the Start Menu, which holds the Startup folder. */
function dirname3(path: string): string {
  return join(path, "..", "..", "..");
}
