/**
 * Writes one UTF-8 text file inside the workspace, creating it or replacing it.
 *
 * Replacing existing work is a different consequence from creating something
 * new, so the inspection says which one this call is before anyone approves it.
 * Because that answer comes from the filesystem, a file that appears while the
 * request is waiting changes the inspection, and the binding check upstream
 * refuses the stale approval rather than silently overwriting.
 */

import {
  mkdir,
  readFile,
  realpath,
  rename,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { randomUUID } from "node:crypto";
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
  normalizePath,
} from "./workspace-path.js";
import { staysInside } from "@zhiyin/workspace-containment";

const maximumBytes = 2 * 1024 * 1024;

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
      text: {
        type: "string",
        description: "The complete contents of the file.",
      },
    },
    required: ["path", "text"],
    additionalProperties: false,
  },
};

type WriteArguments = { readonly path: string; readonly text: string };

function writeArguments(args: unknown): WriteArguments | undefined {
  if (!args || typeof args !== "object" || Array.isArray(args)) return;
  const source = args as Record<string, unknown>;
  const keys = Object.keys(source);
  if (keys.length !== 2 || !keys.includes("path") || !keys.includes("text"))
    return;
  if (typeof source["path"] !== "string" || !source["path"].trim()) return;
  if (typeof source["text"] !== "string") return;
  return { path: normalizePath(source["path"]), text: source["text"] };
}

type Target =
  | {
      readonly kind: "file";
      readonly bytes: number;
      /** How the file already stores its lines, so an overwrite keeps them. */
      readonly conventions: DecodedText;
    }
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
  root: string,
  input: WriteArguments,
): Promise<Target> {
  const kind = await entryKind(resolve(root, input.path));
  if (kind === "directory") return { kind: "directory" };
  if (kind === "file") {
    const absolute = resolve(root, input.path);
    const entry = await stat(absolute);
    // Replacing a file should change its contents, not silently rewrite every
    // line ending in it, which on Windows would show up as a whole-file diff.
    let conventions: DecodedText;
    try {
      conventions = decodeText(await readFile(absolute, "utf8"));
    } catch {
      conventions = decodeText("");
    }
    return { kind: "file", bytes: entry.size, conventions };
  }
  if (kind === "other")
    return {
      kind: "blocked",
      reason: `${input.path} is not an ordinary file and cannot be written.`,
    };
  if (kind === "unreadable")
    return {
      kind: "blocked",
      reason: `${input.path} could not be checked before writing. Check that its folder is readable.`,
    };

  const folder = dirname(input.path);
  if (folder === "." || folder === "") return { kind: "absent" };
  const folderKind = await entryKind(resolve(root, folder));
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
  if (Buffer.byteLength(input.text, "utf8") > maximumBytes) {
    return {
      ok: false,
      reason: "The text is too large to write in one action.",
    };
  }

  const target = await describeTarget(root, input);
  if (target.kind === "blocked") return { ok: false, reason: target.reason };
  if (target.kind === "directory") {
    return {
      ok: false,
      reason: `${input.path} is a folder in this workspace, not a file.`,
    };
  }

  const command = describeCommand(writeFileSpec.name, input);
  if (target.kind === "file") {
    const canonical = await realpath(resolve(root, input.path)).catch(
      () => undefined,
    );
    if (!canonical)
      return {
        ok: false,
        reason: `${input.path} could not be checked before writing.`,
      };
    const unseen = await requireSeenFile(canonical, input.path, context);
    if (unseen) return unseen;
    return {
      input,
      change: "updated",
      contents: encodeText(target.conventions, normalizeEndings(input.text)),
      inspection: {
        ok: true,
        action: "Overwrite an existing workspace file",
        target: input.path,
        access: "change",
        scope: "workspace",
        // The text on disk, not the text the model believes is on disk: the
        // difference between those two is the reason to look at a diff.
        changes: [
          describeChange(
            input.path,
            "updated",
            normalizeEndings(input.text),
            target.conventions.text,
          ),
        ],
        detail: `This replaces the current contents of ${input.path} (${describeBytes(
          target.bytes,
        )}).`,
        command,
      },
    };
  }
  return {
    input,
    change: "created",
    // A new file is written exactly as the model wrote it: there is no existing
    // convention to respect, and inventing one would be a guess.
    contents: input.text,
    inspection: {
      ok: true,
      action: "Create a workspace file",
      target: input.path,
      access: "change",
      scope: "workspace",
      changes: [
        {
          ...describeChange(input.path, "created", input.text),
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

/**
 * Resolves a path that may not exist yet, one segment at a time, so a symlinked
 * folder anywhere along the way is caught rather than followed out of the
 * workspace.
 */
async function resolveWritablePath(
  realRoot: string,
  relativePath: string,
): Promise<string | undefined> {
  const segments = relativePath.split("/").filter((segment) => segment.length);
  let resolved = realRoot;
  let index = 0;
  for (; index < segments.length; index += 1) {
    const candidate = resolve(resolved, segments[index] as string);
    let real: string;
    try {
      real = await realpath(candidate);
    } catch {
      break;
    }
    if (!staysInside(realRoot, real)) return undefined;
    resolved = real;
  }
  const target = segments
    .slice(index)
    .reduce((path, segment) => resolve(path, segment), resolved);
  return staysInside(realRoot, target) ? target : undefined;
}

/** Replaces the file only once the new contents are completely on disk. */
export async function writeFileAtomically(
  target: string,
  text: string,
  signal?: AbortSignal,
): Promise<void> {
  const temporary = resolve(dirname(target), `.zhiyin-${randomUUID()}.tmp`);
  await writeFile(temporary, text, {
    encoding: "utf8",
    ...(signal ? { signal } : {}),
  });
  await rename(temporary, target);
}

export async function runWriteTextFile(
  root: string,
  args: unknown,
  signal?: AbortSignal,
  context: ReadStateContext = {},
): Promise<ToolInvocationResult> {
  const planned = await planWrite(root, args, context);
  if (!("inspection" in planned)) return planned;
  const { input, change, contents } = planned;

  try {
    const realRoot = await realpath(root);
    const target = await resolveWritablePath(realRoot, input.path);
    if (!target) {
      return {
        ok: false,
        reason: "The file must stay inside the current workspace.",
      };
    }
    signal?.throwIfAborted();
    await mkdir(dirname(target), { recursive: true });
    if (change === "updated") {
      const unseen = await requireSeenFile(target, input.path, context);
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
      value: { path: input.path, bytes, change },
      produced: [{ path: input.path, change, bytes }],
      ...detailsOf(
        facts(
          ["File", input.path],
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
      reason: `${input.path} could not be written. Check that the folder allows changes.`,
    };
  }
}
