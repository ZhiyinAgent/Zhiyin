import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import {
  standingInstructionBytes,
  type FolderInstructions,
} from "@zhiyin/contract";

/** The name other assistants read too; Zhiyin does not invent its own. */
const fileName = "AGENTS.md";

/**
 * The folder's AGENTS.md, when it has one at its root: its text up to the
 * limit, cut between characters, and a hash of the whole file for the
 * person's approval to be kept against. ADR 0012.
 */
export async function readFolderInstructions(
  root: string,
): Promise<FolderInstructions | undefined> {
  const path = join(root, fileName);
  // Only what can be shown is held; the hash still covers the whole file.
  const hash = createHash("sha256");
  const head: Buffer[] = [];
  let bytes = 0;
  try {
    if (!(await stat(path)).isFile()) return undefined;
    for await (const chunk of createReadStream(path) as AsyncIterable<Buffer>) {
      hash.update(chunk);
      const room = Math.max(0, standingInstructionBytes - bytes);
      if (room > 0) head.push(chunk.subarray(0, room));
      bytes += chunk.length;
    }
  } catch {
    return undefined;
  }
  const content = Buffer.concat(head);
  const truncated = bytes > standingInstructionBytes;
  const text = content
    .subarray(0, standingInstructionBytes)
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
