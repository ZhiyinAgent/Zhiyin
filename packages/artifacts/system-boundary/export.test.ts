/**
 * Saving over a file the person chose, when the save fails part way: another
 * program locks the second half of the file being saved, so the save has
 * written its first half when it fails, as on a full disk; or another program
 * holds the destination open, its bytes locked, so writing into it fails once
 * it has been opened and it will not let itself be replaced.
 */

import { spawn } from "node:child_process";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TemporaryFolders } from "@zhiyin/temporary-folders";
import { WorkspaceArtifacts } from "../src/index.js";

const folders = new TemporaryFolders();
afterEach(() => folders.removeAll());

/**
 * Holds a file open from another process until released, sharing it as
 * `share` says, and locking the bytes `lock` names.
 */
async function holdFile(
  path: string,
  share: "Read" | "ReadWrite",
  lock?: { readonly offset: number; readonly length: number },
): Promise<() => Promise<void>> {
  const script = [
    `$file = [System.IO.File]::Open('${path.replaceAll("'", "''")}', 'Open', 'Read', '${share}')`,
    ...(lock ? [`$file.Lock(${lock.offset}, ${lock.length})`] : []),
    `[Console]::Out.WriteLine('held')`,
    `[void][Console]::In.ReadLine()`,
    `$file.Close()`,
  ].join("; ");
  const holder = spawn(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", script],
    { stdio: ["pipe", "pipe", "inherit"] },
  );
  await new Promise<void>((resolve, reject) => {
    holder.stdout.on("data", (chunk: Buffer) => {
      if (chunk.toString().includes("held")) resolve();
    });
    holder.on("exit", (code) =>
      reject(new Error(`The program holding the file ended (${code}).`)),
    );
  });
  return () =>
    new Promise<void>((resolve) => {
      holder.on("exit", () => resolve());
      holder.stdin.end("\n");
    });
}

async function destinationHolding(text: string): Promise<string> {
  const outside = await folders.make("zhiyin-export-");
  const destination = join(outside, "saved");
  await writeFile(destination, text);
  return destination;
}

describe("a save over a file the person chose", { timeout: 60_000 }, () => {
  it("leaves the earlier file whole, and nothing beside it, when copying fails part way", async () => {
    const root = await folders.make("zhiyin-export-workspace-");
    const size = 4 * 1024 * 1024;
    await writeFile(join(root, "data.bin"), Buffer.alloc(size, 7));
    const destination = await destinationHolding("last week's export");
    const release = await holdFile(join(root, "data.bin"), "ReadWrite", {
      offset: size / 2,
      length: size / 2,
    });

    let result;
    try {
      result = await new WorkspaceArtifacts().exportTo(
        {
          path: "data.bin",
          name: "data.bin",
          change: "created",
          bytes: size,
          updatedAt: "2026-10-20T10:00:00.000Z",
        },
        root,
        async () => destination,
      );
    } finally {
      await release();
    }

    expect(result.status).toBe("failed");
    await expect(readFile(destination, "utf8")).resolves.toBe(
      "last week's export",
    );
    expect(await readdir(join(destination, ".."))).toEqual(["saved"]);
  });

  it("leaves the earlier file whole, and nothing beside it, when a view cannot take its place", async () => {
    const destination = await destinationHolding("last week's chart");
    const release = await holdFile(destination, "ReadWrite", {
      offset: 0,
      length: 1024,
    });

    let result;
    try {
      result = await new WorkspaceArtifacts().exportView(
        "Chart",
        '<svg xmlns="http://www.w3.org/2000/svg"><rect width="4" height="4"/></svg>',
        async () => destination,
      );
    } finally {
      await release();
    }

    expect(result.status).toBe("failed");
    await expect(readFile(destination, "utf8")).resolves.toBe(
      "last week's chart",
    );
    expect(await readdir(join(destination, ".."))).toEqual(["saved"]);
  });
});
