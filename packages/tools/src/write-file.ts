/**
 * Writes one UTF-8 text file inside the workspace, creating it or replacing it.
 *
 * Replacing existing work is a different consequence from creating something
 * new, so the inspection says which one this call is before anyone approves it.
 * Because that answer comes from the filesystem, a file that appears while the
 * request is waiting changes the inspection, and the binding check upstream
 * refuses the stale approval rather than silently overwriting.
 */

import { lstat, mkdir, readFile, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { replaceFile } from "@zhiyin/file-replacement";
import {
  fileDigest,
  requireSeenFile,
  type ReadStateContext,
} from "./file-read-state.js";
import type {
  ToolCallInspection,
  ToolInvocationResult,
  ToolSpec,
} from "@zhiyin/contract";
import { detailsOf, facts } from "./action-detail.js";
import { describeChange } from "./file-change.js";
import {
  decodeText,
  encodeText,
  normalizeEndings,
  type DecodedText,
} from "./text-match.js";
import {
  describeBytes,
  describeCommand,
  errorCode,
  isAbortError,
  namesStream,
  normalizePath,
  toForwardSlashes,
} from "./workspace-path.js";
import { realStaysInside, staysInside } from "@zhiyin/workspace-containment";

const maximumBytes = 2 * 1024 * 1024;

/**
 * The largest existing file the file tools load to change, the size up to
 * which recovery keeps a copy of a file before it changes (ADR 0012). A larger
 * file is left to a command, which changes it without loading it here.
 */
export const largestChangedFile = 10 * 1024 * 1024;

/** Why a file past that size is not changed, and what to use instead. */
export function tooLargeToChange(shown: string): string {
  return `${shown} is larger than 10 MiB, the largest file the file tools change. Change it with a command or a script instead. No file was changed.`;
}

export const writeFileSpec: ToolSpec = {
  name: "write_file",
  description:
    "Create a UTF-8 text file inside the current workspace, or replace one that already exists. Missing folders are created. Use multi_edit instead when only part of an existing file should change.",
  inputSchema: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Workspace-relative path of the file to write.",
      },
      content: {
        type: "string",
        description: "The complete contents of the file.",
      },
    },
    required: ["path", "content"],
    additionalProperties: false,
  },
};

type WriteArguments = { readonly path: string; readonly content: string };

function writeArguments(args: unknown): WriteArguments | undefined {
  if (!args || typeof args !== "object" || Array.isArray(args)) return;
  const source = args as Record<string, unknown>;
  const keys = Object.keys(source);
  if (keys.length !== 2 || !keys.includes("path") || !keys.includes("content"))
    return;
  if (typeof source["path"] !== "string" || !source["path"].trim()) return;
  if (typeof source["content"] !== "string") return;
  return { path: normalizePath(source["path"]), content: source["content"] };
}

type Target =
  | { readonly kind: "file"; readonly bytes: number }
  | { readonly kind: "directory" }
  | { readonly kind: "absent"; readonly createsFolder?: string }
  | { readonly kind: "blocked"; readonly reason: string };

async function entryKind(
  path: string,
): Promise<"file" | "directory" | "other" | "absent" | "unreadable"> {
  try {
    const entry = await stat(path);
    return entry.isFile()
      ? "file"
      : entry.isDirectory()
        ? "directory"
        : "other";
  } catch (error) {
    return errorCode(error) === "ENOENT" ? "absent" : "unreadable";
  }
}

async function describeTarget(
  realRoot: string,
  location: Location,
): Promise<Target> {
  const { absolute, relative: shown } = location;
  const kind = await entryKind(absolute);
  if (kind === "directory") return { kind: "directory" };
  if (kind === "file") {
    const entry = await stat(absolute);
    return { kind: "file", bytes: entry.size };
  }
  if (kind === "other")
    return {
      kind: "blocked",
      reason: `${shown} is not an ordinary file and cannot be written.`,
    };
  if (kind === "unreadable")
    return {
      kind: "blocked",
      reason: `${shown} could not be checked before writing. Check that its folder is readable.`,
    };

  const folder = dirname(shown);
  if (folder === "." || folder === "") return { kind: "absent" };
  const folderKind = await entryKind(resolve(realRoot, folder));
  if (folderKind === "directory") return { kind: "absent" };
  if (folderKind === "absent") return { kind: "absent", createsFolder: folder };
  if (folderKind === "unreadable")
    return {
      kind: "blocked",
      reason: `${folder} could not be checked before writing. Check that it is readable.`,
    };
  return {
    kind: "blocked",
    reason: `${folder} is a file in this workspace, not a folder.`,
  };
}

type PlannedWrite = {
  readonly inspection: Extract<ToolCallInspection, { readonly ok: true }>;
  readonly input: WriteArguments;
  readonly location: Location;
  readonly change: "created" | "updated";
  /** Exactly what goes on disk, conventions included. */
  readonly contents: string;
};

/**
 * One look at the workspace answers both questions: what to tell the person
 * before they approve, and what the result should say the action did. Deriving
 * the second from the wording of the first would make a copy edit change the
 * record.
 */
async function planWrite(
  root: string,
  args: unknown,
  context: ReadStateContext = {},
): Promise<PlannedWrite | Extract<ToolCallInspection, { readonly ok: false }>> {
  const input = writeArguments(args);
  if (!input) {
    return {
      ok: false,
      reason: "Choose a workspace-relative file path and the text to write.",
      correctable: true,
    };
  }
  if (isAbsolute(input.path) || !staysInside(root, resolve(root, input.path))) {
    return {
      ok: false,
      reason: "The file must stay inside the current workspace.",
    };
  }
  if (Buffer.byteLength(input.content, "utf8") > maximumBytes) {
    return {
      ok: false,
      reason: "The text is too large to write in one action.",
    };
  }
  // Links are followed here as they are when writing, so a write a link would
  // carry out of the folder is refused before it is offered for approval.
  const realRoot = await realpath(root).catch(() => undefined);
  if (!realRoot)
    return { ok: false, reason: "The workspace folder could not be read." };
  const location = await writableLocation(realRoot, input.path);
  if (!location) {
    return {
      ok: false,
      reason: "The file must stay inside the current workspace.",
    };
  }
  const shown = location.relative;

  const target = await describeTarget(realRoot, location);
  if (target.kind === "blocked") return { ok: false, reason: target.reason };
  if (target.kind === "directory") {
    return {
      ok: false,
      reason: `${shown || "."} is a folder in this workspace, not a file.`,
    };
  }

  const command = describeCommand(writeFileSpec.name, input);
  if (target.kind === "file") {
    // Checked before anything of the file is loaded.
    if (target.bytes > largestChangedFile)
      return { ok: false, correctable: true, reason: tooLargeToChange(shown) };
    const unseen = await requireSeenFile(location.absolute, shown, context);
    if (unseen) return unseen;
    // Replacing a file should change its contents, not silently rewrite every
    // line ending in it, which on Windows would show up as a whole-file diff.
    let conventions: DecodedText;
    try {
      conventions = decodeText(await readFile(location.absolute, "utf8"));
    } catch {
      conventions = decodeText("");
    }
    return {
      input,
      location,
      change: "updated",
      contents: encodeText(conventions, normalizeEndings(input.content)),
      inspection: {
        ok: true,
        action: "Overwrite an existing workspace file",
        target: shown,
        access: "change",
        scope: "workspace",
        // The text on disk, not the text the model believes is on disk: the
        // difference between those two is the reason to look at a diff.
        changes: [
          describeChange(
            shown,
            "updated",
            normalizeEndings(input.content),
            conventions.text,
          ),
        ],
        detail: `This replaces the current contents of ${shown} (${describeBytes(
          target.bytes,
        )}).`,
        command,
      },
    };
  }
  return {
    input,
    location,
    change: "created",
    // A new file is written exactly as the model wrote it: there is no existing
    // convention to respect, and inventing one would be a guess.
    contents: input.content,
    inspection: {
      ok: true,
      action: "Create a workspace file",
      target: shown,
      access: "change",
      scope: "workspace",
      changes: [
        {
          ...describeChange(shown, "created", input.content),
          ...(target.createsFolder
            ? { createdFolder: target.createsFolder }
            : {}),
        },
      ],
      detail: target.createsFolder
        ? `This creates a new file and the folder “${target.createsFolder}”. Nothing is replaced.`
        : "This creates a new file. Nothing is replaced.",
      command,
    },
  };
}

export async function inspectWriteTextFile(
  root: string,
  args: unknown,
  context: ReadStateContext = {},
): Promise<ToolCallInspection> {
  const planned = await planWrite(root, args, context);
  return "inspection" in planned ? planned.inspection : planned;
}

/** Where a write goes: the real path, and that path from the real root. */
type Location = { readonly absolute: string; readonly relative: string };

/**
 * The parts of a workspace-relative path once `.` and `..` are taken away
 * by name, as Windows does before it follows any link: `notes/lnk/../b.md` is
 * `notes/b.md`. Nothing when `..` climbs above the folder, or a part holds a
 * colon, which names a drive or a hidden stream of a file rather than a file.
 */
function namedParts(path: string): string[] | undefined {
  if (namesStream(path)) return undefined;
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue;
    if (part !== "..") parts.push(part);
    else if (parts.pop() === undefined) return undefined;
  }
  return parts;
}

/**
 * Where a write of a path that may not exist yet really goes, resolved once
 * and used for everything the call says and does. Each existing part is
 * followed through links, and one that leads out of the folder refuses the
 * path; so does a link whose target is missing, since what appears there could
 * be anywhere. The parts that do not exist yet are made where the last one
 * that does really is.
 */
async function writableLocation(
  realRoot: string,
  path: string,
): Promise<Location | undefined> {
  const parts = namedParts(path);
  if (!parts) return undefined;
  let reached = realRoot;
  let index = 0;
  for (; index < parts.length; index += 1) {
    const candidate = join(reached, parts[index] as string);
    let real: string;
    try {
      real = await realpath(candidate);
    } catch {
      const entry = await lstat(candidate).catch(() => undefined);
      if (entry?.isSymbolicLink()) return undefined;
      break;
    }
    if (!realStaysInside(realRoot, real)) return undefined;
    reached = real;
  }
  const absolute = join(reached, ...parts.slice(index));
  return {
    absolute,
    relative: toForwardSlashes(relative(realRoot, absolute)),
  };
}

/**
 * Replaces the file only once the new contents are completely on disk. A write
 * that fails takes its temporary copy away with it.
 */
export async function writeFileAtomically(
  target: string,
  text: string,
  signal?: AbortSignal,
): Promise<void> {
  await replaceFile(target, text, { signal });
}

export async function runWriteTextFile(
  root: string,
  args: unknown,
  signal?: AbortSignal,
  context: ReadStateContext = {},
): Promise<ToolInvocationResult> {
  const planned = await planWrite(root, args, context);
  if (!("inspection" in planned)) return planned;
  const { location, change, contents } = planned;
  const target = location.absolute;
  const shown = location.relative;

  try {
    signal?.throwIfAborted();
    await mkdir(dirname(target), { recursive: true });
    if (change === "updated") {
      const unseen = await requireSeenFile(target, shown, context);
      if (unseen) return unseen;
    }
    await writeFileAtomically(target, contents, signal);
    const bytes = Buffer.byteLength(contents, "utf8");
    if (context.items && context.conversationId) {
      try {
        const file = await stat(target);
        await context.items.noteRead(context.conversationId, target, {
          modifiedMs: file.mtimeMs,
          size: file.size,
          readAt: new Date().toISOString(),
          digest: await fileDigest(target),
          whole: true,
        });
      } catch {
        // The write succeeded. Left unrecorded, the next edit asks for a fresh
        // read.
      }
    }
    return {
      ok: true,
      value: { path: shown, bytes, change },
      produced: [{ path: shown, change, bytes }],
      ...detailsOf(
        facts(
          ["File", shown],
          [
            "Change",
            change === "created" ? "Created" : "Replaced what was there",
          ],
          ["Size", describeBytes(bytes)],
        ),
      ),
    };
  } catch (error) {
    if (isAbortError(error))
      return {
        ok: false,
        reason: "The file was not written; the task stopped.",
      };
    return {
      ok: false,
      reason: `${shown} could not be written. Check that the folder allows changes.`,
    };
  }
}
