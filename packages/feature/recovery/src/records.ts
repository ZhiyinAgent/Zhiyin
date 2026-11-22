/** What the store keeps of each action, on disk as its manifest. */

export type CapturedFile = {
  readonly path: string;
  readonly status: "protected" | "unprotected";
  readonly reason?: string;
  /** Not copied because the limits could not admit it. */
  readonly tooLarge?: true;
  /**
   * `unknown` for a file a shell command changed: nothing of what it held
   * before was kept, and only what the command left is known.
   */
  readonly before: "file" | "absent" | "unknown";
  /**
   * What the file held, by its SHA-256; for a junction or symbolic link,
   * `link:` and what it names, which is all that is kept of it. So with
   * `afterDigest`.
   */
  readonly beforeDigest?: string;
  /** The copy's file in the action's own folder. */
  readonly backup?: string;
  /**
   * The copy kept by its contents, taken of a whole folder before a program
   * ran in it: the digest of what the file held, in the shared store.
   */
  readonly content?: string;
  readonly bytes?: number;
  /**
   * Only what the file held is known, not kept: an earlier change of the
   * same turn left it, and a turn keeps a file only as the turn found it. It
   * links the changes around it, and is never put back from.
   */
  readonly linkOnly?: true;
  /**
   * `content` is the file as its turn found it, saved at the turn's first
   * write of it, and the change found it changed since: going back to the
   * message that opened the turn puts that back.
   */
  readonly turnStart?: true;
  readonly after?: "file" | "absent";
  readonly afterDigest?: string;
  /**
   * The copy went to the storage limits. Its digests stay, so the changes on
   * either side of it still follow one from the other.
   */
  readonly evicted?: true;
};

export type Manifest = {
  readonly version: 1;
  readonly actionId: string;
  /** Whose action it was. A manifest without one goes by age alone. */
  readonly conversationId?: string;
  readonly workspaceRoot: string;
  readonly createdAt: string;
  readonly phase: "prepared" | "committed";
  /**
   * What a program changed in its folder, found against a copy of the folder
   * taken before it ran: every file it holds is weighed, those that could not
   * be put back too.
   */
  readonly run?: true;
  readonly files: readonly CapturedFile[];
};

const optional = (value: unknown, type: "string" | "number") =>
  value === undefined || typeof value === type;

const optionalTrue = (value: unknown) => value === undefined || value === true;

function isCapturedFile(value: unknown): value is CapturedFile {
  if (typeof value !== "object" || value === null) return false;
  const file = value as Record<string, unknown>;
  return (
    typeof file["path"] === "string" &&
    (file["status"] === "protected" || file["status"] === "unprotected") &&
    (file["before"] === "file" ||
      file["before"] === "absent" ||
      file["before"] === "unknown") &&
    (file["after"] === undefined ||
      file["after"] === "file" ||
      file["after"] === "absent") &&
    optional(file["reason"], "string") &&
    optional(file["beforeDigest"], "string") &&
    optional(file["backup"], "string") &&
    optional(file["content"], "string") &&
    optional(file["bytes"], "number") &&
    optional(file["afterDigest"], "string") &&
    optionalTrue(file["tooLarge"]) &&
    optionalTrue(file["evicted"]) &&
    optionalTrue(file["linkOnly"]) &&
    optionalTrue(file["turnStart"])
  );
}

/** Whether what was read from disk is an action's manifest, as one is written. */
export function isManifest(value: unknown): value is Manifest {
  if (typeof value !== "object" || value === null) return false;
  const manifest = value as Record<string, unknown>;
  return (
    manifest["version"] === 1 &&
    typeof manifest["actionId"] === "string" &&
    optional(manifest["conversationId"], "string") &&
    typeof manifest["workspaceRoot"] === "string" &&
    typeof manifest["createdAt"] === "string" &&
    (manifest["phase"] === "prepared" || manifest["phase"] === "committed") &&
    optionalTrue(manifest["run"]) &&
    Array.isArray(manifest["files"]) &&
    manifest["files"].every(isCapturedFile)
  );
}
