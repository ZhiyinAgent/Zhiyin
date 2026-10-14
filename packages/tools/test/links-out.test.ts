/**
 * A folder link inside the workspace that leads out of it. Windows makes a
 * junction without any privilege, so this runs on every machine; a file link
 * needs one, and leads out the same way. No tool reads, lists, finds,
 * searches, writes, edits or deletes through it, and what lies outside never
 * reaches an answer.
 */

import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { WorkspaceTools } from "../src/index.js";

// Distinctive on purpose: refusals say "outside" themselves.
const secret = "secret-contents-that-must-not-leak";

let outside: string;
let tools: WorkspaceTools;

beforeEach(async () => {
  const parent = await mkdtemp(join(tmpdir(), "zhiyin-links-"));
  const root = join(parent, "workspace");
  outside = join(parent, "outside");
  await mkdir(root);
  await mkdir(outside);
  await writeFile(join(outside, "secret.txt"), secret, "utf8");
  await writeFile(join(root, "note.txt"), "inside", "utf8");
  await symlink(outside, join(root, "linked"), "junction");
  tools = new WorkspaceTools(root);
});

describe("a folder link that leads out of the workspace", () => {
  it("is not read through", async () => {
    const result = await tools.execute("read_file", {
      path: "linked/secret.txt",
    });

    expect(result).toEqual({
      ok: false,
      reason: "The file leads outside the current workspace.",
    });
  });

  it("is not read through among several files", async () => {
    const result = await tools.execute("read_files", {
      paths: ["note.txt", "linked/secret.txt"],
    });

    expect(result).toMatchObject({
      ok: true,
      value: {
        files: [
          { path: "note.txt", text: "1→inside" },
          {
            path: "linked/secret.txt",
            error: "The file leads outside the current workspace.",
          },
        ],
      },
    });
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  it("is not listed into", async () => {
    expect(await tools.execute("list_directory", { path: "linked" })).toEqual({
      ok: false,
      reason: "The directory leads outside the current workspace.",
    });
  });

  it("is not searched into when named, and is passed over when searching the whole folder", async () => {
    const named = await tools.execute("search_files", {
      query: secret,
      path: "linked",
    });
    const whole = await tools.execute("search_files", { query: secret });

    expect(named).toEqual({
      ok: false,
      reason: "The search must stay inside the current workspace.",
    });
    expect(whole).toMatchObject({ ok: true, value: { total: 0 } });
  });

  it("is not found into when named, and is passed over when finding in the whole folder", async () => {
    const named = await tools.execute("find_files", {
      pattern: "secret*",
      path: "linked",
    });
    const whole = await tools.execute("find_files", { pattern: "secret*" });

    expect(named).toEqual({
      ok: false,
      reason: "The search must stay inside the current workspace.",
    });
    expect(whole).toMatchObject({ ok: true, value: { total: 0 } });
  });

  it("is not written through", async () => {
    const result = await tools.execute("write_file", {
      path: "linked/planted.txt",
      content: "planted",
    });

    expect(result).toEqual({
      ok: false,
      reason: "The file must stay inside the current workspace.",
    });
    expect(await readdir(outside)).toEqual(["secret.txt"]);
  });

  it("is not edited through", async () => {
    const result = await tools.execute("multi_edit", {
      edits: [
        {
          path: "linked/secret.txt",
          replacements: [{ find: "secret", replace: "changed" }],
        },
      ],
    });

    expect(result).toEqual({
      ok: false,
      reason: "Every edited file must stay inside the current workspace.",
    });
    expect(await readFile(join(outside, "secret.txt"), "utf8")).toBe(secret);
  });

  it("is not deleted through", async () => {
    const result = await tools.execute("delete_file", {
      paths: ["linked/secret.txt"],
      mode: "permanent",
    });

    expect(result).toEqual({
      ok: false,
      reason: "Only files and folders inside the workspace can be deleted.",
    });
    expect(await readdir(outside)).toEqual(["secret.txt"]);
  });
});
