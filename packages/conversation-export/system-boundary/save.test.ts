/**
 * Saving a conversation over a file the person chose, while another program
 * holds that file open with its bytes locked: writing into it fails once it
 * has been opened, and it will not let itself be replaced.
 */

import { spawn } from "node:child_process";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { emptyConversationLists } from "@zhiyin/contract";
import { TemporaryFolders } from "@zhiyin/temporary-folders";
import { conversationExport } from "../src/index.js";

const folders = new TemporaryFolders();
afterEach(() => folders.removeAll());

/** Holds a file open from another process, its first bytes locked. */
async function holdFile(path: string): Promise<() => Promise<void>> {
  const script = [
    `$file = [System.IO.File]::Open('${path.replaceAll("'", "''")}', 'Open', 'Read', 'ReadWrite')`,
    `$file.Lock(0, 1024)`,
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

describe(
  "a conversation saved over a file the person chose",
  { timeout: 60_000 },
  () => {
    it("leaves the earlier file whole, and nothing beside it, when the save fails", async () => {
      const folder = await folders.make("zhiyin-export-");
      const destination = join(folder, "weather.html");
      await writeFile(destination, "last week's export");
      const release = await holdFile(destination);

      let result;
      try {
        result = await conversationExport(() => ({
          appVersion: "0.1.0",
          exportedAt: new Date("2026-10-20T12:00:00.000Z"),
        })).save(
          {
            ...emptyConversationLists,
            id: "task-1",
            title: "Check the weather service",
            titleSource: "generated",
            updatedAt: "2026-10-20T11:00:00.000Z",
            updatedLabel: "Today",
            messages: [],
            phase: {
              kind: "completed",
              outcome: { title: "Done", summary: "Done." },
            },
          },
          "html",
          async () => destination,
        );
      } finally {
        await release();
      }

      expect(result.status).toBe("failed");
      await expect(readFile(destination, "utf8")).resolves.toBe(
        "last week's export",
      );
      expect(await readdir(folder)).toEqual(["weather.html"]);
    });
  },
);
