/**
 * The grants a conversation holds: what an asked call can be allowed for the
 * conversation, and the grant that already covers it. Decided from the call's
 * effects, as the engine decides, with the paths, connection and set of calls
 * a grant is bound to, and the places a grant must never reach; the engine
 * reads no file: what a file holds now comes from whoever asks.
 */

import { homedir } from "node:os";
import { basename, dirname, isAbsolute, parse, resolve, sep } from "node:path";
import type {
  ConversationPermission,
  ToolCallInspection,
  ToolOwner,
} from "@zhiyin/contract";
import {
  realStaysInside,
  runsLater,
  startupFolders,
} from "@zhiyin/workspace-containment";
import type { Decision } from "./permission-engine.js";
import { whoseWord } from "@zhiyin/trust-rules";

type Inspection = Extract<ToolCallInspection, { readonly ok: true }>;
export type PermissionScope = Omit<ConversationPermission, "id" | "at">;

/** The SHA-256 of what a file holds now, or nothing when there is none to read. */
export type ContentDigest = (path: string) => Promise<string | undefined>;

/**
 * How a file stands now, by its size and time of change, or nothing when
 * there is none: read for a file too large to hash at each call.
 */
export type FileStanding = (path: string) => Promise<string | undefined>;

/**
 * The places no grant reaches: the person's user folder, which a folder
 * grant may not hold, and the folders whose programs Windows starts at
 * sign-in, which no grant covers.
 */
export type KnownPlaces = {
  readonly home: string;
  /** Each a whole path. */
  readonly startup: readonly string[];
};

/** The places as this computer has them: the person's, and every account's Startup folder. */
export function knownPlaces(): KnownPlaces {
  return { home: resolve(homedir()), startup: startupFolders() };
}

/**
 * Every tool of the connection a call goes to, as a rule names them, by the
 * connection's id the connection feature set on the call, never by the
 * tool's name. The pattern is a name no tool has, so a rule for one tool
 * never reads as it. None for a call that names no connection.
 */
function everyToolOf(inspection: Inspection): string | undefined {
  return inspection.connectionId
    ? `mcp__${inspection.connectionId}__*`
    : undefined;
}

// The connection, never the target: a browser call targets the page it is
// on, and the rule covers the tool on every page.
function connectionName(inspection: Inspection): string {
  return (
    inspection.connection?.trim() ||
    inspection.target.trim() ||
    "Connected tool"
  );
}

function connectorLabel(name: string, inspection: Inspection): string {
  const connection = connectionName(inspection);
  const tool = inspection.invocation?.name ?? name.split("__").at(-1) ?? name;
  const words = tool.replace(/[_-]+/g, " ").trim();
  const withoutConnection = words
    .toLowerCase()
    .startsWith(`${connection.toLowerCase()} `)
    ? words.slice(connection.length + 1)
    : words;
  const operation = withoutConnection || "Tool";
  const only = inspection.boundToCall ? " · only this exact call" : "";
  return `${connection} · ${operation[0]!.toUpperCase()}${operation.slice(1)}${only}`;
}

/**
 * A change outside the workspace, by its effects, which only a grant for its
 * file or folder covers (ADR 0012): never a connection's allowance or a grant
 * for the call. The effects of a connection Zhiyin does not ship count for
 * nothing, as they do in the engine.
 */
const writesOutside = (owner: ToolOwner, inspection: Inspection) =>
  whoseWord(owner, inspection) !== "nothing" &&
  inspection.effects?.changes === "elsewhere";

/**
 * Describes exactly the repeatable authority a connection's inspection can
 * offer. Zhiyin's own file tools are allowed by file or folder instead
 * (offeredFiles).
 */
export function offeredPermission(
  owner: ToolOwner,
  name: string,
  inspection: Inspection,
): PermissionScope | undefined {
  // The code that owns the tool says when no grant may cover a call (ADR 0012).
  if (inspection.asksEachTime || writesOutside(owner, inspection)) return;
  const every = everyToolOf(inspection);
  if (owner === "mcp" && inspection.allowance && every)
    return {
      kind: "connector-tool",
      label: `${connectionName(inspection)} · ${inspection.allowance.label}`,
      toolName: every,
      identity: inspection.allowance.key,
    };
  if (owner === "mcp" && inspection.identity)
    return {
      kind: "connector-tool",
      label: connectorLabel(name, inspection),
      toolName: name,
      identity: inspection.identity,
    };
  return;
}

/**
 * The files a change outside the workspace changes, by its effects and the
 * real paths the tool declared (ADR 0013), never resolved again: a built-in
 * tool that says a file grant can cover its change, or a connection Zhiyin
 * ships, whose declaration is code Zhiyin owns. Only whole paths, with no
 * colon past the drive, are how a tool declares such a change.
 */
function outsideFiles(
  owner: ToolOwner,
  inspection: Inspection,
  places: KnownPlaces,
): string[] | undefined {
  const declaredByZhiyin =
    whoseWord(owner, inspection) === "zhiyin" &&
    (owner !== "built-in" || inspection.grantableByFile === true);
  if (
    !declaredByZhiyin ||
    inspection.effects?.changes !== "elsewhere" ||
    !inspection.changes?.length
  )
    return;
  const paths = inspection.changes.map((change) => change.path);
  const outside = paths.filter((path) => isAbsolute(path));
  // A connection's call may also change workspace files, as a render keeps
  // its settings in the scene: those ride with the call the grant names, and
  // are backed up as any change inside the workspace is.
  const alongside = paths.filter((path) => !isAbsolute(path));
  if (
    !outside.length ||
    outside.some((path) => runsLater(path, places.startup)) ||
    (alongside.length && owner !== "mcp") ||
    alongside.some(
      (path) =>
        path.includes(":") || path.split(/[\\/]/).some((part) => part === ".."),
    )
  )
    return;
  return outside.every(
    (path) =>
      !path.slice(parse(path).root.length).includes(":") &&
      resolve(path) === path,
  )
    ? outside
    : undefined;
}

/**
 * The folders outside the workspace a script changes, by the real paths its
 * tool declared and copies first (ADR 0012): a call of a tool Zhiyin ships
 * whose program may change any file in them, decided as a change elsewhere
 * that can be undone. A folder in a `.git` folder or a Startup folder is
 * never covered by a grant, nor is a path that is not whole.
 */
function scriptFolders(
  owner: ToolOwner,
  inspection: Inspection,
  places: KnownPlaces,
): string[] | undefined {
  const folders = inspection.changesAnyFile?.outside;
  if (
    whoseWord(owner, inspection) !== "zhiyin" ||
    !folders?.length ||
    inspection.effects?.changes !== "elsewhere"
  )
    return;
  return folders.every(
    (folder) =>
      isAbsolute(folder) &&
      resolve(folder) === folder &&
      !folder.slice(parse(folder).root.length).includes(":") &&
      !runsLater(folder, places.startup),
  )
    ? [...folders]
    : undefined;
}

/** The folder holding each of these folders: one of them, or the nearest above. */
function commonFolder(folders: readonly string[]): string {
  let folder = folders[0]!;
  while (!folders.every((each) => realStaysInside(folder, each))) {
    const parent = dirname(folder);
    if (parent === folder) break;
    folder = parent;
  }
  return folder;
}

/** The grants a change by Zhiyin's own file tools can be given: its file, or its folder. */
export type FileOffer = {
  readonly file?: PermissionScope;
  readonly folder?: PermissionScope;
};

/** Whether a folder is a drive, the person's user folder, or one holding it. */
function coversNearlyEverything(folder: string, places: KnownPlaces): boolean {
  return (
    dirname(folder) === folder ||
    realStaysInside(folder.toLowerCase(), places.home.toLowerCase())
  );
}

/**
 * The file grants a write outside the workspace, or a change to files Zhiyin
 * could not copy, changed the file of, so each is kept as the conversation
 * left the file: whichever grant covered the
 * call, or none, when it was allowed once.
 */
export function fileGrantsChangedBy(
  permissions: readonly ConversationPermission[],
  owner: ToolOwner,
  inspection: Inspection,
  places: KnownPlaces = knownPlaces(),
): ConversationPermission[] {
  const targets = outsideFiles(owner, inspection, places) ?? [];
  const uncopied = uncopiedFiles(owner, inspection, places) ?? [];
  return permissions.filter(
    (rule) =>
      !!rule.file &&
      ((rule.kind === "outside-file" && targets.includes(rule.file)) ||
        (rule.kind === "uncopied-file" && uncopied.includes(rule.file))),
  );
}

/**
 * The files a change for good by a tool Zhiyin ships changes without a copy,
 * by the whole real paths it carries (ADR 0013): none that is not whole, and
 * none that runs later, which no grant covers.
 */
function uncopiedFiles(
  owner: ToolOwner,
  inspection: Inspection,
  places: KnownPlaces,
): readonly string[] | undefined {
  const files = inspection.effects?.uncopied;
  if (
    whoseWord(owner, inspection) !== "zhiyin" ||
    inspection.asksEachTime ||
    inspection.effects?.changes !== "workspace-for-good" ||
    !files?.length
  )
    return;
  return files.every(
    (file) =>
      isAbsolute(file) &&
      resolve(file) === file &&
      !file.slice(parse(file).root.length).includes(":") &&
      !runsLater(file, places.startup),
  )
    ? files
    : undefined;
}

/**
 * For a change to files Zhiyin could not copy: the grant held for every one
 * of them, as the conversation last left it, or the grant to offer for the
 * one file no grant covers. Several such files offer nothing.
 */
async function uncopiedGrants(
  name: string,
  files: readonly string[],
  granted: readonly ConversationPermission[],
  standing: FileStanding,
): Promise<GrantAnswer> {
  const missing: string[] = [];
  let covering: ConversationPermission | undefined;
  for (const file of files) {
    const now = await standing(file);
    const rule = granted.find(
      (each) =>
        each.kind === "uncopied-file" &&
        each.file === file &&
        now !== undefined &&
        each.standing === now,
    );
    if (rule) covering ??= rule;
    else missing.push(file);
  }
  if (!missing.length) return answer(undefined, undefined, covering);
  const [only, ...more] = missing;
  return only && !more.length
    ? answer(
        undefined,
        {
          file: {
            kind: "uncopied-file",
            label: `Changes to ${basename(only)} without a backup`,
            toolName: name,
            file: only,
          },
        },
        undefined,
      )
    : {};
}

/** The folder holding every one of these paths. */
function holdingFolder(paths: readonly string[]): string | undefined {
  let folder = dirname(paths[0]!);
  while (!paths.every((path) => realStaysInside(folder, path))) {
    const parent = dirname(folder);
    if (parent === folder) return;
    folder = parent;
  }
  return folder;
}

/**
 * What a change outside the workspace by Zhiyin's own file tools can be
 * allowed for the conversation, each by its real path: the one file it
 * changes, or the folder it changes files in. A folder that is a drive, the
 * person's user folder, or one holding it, is never offered: it would cover
 * nearly everything (ADR 0012). In the workspace nothing is offered: a change
 * there is backed up and runs without asking (ADR 0012).
 *
 * A script given folders outside the workspace is offered the folder it
 * names, or the one holding all it names, on the same terms; nothing is
 * offered when that folder is in a `.git` or Startup folder.
 */
export function offeredFiles(
  owner: ToolOwner,
  name: string,
  inspection: Inspection,
  places: KnownPlaces = knownPlaces(),
): FileOffer | undefined {
  if (inspection.asksEachTime) return;
  const folders = scriptFolders(owner, inspection, places);
  if (folders) {
    const folder = commonFolder(folders);
    return coversNearlyEverything(folder, places) ||
      runsLater(folder, places.startup)
      ? undefined
      : {
          folder: {
            kind: "outside-folder" as const,
            label: `Changes to files in ${folder}${sep}`,
            toolName: name,
            folder,
          },
        };
  }
  const files = outsideFiles(owner, inspection, places);
  if (!files) return;
  const folder = holdingFolder(files) ?? parse(files[0]!).root;
  const tooWide = coversNearlyEverything(folder, places);
  return {
    ...(files.length === 1
      ? {
          file: {
            kind: "outside-file" as const,
            label: `Changes to ${files[0]!}`,
            toolName: name,
            file: files[0]!,
          },
        }
      : {}),
    ...(tooWide
      ? {}
      : {
          folder: {
            kind: "outside-folder" as const,
            label: `Changes to files in ${folder}${sep}`,
            toolName: name,
            folder,
          },
        }),
  };
}

/**
 * The grant that covers a change outside the workspace by Zhiyin's own file
 * tools: one for each file it changes, or for a folder holding them. A file's grant holds only
 * while the file is as Zhiyin last wrote it: changed elsewhere since, the
 * person is asked again. A folder's grant never covers deleting the folder
 * itself. A script given folders outside the workspace is covered when each
 * of them is in a folder granted for changes outside it, whichever tool's
 * call the grant was made from.
 */
export async function matchingFiles(
  permissions: readonly ConversationPermission[],
  owner: ToolOwner,
  inspection: Inspection,
  digest: ContentDigest,
  places: KnownPlaces = knownPlaces(),
): Promise<ConversationPermission | undefined> {
  if (inspection.asksEachTime) return;
  const folders = scriptFolders(owner, inspection, places);
  if (folders) {
    const covering = folders.map((folder) =>
      permissions.find(
        (rule) =>
          rule.kind === "outside-folder" &&
          !!rule.folder &&
          realStaysInside(rule.folder, folder),
      ),
    );
    return covering.every(Boolean) ? covering[0] : undefined;
  }
  const targets = outsideFiles(owner, inspection, places);
  if (!targets) return;
  let covering: ConversationPermission | undefined;
  for (const target of targets) {
    const folderRule = permissions.find(
      (rule) =>
        rule.kind === "outside-folder" &&
        !!rule.folder &&
        realStaysInside(rule.folder, target),
    );
    if (folderRule) {
      covering ??= folderRule;
      continue;
    }
    const now = await digest(target);
    const fileRule = permissions.find(
      (rule) =>
        rule.kind === "outside-file" &&
        rule.file === target &&
        rule.digest === now,
    );
    if (!fileRule) return;
    covering ??= fileRule;
  }
  return covering;
}

/** Checks every inspected call of a connection against the saved rule. */
export function matchingPermission(
  permissions: readonly ConversationPermission[],
  owner: ToolOwner,
  name: string,
  inspection: Inspection,
): ConversationPermission | undefined {
  if (inspection.asksEachTime || writesOutside(owner, inspection)) return;
  if (owner !== "mcp") return;
  return permissions.find((rule) =>
    rule.kind !== "connector-tool"
      ? false
      : rule.toolName === everyToolOf(inspection)
        ? !!inspection.allowance && rule.identity === inspection.allowance.key
        : rule.toolName === name &&
          !!inspection.identity &&
          rule.identity === inspection.identity,
  );
}

/**
 * The grant that may answer a call that acts as the person, decided by its
 * effects (ADR 0012): one for where it lands, across the connection's tools.
 */
export function offeredByEffects(
  inspection: Inspection,
): PermissionScope | undefined {
  const destination = inspection.effects?.destination;
  const every = everyToolOf(inspection);
  if (!destination || !every) return;
  return {
    kind: "destination",
    label: `${connectionName(inspection)} · ${destination}`,
    toolName: every,
    destination,
  };
}

/** The grant held for this call's destination. */
export function matchingByEffects(
  permissions: readonly ConversationPermission[],
  inspection: Inspection,
): ConversationPermission | undefined {
  const destination = inspection.effects?.destination;
  const every = everyToolOf(inspection);
  return destination && every
    ? permissions.find(
        (rule) =>
          rule.kind === "destination" &&
          rule.toolName === every &&
          rule.destination === destination,
      )
    : undefined;
}

/** A call `decide` asked about, with the grants its conversation holds. */
export type GrantQuestion = {
  readonly owner: ToolOwner;
  readonly name: string;
  readonly inspection: Inspection;
  /** What `decide` answered for the call. */
  readonly decision: Pick<Decision, "outcome" | "covers">;
  readonly granted: readonly ConversationPermission[];
  /** What a file holds now, read by whoever asks. */
  readonly digest: ContentDigest;
  /** How a file Zhiyin could not copy stands now, read by whoever asks. */
  readonly standing: FileStanding;
};

/** What a call asked about can be allowed for the conversation, and the grant that covers it already. */
export type GrantAnswer = {
  /** A grant for the connection's tool, or for where the call lands. */
  readonly candidate?: PermissionScope;
  /** A grant for the file a change outside the workspace makes, or its folder. */
  readonly files?: FileOffer;
  /** The grant held that answers the call in the person's place. */
  readonly applied?: ConversationPermission;
};

/** The conversation's standing grants, as the agent loop consults them. */
export interface GrantRules {
  /**
   * For a call `decide` asks about: what can be offered for the
   * conversation, and the grant held that already covers it, by what the
   * decision says may cover it. A call nothing may cover is offered nothing.
   */
  grants(question: GrantQuestion): Promise<GrantAnswer>;
  /** The file grants a write outside the workspace, or a change without a copy, changed the file of. */
  fileGrantsChangedBy(
    granted: readonly ConversationPermission[],
    owner: ToolOwner,
    inspection: Inspection,
  ): ConversationPermission[];
}

export class StandingGrantRules implements GrantRules {
  readonly #places: () => KnownPlaces;

  /** `places`: where no grant reaches, as this computer has them. */
  constructor(places: () => KnownPlaces = knownPlaces) {
    this.#places = places;
  }

  async grants({
    owner,
    name,
    inspection,
    decision,
    granted,
    digest,
    standing,
  }: GrantQuestion): Promise<GrantAnswer> {
    const covers = decision.covers;
    if (decision.outcome !== "ask" || covers === "never") return {};
    const places = this.#places();
    if (covers === "uncopied-file") {
      const files = uncopiedFiles(owner, inspection, places);
      return files ? uncopiedGrants(name, files, granted, standing) : {};
    }
    if (covers === undefined || covers === "tool")
      return answer(
        offeredPermission(owner, name, inspection),
        offeredFiles(owner, name, inspection, places),
        matchingPermission(granted, owner, name, inspection) ??
          (await matchingFiles(granted, owner, inspection, digest, places)),
      );
    if (covers === "file-or-folder")
      return answer(
        undefined,
        offeredFiles(owner, name, inspection, places),
        await matchingFiles(granted, owner, inspection, digest, places),
      );
    return answer(
      offeredByEffects(inspection),
      undefined,
      matchingByEffects(granted, inspection),
    );
  }

  fileGrantsChangedBy(
    granted: readonly ConversationPermission[],
    owner: ToolOwner,
    inspection: Inspection,
  ): ConversationPermission[] {
    return fileGrantsChangedBy(granted, owner, inspection, this.#places());
  }
}

function answer(
  candidate: PermissionScope | undefined,
  files: FileOffer | undefined,
  applied: ConversationPermission | undefined,
): GrantAnswer {
  return {
    ...(candidate ? { candidate } : {}),
    ...(files ? { files } : {}),
    ...(applied ? { applied } : {}),
  };
}
