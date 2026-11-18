/**
 * The permissions that hold a file or folder for a while against sealed-off
 * programs, written as Windows writes permissions as text.
 *
 * A sealed-off program reaches a file through the entries its container's
 * capabilities have in the file's permissions. A deny entry for a capability
 * is ignored for an app container, so holding a path cannot add one: it gives
 * the path permissions of its own, apart from its folder's, in which every
 * app container entry allows less. Every other entry stays as it was, so the
 * person keeps the access they had.
 */

/** Reading, listing and running what it holds. */
const READ = 0x001200a9;
/** Reading and changing it, as a folder grant gives. */
const CHANGE = 0x001301bf;
const DELETE = 0x00010000;
/** Removing what a folder holds, whatever its own permissions say. */
const DELETE_CHILD = 0x00000040;
const GENERIC = {
  read: 0x80000000,
  write: 0x40000000,
  execute: 0x20000000,
  all: 0x10000000,
} as const;
/** What each generic right means for a file. */
const FILE_GENERIC = {
  read: 0x00120089,
  write: 0x00120116,
  execute: 0x001200a0,
  all: 0x001f01ff,
} as const;

/** The rights Windows writes as two letters, for files and folders. */
const named: Readonly<Record<string, number>> = {
  GA: GENERIC.all,
  GR: GENERIC.read,
  GW: GENERIC.write,
  GX: GENERIC.execute,
  FA: FILE_GENERIC.all,
  FR: FILE_GENERIC.read,
  FW: FILE_GENERIC.write,
  FX: FILE_GENERIC.execute,
  SD: DELETE,
  RC: 0x00020000,
  WD: 0x00040000,
  WO: 0x00080000,
  CC: 0x00000001,
  DC: 0x00000002,
  LC: 0x00000004,
  SW: 0x00000008,
  RP: 0x00000010,
  WP: 0x00000020,
  DT: 0x00000040,
  LO: 0x00000080,
  CR: 0x00000100,
};

/**
 * How a path is held:
 *
 * - `read-only`: a sealed-off program may read it and change nothing of it,
 *   neither its contents nor its name; a folder held so takes no new entry.
 *   What a folder holds keeps its own permissions.
 * - `in-place`: a sealed-off program may change it, and add to a folder, but
 *   not move or delete it, so what is held inside stays where it is.
 * - `tree`: a folder and everything in it, read-only: the folder's own
 *   entries for app containers allow only reading, and so do those it hands
 *   on, which Windows writes into everything below that takes from it.
 */
export type HoldKind = "read-only" | "in-place" | "tree";

/** An app container, or one of its capabilities: Windows' app package SIDs. */
function appPackage(sid: string): boolean {
  return sid === "AC" || sid.startsWith("S-1-15-");
}

/** A rights field as a number, generic rights read as a file's; or nothing. */
function rightsOf(text: string): number | undefined {
  let mask = 0;
  if (/^0x[0-9a-f]+$/i.test(text)) mask = Number.parseInt(text.slice(2), 16);
  else if (/^\d+$/.test(text)) mask = Number.parseInt(text, 10);
  else {
    if (text.length % 2 !== 0) return undefined;
    for (let at = 0; at < text.length; at += 2) {
      const right = named[text.slice(at, at + 2)];
      if (right === undefined) return undefined;
      mask |= right;
    }
  }
  if (mask & GENERIC.read) mask |= FILE_GENERIC.read;
  if (mask & GENERIC.write) mask |= FILE_GENERIC.write;
  if (mask & GENERIC.execute) mask |= FILE_GENERIC.execute;
  if (mask & GENERIC.all) mask |= FILE_GENERIC.all;
  return (mask & 0x0fffffff) >>> 0;
}

/** Splits text at `separator` outside parentheses. */
function topLevel(text: string, separator: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let at = 0; at < text.length; at += 1) {
    const character = text[at];
    if (character === "(") depth += 1;
    else if (character === ")") depth -= 1;
    else if (character === separator && depth === 0) {
      parts.push(text.slice(start, at));
      start = at + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

type Parsed = {
  readonly control: readonly string[];
  readonly entries: readonly string[][];
};

/** Permissions as text, `D:` and its entries, or nothing it cannot read. */
function parse(text: string): Parsed | undefined {
  if (!text.startsWith("D:")) return undefined;
  const open = text.indexOf("(");
  const head = open < 0 ? text.slice(2) : text.slice(2, open);
  // No list at all lets everyone in; there is nothing here to hold back.
  if (head.includes("NO_ACCESS_CONTROL")) return undefined;
  const control = head.match(/AI|AR|P/g) ?? [];
  if (control.join("") !== head) return undefined;
  const entries: string[][] = [];
  let depth = 0;
  let start = -1;
  const body = open < 0 ? "" : text.slice(open);
  for (let at = 0; at < body.length; at += 1) {
    if (body[at] === "(") {
      if (depth === 0) start = at + 1;
      depth += 1;
    } else if (body[at] === ")") {
      depth -= 1;
      if (depth === 0) entries.push(topLevel(body.slice(start, at), ";"));
      if (depth < 0) return undefined;
    } else if (depth === 0) return undefined;
  }
  if (depth !== 0) return undefined;
  return entries.every((entry) => entry.length >= 6)
    ? { control, entries }
    : undefined;
}

/** An entry's inheritance flags as two-letter tokens. */
const flagsOf = (text: string): string[] => text.match(/.{2}/g) ?? [];

/**
 * The permissions that hold a path as `kind`, from those it has: protected
 * from its folder's, what it took from the folder written as its own, and
 * each app container entry allowing at most reading (`read-only`) or no
 * deleting (`in-place`) of the path itself. A folder's entries hand on to
 * what it holds as they did. Nothing when the permissions hold an app
 * container entry this cannot limit, or cannot be read.
 *
 * `granted` names capabilities given the folder the path is in, which the
 * path carries as though it had taken them from its folder even when the
 * grant has not reached it yet: held, it takes nothing from its folder.
 */
export function heldPermissions(
  original: string,
  kind: HoldKind,
  folder: boolean,
  granted: readonly string[] = [],
): string | undefined {
  const parsed = parse(original);
  if (!parsed) return undefined;
  const sids = new Set(parsed.entries.map((entry) => entry[5]));
  const entries = [
    ...parsed.entries,
    ...granted
      .filter((sid) => !sids.has(sid))
      .map((sid) => ["A", "OICIID", `0x${CHANGE.toString(16)}`, "", "", sid]),
  ];
  const written: string[] = [];
  for (const [type = "", flags = "", rights = "", ...rest] of entries) {
    const own = flagsOf(flags).filter((flag) => flag !== "ID");
    const sid = rest[2] ?? "";
    if (!appPackage(sid)) {
      written.push(`(${[type, own.join(""), rights, ...rest].join(";")})`);
      continue;
    }
    // Only an allowing entry of the plain kind can be limited here; a
    // conditional or object entry could still let the program write.
    if (type !== "A" || rest.length !== 3) return undefined;
    const mask = rightsOf(rights);
    if (mask === undefined) return undefined;
    // A whole tree hands on reading alone, as it allows the folder.
    if (kind === "tree") {
      written.push(
        `(A;${own.join("")};0x${((mask & READ) >>> 0).toString(16)};;;${sid})`,
      );
      continue;
    }
    // An entry only for what a folder holds does not reach the folder.
    if (own.includes("IO")) {
      written.push(`(${["A", own.join(""), rights, ...rest].join(";")})`);
      continue;
    }
    const limited = kind === "read-only" ? mask & READ : mask & ~DELETE;
    written.push(`(A;;0x${(limited >>> 0).toString(16)};;;${sid})`);
    if (folder && (own.includes("OI") || own.includes("CI")))
      written.push(`(A;${[...own, "IO"].join("")};${rights};;;${sid})`);
  }
  const autoInherited = parsed.control.includes("AI");
  return `D:P${autoInherited ? "AI" : ""}${written.join("")}`;
}

/**
 * Whether permissions let an app container do more than read through an
 * entry of their own, one that a folder's entries handed on cannot replace:
 * an entry not taken from the folder, in permissions protected from it or
 * not. Unreadable permissions are taken to.
 */
export function appsMayChange(permissions: string): boolean {
  const parsed = parse(permissions);
  if (!parsed) return true;
  return parsed.entries.some(
    ([type = "", flags = "", rights = "", ...rest]) => {
      const own = flagsOf(flags);
      if (
        !appPackage(rest[2] ?? "") ||
        own.includes("ID") ||
        own.includes("IO")
      )
        return false;
      const mask = rightsOf(rights);
      return type !== "A" || mask === undefined || (mask & ~READ) !== 0;
    },
  );
}

/**
 * Whether permissions let a container Zhiyin starts remove what a folder
 * holds by the folder's own right to, which would let it move a held entry
 * away whatever the entry's own permissions say. A container holds the
 * all-apps group, its own SID and the capabilities Zhiyin names, never
 * another app's. Unreadable permissions are taken to.
 */
export function appsMayRemoveFrom(permissions: string): boolean {
  const parsed = parse(permissions);
  if (!parsed) return true;
  return parsed.entries.some(
    ([type = "", flags = "", rights = "", ...rest]) => {
      const sid = rest[2] ?? "";
      const containers =
        sid === "AC" ||
        sid.startsWith("S-1-15-2-") ||
        sid.startsWith("S-1-15-3-1024-");
      if (!containers || flagsOf(flags).includes("IO") || type.startsWith("D"))
        return false;
      const mask = rightsOf(rights);
      return mask === undefined || (mask & DELETE_CHILD) !== 0;
    },
  );
}

/**
 * Permissions as text, marked so that Windows keeps whether they took
 * entries from their folder as the text says. Setting them on one object
 * hands nothing on to what a folder holds.
 */
export function asWritten(permissions: string): string {
  const parsed = parse(permissions);
  if (!parsed) return permissions;
  const open = permissions.indexOf("(");
  const rest = open < 0 ? "" : permissions.slice(open);
  const control = new Set(parsed.control);
  return `D:${control.has("P") ? "P" : ""}AR${control.has("AI") ? "AI" : ""}${rest}`;
}
