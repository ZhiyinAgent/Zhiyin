/**
 * Moves and renames files and folders, inside the workspace and across its
 * edge, as the model asks.
 *
 * A move is declared at both ends before anyone approves it: each file it
 * takes away, with where it goes, and each file it puts there. Recovery keeps
 * a copy of the first and notes that the second did not exist, so going back
 * puts the file back and takes the new one away. Nothing already at a
 * destination is replaced: a move that would replace something is refused
 * before approval, and checked again just before it runs.
 *
 * Inside the workspace a move follows the workspace's rules for any change. A
 * move that takes from or puts outside it names the whole real path there and
 * is asked about every time; Zhiyin's own folders, a drive, the person's user
 * folder and a folder holding the workspace are never moved, and nothing is
 * put inside Zhiyin's own folders.
 */

import {
  cp,
  lstat,
  mkdir,
  opendir,
  realpath,
  rename,
  rm,
} from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  parse,
  relative,
  resolve,
} from "node:path";
import type {
  FileChange,
  ProducedFile,
  ToolCallInspection,
  ToolInvocationResult,
  ToolSpec,
} from "@zhiyin/contract";
import {
  holds,
  placeForWriting,
  placeOutside,
  realStaysInside,
  staysBelow,
  staysInside,
} from "@zhiyin/workspace-containment";
import { detailsOf, facts } from "../../shared/action-detail.js";
import { changingFiles } from "../../shared/effects.js";
import {
  describeBytes,
  describeCommand,
  errorCode,
  namesStream,
  normalizePath,
  toForwardSlashes,
} from "../../shared/workspace-path.js";
import type { ConversationItems } from "../../shared/conversation-items.js";
import type { ToolDefinition } from "../../tool-definition.js";
import { placementRefused } from "../editing/write-file.js";
import { keptInPlace } from "../taking-away.js";
import { schemaInput, withSchemaProblems } from "@zhiyin/tool-input";

const maximumMoves = 50;
/** The most files one call moves; each is declared and copied for recovery. */
const maximumFiles = 5_000;

const pathSchema = (description: string) => ({
  type: "string",
  description,
});
const fromSchema = pathSchema(
  "Workspace-relative path of the file or folder to move, or its whole path when it is outside the workspace.",
);
const toSchema = pathSchema(
  "Where it goes, with its new name: workspace-relative, or a whole path outside the workspace. Nothing may be there already.",
);

const moveFileSpec: ToolSpec = {
  name: "move_file",
  description: `Move or rename files and folders; a folder goes with everything in it. Use this rather than shell commands to move or rename. One move is given as from and to, several as moves. One call moves at most ${maximumFiles.toLocaleString("en-US")} files, counting everything in the folders it moves. Missing folders at the destination are created, and nothing already there is replaced. A file or folder outside the workspace is named by its whole path; a move that takes from or puts outside the workspace is asked about every time.`,
  inputSchema: {
    type: "object",
    properties: {
      from: fromSchema,
      to: toSchema,
      moves: {
        type: "array",
        minItems: 1,
        maxItems: maximumMoves,
        description:
          "For several moves, instead of from and to: applied in order, each item at most once.",
        items: {
          type: "object",
          properties: { from: fromSchema, to: toSchema },
          required: ["from", "to"],
          additionalProperties: false,
        },
      },
    },
    additionalProperties: false,
  },
};

type Refusal = Extract<ToolCallInspection, { readonly ok: false }>;

/** One move as asked. */
type Asked = {
  readonly from: string;
  readonly to: string;
};

type MoveInput = { readonly from?: string; readonly to?: string };

function askedMove({ from, to }: MoveInput): Asked | undefined {
  if (!from?.trim() || !to?.trim()) return;
  return { from: normalizePath(from), to: normalizePath(to) };
}

function askedMoves(
  args: unknown,
): readonly Asked[] | { readonly mixed: true } | undefined {
  const input = schemaInput<
    MoveInput & { readonly moves?: readonly MoveInput[] }
  >(moveFileSpec.inputSchema, args);
  if (!input) return;
  const { moves: list, ...one } = input;
  // One move at the top of the call, or several as moves, never both.
  if (list && Object.keys(one).length) return { mixed: true };
  if (!list) {
    const move = askedMove(one);
    return move ? [move] : undefined;
  }
  const moves: Asked[] = [];
  for (const entry of list) {
    const move = askedMove(entry);
    if (!move) return;
    moves.push(move);
  }
  return moves;
}

/** One file a move carries, by where it is now and where it goes. */
type Carried = {
  readonly from: string;
  readonly to: string;
  readonly fromShown: string;
  readonly toShown: string;
  readonly bytes: number;
};

/** A move as it will be made: both ends by their real paths. */
type Planned = {
  readonly asked: Asked;
  readonly kind: "file" | "folder";
  readonly from: string;
  readonly to: string;
  readonly fromShown: string;
  readonly toShown: string;
  readonly fromOutside: boolean;
  readonly toOutside: boolean;
  /** The nearest missing folder the move creates, as shown. */
  readonly createsFolder?: string;
  readonly files: readonly Carried[];
  readonly bytes: number;
  /** What changes when the source does: approval is for this one. */
  readonly fingerprint: string;
};

const notMoved = (reason: string): Refusal => ({ ok: false, reason });

function correctable(reason: string): Refusal {
  return { ok: false, reason, correctable: true };
}

/** Where the thing to move is, or why it is not moved. */
type Source = {
  readonly absolute: string;
  readonly shown: string;
  readonly outside: boolean;
  readonly kind: "file" | "folder";
  readonly fingerprint: string;
};

async function sourceOf(
  root: string,
  realRoot: string,
  asked: Asked,
  protect: readonly string[],
): Promise<Source | Refusal> {
  const path = asked.from;
  const missing = correctable(`${path} does not exist.`);
  const unchecked = notMoved(`${path} could not be checked before moving.`);
  const absolute = resolve(root, path);
  const outside = isAbsolute(path);
  if (outside && namesStream(path.slice(parse(path).root.length)))
    return notMoved(`${path} has a ":" past its drive. Name it without one.`);
  // A whole path into the workspace is the workspace's.
  if (outside && staysInside(root, absolute))
    return sourceOf(
      root,
      realRoot,
      { ...asked, from: toForwardSlashes(relative(root, absolute)) || "." },
      protect,
    );
  if (!outside) {
    if (namesStream(path) || !staysInside(root, absolute))
      return notMoved(
        "Name a file or folder in the workspace by its workspace-relative path, or one outside it by its whole path.",
      );
    if (!staysBelow(root, absolute))
      return notMoved("The workspace folder itself cannot be moved.");
  } else if (dirname(absolute) === absolute)
    return notMoved(`${path} is a whole drive, which is not moved.`);
  // The folder it sits in, with links resolved, is where it really is; the
  // last part is looked at, not followed.
  let folder: string;
  let entry;
  try {
    folder = await realpath(dirname(absolute));
    entry = await lstat(join(folder, basename(absolute)));
  } catch (error) {
    return ["ENOENT", "ENOTDIR"].includes(errorCode(error) as string)
      ? missing
      : unchecked;
  }
  if (entry.isSymbolicLink())
    return notMoved(
      `${path} is a link, and moving it from here would move what it leads to. Move it with a command if that is meant.`,
    );
  if (!entry.isFile() && !entry.isDirectory())
    return notMoved(`${path} is not an ordinary file or folder.`);
  const canonical = await realpath(join(folder, basename(absolute))).catch(
    () => undefined,
  );
  if (canonical === undefined) return unchecked;
  const inside = realStaysInside(realRoot, canonical);
  if (!outside && !inside)
    return notMoved(
      "Name a file or folder in the workspace by its workspace-relative path, or one outside it by its whole path.",
    );
  if (inside && canonical === realRoot)
    return notMoved("The workspace folder itself cannot be moved.");
  const kept = keptInPlace(canonical, {
    realRoot,
    protect,
    folder: entry.isDirectory(),
    take: "moved",
  });
  if (kept) return notMoved(kept);
  return {
    absolute: canonical,
    shown: inside ? toForwardSlashes(relative(realRoot, canonical)) : canonical,
    outside: !inside,
    kind: entry.isFile() ? "file" : "folder",
    fingerprint: `${entry.ino}:${entry.size}:${entry.mtimeMs}`,
  };
}

/** Where a move puts its file or folder, or why it does not. */
type Destination = {
  readonly absolute: string;
  readonly shown: string;
  readonly outside: boolean;
};

async function destinationOf(
  realRoot: string,
  asked: Asked,
  protect: readonly string[],
): Promise<Destination | Refusal> {
  const path = asked.to;
  const refused = (reason: string, correctable?: true): Refusal => ({
    ok: false,
    reason,
    ...(correctable ? { correctable } : {}),
  });
  if (!isAbsolute(path)) {
    const inside = await placeForWriting(realRoot, path);
    if (inside.kind !== "writable") {
      const { reason, correctable } = placementRefused(path, inside.kind);
      return refused(reason, correctable);
    }
    return {
      absolute: inside.absolute,
      shown: inside.relative,
      outside: false,
    };
  }
  const place = await placeOutside(realRoot, path, { protect });
  if (place.kind !== "writable") {
    const { reason, correctable } = placementRefused(path, place.kind);
    return refused(reason, correctable);
  }
  return place.inside
    ? { absolute: place.absolute, shown: place.relative, outside: false }
    : { absolute: place.absolute, shown: place.absolute, outside: true };
}

/** What lies at `path` without following a link there. */
async function entryAt(
  path: string,
): Promise<"absent" | "file" | "folder" | "other" | "unreadable"> {
  try {
    const entry = await lstat(path);
    return entry.isFile() ? "file" : entry.isDirectory() ? "folder" : "other";
  } catch (error) {
    return ["ENOENT", "ENOTDIR"].includes(errorCode(error) as string)
      ? "absent"
      : "unreadable";
  }
}

/**
 * The nearest folder above `path` that is missing and would be created, or
 * a refusal when what stands in the way is not a folder.
 */
async function missingFolder(
  path: string,
): Promise<{ readonly missing?: string } | { readonly blocked: string }> {
  let missing: string | undefined;
  for (let folder = dirname(path); ; folder = dirname(folder)) {
    const found = await entryAt(folder);
    if (found === "folder") return missing ? { missing } : {};
    if (found !== "absent") return { blocked: folder };
    missing = folder;
    if (dirname(folder) === folder) return { blocked: folder };
  }
}

/** The files in a folder, by their paths below it, or why it is not moved. */
async function filesIn(
  folder: string,
  shown: string,
): Promise<
  | { readonly files: readonly { path: string; bytes: number }[] }
  | { readonly refused: string }
> {
  const files: { path: string; bytes: number }[] = [];
  for await (const entry of await opendir(folder, { recursive: true })) {
    const full = join(entry.parentPath, entry.name);
    const below = toForwardSlashes(relative(folder, full));
    if (entry.isSymbolicLink())
      return {
        refused: `${shown} holds a link, ${below}, which is not moved from here. Move it with a command if that is meant.`,
      };
    if (entry.isDirectory()) continue;
    if (!entry.isFile())
      return {
        refused: `${shown} holds ${below}, which is not an ordinary file.`,
      };
    if (files.length === maximumFiles)
      return {
        refused: `${shown} holds more than ${maximumFiles.toLocaleString("en-US")} files, more than one move declares. Move it with a command instead.`,
      };
    files.push({ path: below, bytes: (await lstat(full)).size });
  }
  return { files };
}

function joined(shown: string, below: string, outside: boolean): string {
  return outside ? join(shown, below) : `${shown}/${below}`;
}

async function planMove(
  root: string,
  realRoot: string,
  asked: Asked,
  protect: readonly string[],
): Promise<Planned | Refusal> {
  const source = await sourceOf(root, realRoot, asked, protect);
  if ("ok" in source) return source;
  const destination = await destinationOf(realRoot, asked, protect);
  if ("ok" in destination) return destination;
  const placed = destination.absolute;
  // On Windows a name differing only in case is the same entry: renaming it
  // is the move, not a replacement, and the name keeps the case asked for.
  const found = await entryAt(placed);
  const same =
    found !== "absent" &&
    (await realpath(placed).catch(() => undefined)) === source.absolute;
  if (!same && source.kind === "folder" && holds(source.absolute, placed))
    return notMoved(`${source.shown} cannot be moved into itself.`);
  const to = same ? join(dirname(placed), basename(asked.to)) : placed;
  const toShown = destination.outside
    ? to
    : toForwardSlashes(relative(realRoot, to));
  if (same && basename(to) === basename(source.absolute))
    return correctable(`${toShown} is where ${source.shown} already is.`);
  if (found !== "absent" && !same)
    return correctable(
      `${toShown} already exists, and a move never replaces it. Choose another name, or delete it first if it should go.`,
    );
  const folder = await missingFolder(to);
  if ("blocked" in folder)
    return notMoved(
      `${toShown} cannot be made: ${folder.blocked} is not a folder.`,
    );
  // Named as a new file's folder is: the whole folder it goes in.
  const createsFolder =
    folder.missing === undefined
      ? undefined
      : destination.outside
        ? dirname(to)
        : toForwardSlashes(relative(realRoot, dirname(to)));
  const ends = {
    asked,
    from: source.absolute,
    to,
    fromShown: source.shown,
    toShown,
    fromOutside: source.outside,
    toOutside: destination.outside,
    ...(createsFolder ? { createsFolder } : {}),
  };
  if (source.kind === "file") {
    const bytes = (await lstat(source.absolute)).size;
    return {
      ...ends,
      kind: "file",
      files: [
        {
          from: source.absolute,
          to,
          fromShown: source.shown,
          toShown,
          bytes,
        },
      ],
      bytes,
      fingerprint: source.fingerprint,
    };
  }
  const listed = await filesIn(source.absolute, source.shown).catch(() => ({
    refused: `${source.shown} could not be read before moving.`,
  }));
  if ("refused" in listed) return notMoved(listed.refused);
  const bytes = listed.files.reduce((sum, file) => sum + file.bytes, 0);
  return {
    ...ends,
    kind: "folder",
    files: listed.files.map((file) => ({
      from: join(source.absolute, file.path),
      to: join(to, file.path),
      fromShown: joined(source.shown, file.path, source.outside),
      toShown: joined(toShown, file.path, destination.outside),
      bytes: file.bytes,
    })),
    bytes,
    fingerprint: `${source.fingerprint}:${listed.files.length}:${bytes}`,
  };
}

/** Two moves in one call that would reach the same file. */
function overlap(
  planned: readonly Planned[],
  next: Planned,
): string | undefined {
  for (const other of planned) {
    if (
      realStaysInside(other.from, next.from) ||
      realStaysInside(next.from, other.from)
    )
      return `${next.fromShown} is moved twice: ${other.fromShown} is moved too. Move each item once.`;
    if (holds(other.to, next.to) || holds(next.to, other.to))
      return `${next.toShown} and ${other.toShown} would be put in the same place. Give each move its own destination.`;
    if (holds(other.from, next.to) || holds(next.from, other.to))
      return `${next.fromShown} and ${other.fromShown} cross: one goes where the other is. Make them in separate calls.`;
  }
  return undefined;
}

async function planMoves(
  root: string,
  args: unknown,
  protect: readonly string[],
): Promise<readonly Planned[] | Refusal> {
  const asked = askedMoves(args);
  if (!asked)
    return {
      ok: false,
      reason: withSchemaProblems(
        "Give one move as from and to, or several as moves, each with from and to.",
        args,
        moveFileSpec.inputSchema,
      ),
      correctable: true,
    };
  if ("mixed" in asked)
    return {
      ok: false,
      reason:
        "Give one move as from and to, or several as moves, not both. Nothing was moved.",
      correctable: true,
    };
  const realRoot = await realpath(root).catch(() => undefined);
  if (!realRoot) return notMoved("Choose a folder before using files.");
  const planned: Planned[] = [];
  let files = 0;
  for (const move of asked) {
    const plan = await planMove(root, realRoot, move, protect);
    if ("ok" in plan) return plan;
    const crossed = overlap(planned, plan);
    if (crossed) return { ok: false, reason: crossed, correctable: true };
    files += plan.files.length;
    if (files > maximumFiles)
      return notMoved(
        `These moves carry more than ${maximumFiles.toLocaleString("en-US")} files, more than one call declares. Move fewer at once, or use a command.`,
      );
    planned.push(plan);
  }
  return planned;
}

function described(plan: Planned): string {
  const what =
    plan.kind === "file"
      ? `${plan.fromShown} (${describeBytes(plan.bytes)})`
      : `${plan.fromShown}, a folder with ${plan.files.length} file${plan.files.length === 1 ? "" : "s"} (${describeBytes(plan.bytes)})`;
  return `${what} goes to ${plan.toShown}${plan.createsFolder ? `, in a folder this creates, ${plan.createsFolder}` : ""}`;
}

function actionOf(planned: readonly Planned[]): {
  readonly action: string;
  readonly target: string;
} {
  if (planned.length === 1) {
    const [only] = planned as [Planned];
    const renames =
      dirname(only.from) === dirname(only.to) &&
      only.fromOutside === only.toOutside;
    return {
      action: `${renames ? "Rename" : "Move"} ${only.fromShown} to ${only.toShown}`,
      target: only.fromShown,
    };
  }
  const count = `${planned.length} items`;
  return { action: `Move ${count}`, target: count };
}

/** Both ends of every file the moves carry. */
function changesOf(planned: readonly Planned[]): FileChange[] {
  const files = planned.flatMap((plan) =>
    plan.files.map((file) => ({ plan, file })),
  );
  return [
    ...files.map(({ file }) => ({
      path: file.fromShown,
      change: "moved" as const,
      to: file.toShown,
    })),
    ...files.map(({ plan, file }) => ({
      path: file.toShown,
      change: "created" as const,
      from: file.fromShown,
      ...(plan.kind === "file" && plan.createsFolder
        ? { createdFolder: plan.createsFolder }
        : {}),
    })),
  ];
}

function inspectionOf(
  planned: readonly Planned[],
  args: unknown,
): ToolCallInspection {
  const outside = planned.some((plan) => plan.fromOutside || plan.toOutside);
  return {
    ok: true,
    ...actionOf(planned),
    detail: `${outside ? "Something here is outside the folder you selected. " : ""}${planned.map(described).join("; ")}. Nothing already there is replaced.`,
    // Outside the workspace, a move is asked about every time.
    ...(outside ? { asksEachTime: true as const } : {}),
    changes: changesOf(planned),
    effects: changingFiles(
      planned.flatMap((plan) => [
        { absolute: plan.from, outside: plan.fromOutside },
        { absolute: plan.to, outside: plan.toOutside },
      ]),
    ),
    identity: JSON.stringify(
      planned.map((plan) => [plan.fromShown, plan.toShown, plan.fingerprint]),
    ),
    command: describeCommand(moveFileSpec.name, args),
  };
}

/**
 * Moves one planned item: a rename where Windows can make one, otherwise a
 * copy, checked, before the original is removed. A copy left part way is
 * taken away again, so a failed move leaves the original as it was.
 */
async function carry(plan: Planned): Promise<void> {
  await mkdir(dirname(plan.to), { recursive: true });
  // Checked again just before: a rename on Windows replaces a file there.
  if ((await entryAt(plan.to)) !== "absent") {
    const same = (await realpath(plan.to).catch(() => undefined)) === plan.from;
    if (!same) throw new Error("exists");
  }
  try {
    await rename(plan.from, plan.to);
    return;
  } catch (error) {
    if (errorCode(error) !== "EXDEV") throw error;
  }
  try {
    await cp(plan.from, plan.to, {
      recursive: true,
      errorOnExist: true,
      force: false,
      preserveTimestamps: true,
    });
    for (const file of plan.files) {
      const copied = await lstat(file.to);
      if (!copied.isFile() || copied.size !== file.bytes)
        throw new Error("incomplete");
    }
  } catch (error) {
    await rm(plan.to, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
  await rm(plan.from, { recursive: plan.kind === "folder", force: false });
}

/** What the conversation read of each file, carried to its new path. */
async function carryReads(
  plan: Planned,
  items: ConversationItems | undefined,
  conversationId: string | undefined,
): Promise<void> {
  if (!items || !conversationId) return;
  for (const file of plan.files) {
    try {
      const read = await items.lastRead(conversationId, file.from);
      if (read) await items.noteRead(conversationId, file.to, read);
    } catch {
      // The move succeeded. Left unrecorded, the next edit asks for a read.
    }
  }
}

async function runMoves(
  root: string,
  args: unknown,
  protect: readonly string[],
  signal: AbortSignal | undefined,
  items: ConversationItems | undefined,
  conversationId: string | undefined,
): Promise<ToolInvocationResult> {
  const planned = await planMoves(root, args, protect);
  if ("ok" in planned) return planned;
  const moved: Planned[] = [];
  const failed: { readonly plan: Planned; readonly reason: string }[] = [];
  for (const plan of planned) {
    if (signal?.aborted) {
      failed.push({ plan, reason: "the action was stopped first." });
      continue;
    }
    try {
      await carry(plan);
      moved.push(plan);
      await carryReads(plan, items, conversationId);
    } catch (error) {
      failed.push({
        plan,
        reason:
          error instanceof Error && error.message === "exists"
            ? `${plan.toShown} appeared since the move was approved, and is not replaced.`
            : "it could not be moved; check that nothing has it open.",
      });
    }
  }
  const produced: ProducedFile[] = moved.flatMap((plan) =>
    plan.kind === "file"
      ? [{ path: plan.toShown, change: "created" as const, bytes: plan.bytes }]
      : [],
  );
  const done = moved.map((plan) => ({
    from: plan.fromShown,
    to: plan.toShown,
  }));
  if (!failed.length)
    return {
      ok: true,
      value: { moved: done },
      ...(produced.length ? { produced } : {}),
      ...detailsOf(
        facts(
          ...done.map(
            (item) =>
              ["Moved", `${item.from} → ${item.to}`] as [string, string],
          ),
        ),
      ),
    };
  return {
    ok: false,
    reason: [
      ...failed.map(
        ({ plan, reason }) => `${plan.fromShown} was not moved: ${reason}`,
      ),
      ...(done.length
        ? [
            `Done: ${done.map((item) => `${item.from} → ${item.to}`).join(", ")}.`,
          ]
        : []),
    ].join(" "),
    ...(produced.length ? { produced } : {}),
  };
}

/** Moving and renaming files and folders, as the registry offers it. */
export function moveFileTool(
  items: ConversationItems | undefined,
  protect: readonly string[],
): ToolDefinition {
  return {
    spec: moveFileSpec,
    requiresWorkspace: true,
    inspect: async (args, _conversationId, { root }) => {
      const planned = await planMoves(root, args, protect);
      return "ok" in planned ? planned : inspectionOf(planned, args);
    },
    execute: (args, signal, conversationId, { root }) =>
      runMoves(root, args, protect, signal, items, conversationId),
  };
}
