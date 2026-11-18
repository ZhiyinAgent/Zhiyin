/**
 * Writes one UTF-8 text file inside the workspace, creating it or replacing it.
 *
 * Replacing existing work is a different consequence from creating something
 * new, so the inspection says which one this call is before anyone approves it.
 * Because that answer comes from the filesystem, a file that appears while the
 * request is waiting changes the inspection, and the binding check upstream
 * refuses the stale approval rather than silently overwriting.
 */

import { mkdir, readFile, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { replaceFile } from "@zhiyin/files";
import {
  fileDigest,
  requireSeenFile,
  type ReadStateContext,
} from "../file-read-state.js";
import type {
  ToolCallInspection,
  ToolInvocationResult,
  ToolSpec,
} from "@zhiyin/contract";
import { detailsOf, facts } from "../../shared/action-detail.js";
import { describeChange } from "./file-change.js";
import { changingFiles } from "../../shared/effects.js";
import { schemaInput, withSchemaProblems } from "@zhiyin/tool-input";
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
  normalizePath,
} from "../../shared/workspace-path.js";
import {
  placeForWriting,
  placeOutside,
  placementRefusal,
  type Unplaced,
  staysInside,
} from "@zhiyin/workspace-containment";
import type { ToolDefinition } from "../../tool-definition.js";
import type { ConversationItems } from "../../shared/conversation-items.js";

const maximumMebibytes = 2;
const maximumBytes = maximumMebibytes * 1024 * 1024;

/**
 * The largest existing file the file tools load to change, the size up to
 * which recovery keeps a copy of a file before it changes (ADR 0013). A larger
 * file is left to a command, which changes it without loading it here.
 */
export const largestChangedFile = 10 * 1024 * 1024;
/** That size as the tools' descriptions and refusals state it. */
export const largestChangedShown = `${largestChangedFile / 1024 / 1024} MiB`;

/** Why a file past that size is not changed, and what to use instead. */
export function tooLargeToChange(shown: string): string {
  return `${shown} is larger than ${largestChangedShown}, the largest file the file tools change. Change it with a command or a script instead. No file was changed.`;
}

const writeFileSpec: ToolSpec = {
  name: "write_file",
  role: "writes-file",
  description: `Create a UTF-8 text file, in the current workspace by a workspace-relative path or elsewhere by an absolute path, or replace one that already exists. A file that already exists must have been read completely in this conversation before it is replaced. Missing folders are created. Use multi_edit instead when only part of an existing file should change. The text can be at most ${maximumMebibytes} MiB, and a file larger than ${largestChangedShown} is not replaced: change it with a command or a script.`,
  inputSchema: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description:
          "Workspace-relative path of the file to write, or an absolute path for a file outside the workspace, which the person is asked about by that path.",
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
  const input = schemaInput<WriteArguments>(writeFileSpec.inputSchema, args);
  if (!input?.path.trim()) return;
  return { path: normalizePath(input.path), content: input.content };
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
      reason: withSchemaProblems(
        "Choose a workspace-relative file path and the text to write.",
        args,
        writeFileSpec.inputSchema,
      ),
      correctable: true,
    };
  }
  if (
    !isAbsolute(input.path) &&
    !staysInside(root, resolve(root, input.path))
  ) {
    return {
      ok: false,
      reason:
        "Name a file inside the workspace by a workspace-relative path, or one outside it by its absolute path.",
    };
  }
  if (Buffer.byteLength(input.content, "utf8") > maximumBytes) {
    return {
      ok: false,
      correctable: true,
      reason: `The text is larger than ${maximumMebibytes} MiB, the most write_file writes in one action. Write a first part, then add the rest with multi_edit, or have a script write the file. No file was changed.`,
    };
  }
  // Links are followed here as they are when writing, so a write a link would
  // carry out of the folder is refused before it is offered for approval.
  const realRoot = await realpath(root).catch(() => undefined);
  if (!realRoot)
    return { ok: false, reason: "The workspace folder could not be read." };
  const placed = await placeWrite(realRoot, input.path, context.protect ?? []);
  if (!placed.ok) return placed;
  const { location, outside } = placed;
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
    const unseen = await requireSeenFile(location.absolute, shown, context, {
      whole: true,
    });
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
        action: outside
          ? "Overwrite a file outside the workspace"
          : "Overwrite an existing workspace file",
        target: shown,
        // A grant for the file or its folder covers the change (ADR 0012).
        ...(outside ? { grantableByFile: true as const } : {}),
        effects: changingFiles([{ absolute: location.absolute, outside }]),
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
        detail: `${outside ? `${outsideNote} ` : ""}This replaces the current contents of ${shown} (${describeBytes(
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
      action: outside
        ? "Create a file outside the workspace"
        : "Create a workspace file",
      target: shown,
      // A grant for the file or its folder covers the change (ADR 0012).
      ...(outside ? { grantableByFile: true as const } : {}),
      effects: changingFiles([{ absolute: location.absolute, outside }]),
      changes: [
        {
          ...describeChange(shown, "created", input.content),
          ...(target.createsFolder
            ? { createdFolder: target.createsFolder }
            : {}),
        },
      ],
      detail: `${outside ? `${outsideNote} ` : ""}${
        target.createsFolder
          ? `This creates a new file and the folder “${target.createsFolder}”. Nothing is replaced.`
          : "This creates a new file. Nothing is replaced."
      }`,
      command,
    },
  };
}

async function inspectWriteTextFile(
  root: string,
  args: unknown,
  context: ReadStateContext = {},
): Promise<ToolCallInspection> {
  const planned = await planWrite(root, args, context);
  return "inspection" in planned ? planned.inspection : planned;
}

/** Where a write goes: the real path, and that path as it is shown. */
type Location = { readonly absolute: string; readonly relative: string };

/** Said on every write outside the workspace, so the person reads it before the path. */
const outsideNote = "This file is outside the folder you selected.";

/** A refusal of a call that does not place its file, said to the model when it can correct it. */
type Refused = {
  readonly ok: false;
  readonly reason: string;
  readonly correctable?: true;
};

/** Why a file is not written where `path` places it. */
export function placementRefused(path: string, kind: Unplaced): Refused {
  const { reason, correctable } = placementRefusal(path, kind);
  return { ok: false, reason, ...(correctable ? { correctable } : {}) };
}

/**
 * Where a write really goes: inside the workspace from a relative path, or,
 * from an absolute one, outside it, named by its whole real path. Both are
 * placed by containment's one rule, links resolved and never followed
 * through one whose target is missing; Zhiyin's own folders are refused.
 */
async function placeWrite(
  realRoot: string,
  path: string,
  protect: readonly string[],
): Promise<
  | {
      readonly ok: true;
      readonly location: Location;
      readonly outside: boolean;
    }
  | Refused
> {
  if (!isAbsolute(path)) {
    const inside = await placeForWriting(realRoot, path);
    return inside.kind === "writable"
      ? {
          ok: true,
          location: { absolute: inside.absolute, relative: inside.relative },
          outside: false,
        }
      : placementRefused(path, inside.kind);
  }
  const place = await placeOutside(realRoot, path, { protect });
  if (place.kind !== "writable") return placementRefused(path, place.kind);
  return place.inside
    ? {
        ok: true,
        location: { absolute: place.absolute, relative: place.relative },
        outside: false,
      }
    : {
        ok: true,
        location: { absolute: place.absolute, relative: place.absolute },
        outside: true,
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

async function runWriteTextFile(
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
      const unseen = await requireSeenFile(target, shown, context, {
        whole: true,
      });
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

/** Writing a whole file, as the registry offers it. */
export function writeFileTool(
  items: ConversationItems | undefined,
  protect: readonly string[],
): ToolDefinition {
  return {
    spec: writeFileSpec,
    requiresWorkspace: true,
    inspect: (args, conversationId, { root }) =>
      inspectWriteTextFile(root, args, { items, conversationId, protect }),
    execute: (args, signal, conversationId, { root }) =>
      runWriteTextFile(root, args, signal, { items, conversationId, protect }),
  };
}
