import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import {
  longestInstructionBytes,
  type FolderInstructions,
} from "@zhiyin/contract";
import { realLocation } from "./workspace-path.js";

/** The name other assistants read too; Zhiyin does not invent its own. */
const fileName = "AGENTS.md";

/**
 * The folder's AGENTS.md, when it has one at its root: its text up to the
 * most any budget sends, cut between characters, and a hash of the whole file
 * for the person's approval to be kept against.
 */
export async function readFolderInstructions(
  root: string,
): Promise<FolderInstructions | undefined> {
  // Only what can be shown is held; the hash still covers the whole file.
  const hash = createHash("sha256");
  const head: Buffer[] = [];
  let bytes = 0;
  try {
    // One that is a link leading out of the folder is not the folder's own.
    const { path, scope } = await realLocation(root, fileName);
    if (scope !== "workspace" || !(await stat(path)).isFile()) return undefined;
    for await (const chunk of createReadStream(path) as AsyncIterable<Buffer>) {
      hash.update(chunk);
      const room = Math.max(0, longestInstructionBytes - bytes);
      if (room > 0) head.push(chunk.subarray(0, room));
      bytes += chunk.length;
    }
  } catch {
    return undefined;
  }
  const content = Buffer.concat(head);
  const truncated = bytes > longestInstructionBytes;
  const text = content
    .subarray(0, longestInstructionBytes)
    .toString("utf8")
    .replace(/�$/, "");
  return {
    path: fileName,
    text,
    bytes,
    truncated,
    hash: hash.digest("hex"),
  };
}
