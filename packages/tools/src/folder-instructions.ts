import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
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
  let content: Buffer;
  try {
    if (!(await stat(path)).isFile()) return undefined;
    content = await readFile(path);
  } catch {
    return undefined;
  }
  const truncated = content.length > standingInstructionBytes;
  const text = content
    .subarray(0, standingInstructionBytes)
    .toString("utf8")
    .replace(/�$/, "");
  return {
    path: fileName,
    text,
    bytes: content.length,
    truncated,
    hash: createHash("sha256").update(content).digest("hex"),
  };
}
