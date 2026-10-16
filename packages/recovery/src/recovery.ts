import { createHash, randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type {
  FileChange,
  RewindCommitResult,
  RewindFileEffect,
  TaskAction,
} from "@zhiyin/contract";
import { staysInside } from "@zhiyin/workspace-containment";
import {
  DamagedCopyError,
  recreateExclusively,
  restoreExclusively,
} from "./exclusive-restore.js";

const mib = 1024 * 1024;

export type RecoveryLimits = {
  readonly totalBytes: number;
  readonly fileBytes: number;
  readonly versionsPerPath: number;
  readonly maximumAgeMs: number;
};

const defaults: RecoveryLimits = {
  totalBytes: 256 * mib,
  fileBytes: 10 * mib,
  versionsPerPath: 10,
  maximumAgeMs: 30 * 24 * 60 * 60 * 1000,
};

export type RecoveryPreparation = {
  readonly actionId: string;
  readonly files: readonly {
    readonly path: string;
    readonly status: "protected" | "unprotected";
    readonly reason?: string;
  }[];
};

type CapturedFile = {
  readonly path: string;
  readonly status: "protected" | "unprotected";
  readonly reason?: string;
  readonly before: "file" | "absent";
  readonly beforeDigest?: string;
  readonly backup?: string;
  readonly bytes?: number;
  readonly after?: "file" | "absent";
  readonly afterDigest?: string;
};

type Manifest = {
  readonly version: 1;
  readonly actionId: string;
  /** Whose action it was. A manifest without one goes by age alone. */
  readonly conversationId?: string;
  readonly workspaceRoot: string;
  readonly createdAt: string;
  readonly phase: "prepared" | "committed";
  readonly files: readonly CapturedFile[];
};

type KeptAction = { readonly folder: string; readonly manifest: Manifest };

type RestoreTarget = {
  readonly path: string;
  readonly absolute: string;
  readonly expected: "absent" | string;
  readonly restored: "absent" | string;
  readonly action: "restore" | "remove";
  readonly backup?: string;
};

export type RecoveryReview = {
  readonly id: string;
  readonly workspaceRoot: string;
  readonly files: readonly RewindFileEffect[];
  /** Kept inside the core; the renderer receives only `files`. */
  readonly targets: readonly RestoreTarget[];
};

/**
 * A file as it was before a run of actions and as the last of them left it,
 * from the copy kept before the first and the file on disk now.
 */
export type FileVersions =
  | {
      readonly ok: true;
      /** Absent when the actions created the file. */
      readonly before?: Uint8Array;
      readonly after: Uint8Array;
    }
  | { readonly ok: false; readonly reason: string };

export interface Recovery {
  prepare(
    actionId: string,
    workspaceRoot: string,
    changes: readonly FileChange[],
    conversationId: string,
  ): Promise<RecoveryPreparation>;
  validate(
    actionId: string,
  ): Promise<
    { readonly ok: true } | { readonly ok: false; readonly reason: string }
  >;
  commit(actionId: string): Promise<void>;
  discard(actionId: string): Promise<void>;
  review(
    reviewId: string,
    workspaceRoot: string,
    actions: readonly TaskAction[],
  ): Promise<RecoveryReview>;
  restore(review: RecoveryReview): Promise<RewindCommitResult>;
  /**
   * The file before the first of these actions and as the last left it, or
   * why that cannot be shown: no copy was kept, or the file changed since.
   */
  versions(
    workspaceRoot: string,
    actions: readonly TaskAction[],
    path: string,
  ): Promise<FileVersions>;
  cleanup(): Promise<void>;
  /** Removes everything kept for a deleted conversation's actions. */
  forgetConversation(conversationId: string): Promise<void>;
}

function digest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function key(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function kind(path: string): Promise<"file" | "absent" | "other"> {
  try {
    const entry = await lstat(path);
    return entry.isFile() ? "file" : "other";
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT"
      ? "absent"
      : "other";
  }
}

async function currentDigest(
  path: string,
): Promise<"absent" | "other" | string> {
  const entry = await kind(path);
  if (entry !== "file") return entry;
  return digest(await readFile(path));
}

async function nearestExistingParent(path: string): Promise<string> {
  let candidate = dirname(path);
  while (true) {
    try {
      return await realpath(candidate);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const parent = dirname(candidate);
      if (parent === candidate) throw error;
      candidate = parent;
    }
  }
}

/**
 * Why a path could not be looked at. Windows refusing access says so; it is
 * not evidence that the path left the workspace, and is never reported as that.
 */
function unreadable(path: string, error: unknown): string {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === "EACCES" || code === "EPERM"
    ? `Windows denied access to ${path}.`
    : `${path} could not be read.`;
}

async function safeAbsolute(
  root: string,
  path: string,
): Promise<string | undefined> {
  const target = resolve(root, path);
  if (!staysInside(root, target)) return;
  const entry = await kind(target);
  const resolved =
    entry === "absent"
      ? await nearestExistingParent(target)
      : await realpath(target);
  return staysInside(root, resolved) ? target : undefined;
}

export class FileRecovery implements Recovery {
  readonly #root: string;
  readonly #limits: RecoveryLimits;
  readonly #now: () => Date;
  readonly #prepared = new Map<string, Manifest>();
  /** Folders whose copies are being taken, before they have a manifest. */
  readonly #preparing = new Set<string>();

  constructor(
    dataDirectory: string,
    options: {
      readonly limits?: Partial<RecoveryLimits>;
      readonly now?: () => Date;
    } = {},
  ) {
    this.#root = join(dataDirectory, "recovery");
    this.#limits = { ...defaults, ...options.limits };
    this.#now = options.now ?? (() => new Date());
  }

  async prepare(
    actionId: string,
    workspaceRoot: string,
    changes: readonly FileChange[],
    conversationId: string,
  ): Promise<RecoveryPreparation> {
    await this.cleanup();
    const folder = join(this.#root, key(actionId));
    this.#preparing.add(folder);
    try {
      return await this.#capture(
        actionId,
        conversationId,
        workspaceRoot,
        changes,
        folder,
      );
    } finally {
      this.#preparing.delete(folder);
    }
  }

  async #capture(
    actionId: string,
    conversationId: string,
    workspaceRoot: string,
    changes: readonly FileChange[],
    folder: string,
  ): Promise<RecoveryPreparation> {
    const root = await realpath(workspaceRoot);
    await rm(folder, { recursive: true, force: true });
    await mkdir(folder, { recursive: true });
    const files: CapturedFile[] = [];
    let capturedBytes = (await this.#manifests()).reduce(
      (total, item) =>
        total +
        item.manifest.files.reduce(
          (sum, file) =>
            sum + (file.status === "protected" ? (file.bytes ?? 0) : 0),
          0,
        ),
      0,
    );

    for (const [index, change] of changes.entries()) {
      const normalized = change.path.replaceAll("\\", "/");
      let absolute: string | undefined;
      let failure: string | undefined;
      try {
        absolute = await safeAbsolute(root, normalized);
      } catch (error) {
        failure = unreadable(normalized, error);
      }
      if (!absolute) {
        files.push({
          path: normalized,
          status: "unprotected",
          before: "absent",
          reason:
            failure ??
            "The path could not be proven to stay inside the workspace.",
        });
        continue;
      }
      const entry = await kind(absolute);
      if (entry === "other") {
        files.push({
          path: normalized,
          status: "unprotected",
          before: "absent",
          reason: "The path is not an ordinary file.",
        });
        continue;
      }
      if (entry === "absent") {
        files.push({ path: normalized, status: "protected", before: "absent" });
        continue;
      }
      const info = await stat(absolute);
      if (
        info.size > this.#limits.fileBytes ||
        capturedBytes + info.size > this.#limits.totalBytes
      ) {
        files.push({
          path: normalized,
          status: "unprotected",
          before: "file",
          reason:
            info.size > this.#limits.fileBytes
              ? "The existing file exceeds the 10 MiB recovery limit."
              : "The recovery storage limit cannot admit this file.",
        });
        continue;
      }
      const bytes = await readFile(absolute);
      const backup = `${index}.bin`;
      await writeFile(join(folder, backup), bytes);
      capturedBytes += bytes.byteLength;
      files.push({
        path: normalized,
        status: "protected",
        before: "file",
        beforeDigest: digest(bytes),
        backup,
        bytes: bytes.byteLength,
      });
    }

    const manifest: Manifest = {
      version: 1,
      actionId,
      conversationId,
      workspaceRoot: root,
      createdAt: this.#now().toISOString(),
      phase: "prepared",
      files,
    };
    await this.#writeManifest(folder, manifest);
    this.#prepared.set(actionId, manifest);
    return {
      actionId,
      files: files.map(({ path, status, reason }) => ({
        path,
        status,
        ...(reason ? { reason } : {}),
      })),
    };
  }

  async validate(actionId: string) {
    const manifest = await this.#manifest(actionId);
    if (!manifest || manifest.phase !== "prepared")
      return {
        ok: false as const,
        reason: "The recovery capture is no longer available.",
      };
    for (const file of manifest.files) {
      if (file.status !== "protected") continue;
      let current: Awaited<ReturnType<typeof currentDigest>>;
      try {
        const absolute = await safeAbsolute(manifest.workspaceRoot, file.path);
        if (!absolute)
          return {
            ok: false as const,
            reason: `${file.path} is no longer safely inside the workspace.`,
          };
        current = await currentDigest(absolute);
      } catch (error) {
        return { ok: false as const, reason: unreadable(file.path, error) };
      }
      const expected = file.before === "absent" ? "absent" : file.beforeDigest;
      if (current !== expected)
        return {
          ok: false as const,
          reason: `${file.path} changed after this change was proposed.`,
        };
    }
    return { ok: true as const };
  }

  async commit(actionId: string): Promise<void> {
    const manifest = await this.#manifest(actionId);
    if (!manifest || manifest.phase !== "prepared") return;
    const files: CapturedFile[] = [];
    for (const file of manifest.files) {
      if (file.status !== "protected") {
        files.push(file);
        continue;
      }
      const absolute = await safeAbsolute(
        manifest.workspaceRoot,
        file.path,
      ).catch(() => undefined);
      const current = absolute ? await currentDigest(absolute) : "other";
      files.push({
        ...file,
        after: current === "absent" ? "absent" : "file",
        ...(current !== "absent" && current !== "other"
          ? { afterDigest: current }
          : {}),
        ...(current === "other"
          ? {
              status: "unprotected" as const,
              reason: "The result is not an ordinary workspace file.",
            }
          : {}),
      });
    }
    const committed: Manifest = { ...manifest, phase: "committed", files };
    await this.#writeManifest(join(this.#root, key(actionId)), committed);
    this.#prepared.delete(actionId);
    await this.cleanup();
  }

  async discard(actionId: string): Promise<void> {
    this.#prepared.delete(actionId);
    await rm(join(this.#root, key(actionId)), { recursive: true, force: true });
  }

  async review(
    reviewId: string,
    workspaceRoot: string,
    actions: readonly TaskAction[],
  ): Promise<RecoveryReview> {
    const root = await realpath(workspaceRoot);
    const grouped = new Map<string, CapturedFile[]>();
    const unprotected = new Map<string, string>();
    for (const action of actions) {
      const manifest = await this.#manifest(action.id);
      for (const change of action.changes ?? []) {
        const path = change.path.replaceAll("\\", "/");
        const captured =
          manifest?.phase === "committed" && manifest.workspaceRoot === root
            ? manifest.files.find((file) => file.path === path)
            : undefined;
        if (!captured || captured.status !== "protected" || !captured.after) {
          unprotected.set(
            path,
            captured?.reason ??
              "No copy of this file is kept: none was taken, or it was removed by the storage limits.",
          );
          continue;
        }
        grouped.set(path, [...(grouped.get(path) ?? []), captured]);
      }
    }

    const files: RewindFileEffect[] = [];
    const targets: RestoreTarget[] = [];
    for (const [path, reason] of unprotected) {
      files.push({ path, action: "unknown", status: "unprotected", reason });
    }
    for (const [path, versions] of grouped) {
      if (unprotected.has(path)) continue;
      const first = versions[0]!;
      const last = versions.at(-1)!;
      const absolute = await safeAbsolute(root, path).catch(() => undefined);
      const expected = last.after === "absent" ? "absent" : last.afterDigest;
      const restored =
        first.before === "absent" ? "absent" : first.beforeDigest;
      const current = absolute ? await currentDigest(absolute) : "other";
      const action = first.before === "absent" ? "remove" : "restore";
      // Each change must start from what the one before it left: a file
      // edited in between holds work that is not the turn's to discard.
      const chained = versions.every((version, index) => {
        if (index === 0) return true;
        const previous = versions[index - 1]!;
        const left =
          previous.after === "absent" ? "absent" : previous.afterDigest;
        const found =
          version.before === "absent" ? "absent" : version.beforeDigest;
        return left !== undefined && left === found;
      });
      if (!chained) {
        files.push({
          path,
          action,
          status: "conflict",
          reason:
            "The file was changed between two of the changes being undone, so it was left as it is.",
        });
        continue;
      }
      // Already as it was before the changes, as after an undo that put it
      // back while another file could not be: putting it back is a no-op.
      const alreadyBack = current === restored;
      if (
        !absolute ||
        !expected ||
        !restored ||
        (current !== expected && !alreadyBack)
      ) {
        files.push({
          path,
          action,
          status: "conflict",
          reason:
            "The current file no longer matches the result recorded for the discarded work.",
        });
        continue;
      }
      files.push({ path, action, status: "recoverable" });
      targets.push({
        path,
        absolute,
        expected,
        restored,
        action,
        ...(first.backup
          ? {
              backup: join(
                this.#root,
                key(
                  actions.find((item) =>
                    item.changes?.some(
                      (change) => change.path.replaceAll("\\", "/") === path,
                    ),
                  )!.id,
                ),
                first.backup,
              ),
            }
          : {}),
      });
    }
    return { id: reviewId, workspaceRoot: root, files, targets };
  }

  async restore(review: RecoveryReview): Promise<RewindCommitResult> {
    const results: RewindCommitResult["files"][number][] = [];
    for (const file of review.files) {
      if (file.status !== "recoverable") {
        results.push({
          path: file.path,
          status: file.status,
          ...(file.reason ? { reason: file.reason } : {}),
        });
        continue;
      }
      const target = review.targets.find((item) => item.path === file.path);
      // A review can come back from the rewind journal on disk, so where it
      // writes and what it copies from are checked again here.
      if (target && !(await this.#ownTarget(review.workspaceRoot, target))) {
        results.push({
          path: file.path,
          status: "unprotected",
          reason:
            "The restore named a file outside its folder or a copy Zhiyin did not keep, so the file was left as it is.",
        });
        continue;
      }
      const current = target ? await currentDigest(target.absolute) : "other";
      if (target && current === target.restored) {
        results.push({
          path: file.path,
          status: target.action === "remove" ? "removed" : "restored",
        });
        continue;
      }
      if (!target || current !== target.expected) {
        results.push({
          path: file.path,
          status: "conflict",
          reason: "The file changed while the rewind was being reviewed.",
        });
        continue;
      }
      try {
        await this.#restoreExclusively(target);
        results.push({
          path: file.path,
          status: target.action === "remove" ? "removed" : "restored",
        });
      } catch (error) {
        results.push({
          path: file.path,
          status: "unprotected",
          reason:
            error instanceof DamagedCopyError
              ? "The copy kept before the change is damaged, so the current file was left as it is."
              : "The retained bytes could not be applied; the current file was left in place.",
        });
      }
    }
    return { files: results };
  }

  async versions(
    workspaceRoot: string,
    actions: readonly TaskAction[],
    path: string,
  ): Promise<FileVersions> {
    const named = path.replaceAll("\\", "/");
    const review = await this.review("versions", workspaceRoot, actions);
    const file = review.files.find((item) => item.path === named);
    const target = review.targets.find((item) => item.path === named);
    const changedSince = {
      ok: false,
      reason: `${named} has changed since, so the change can no longer be shown.`,
    } as const;
    if (file?.status === "conflict") return changedSince;
    if (!target)
      return {
        ok: false,
        reason: file?.reason ?? "No copy was kept before the change.",
      };
    const after = await readFile(target.absolute).catch(() => undefined);
    if (!after || digest(after) !== target.expected) return changedSince;
    if (target.action === "remove")
      return { ok: true, after: new Uint8Array(after) };
    const before = target.backup
      ? await readFile(target.backup).catch(() => undefined)
      : undefined;
    if (!before || digest(before) !== target.restored)
      return { ok: false, reason: "The copy kept before the change is gone." };
    return {
      ok: true,
      before: new Uint8Array(before),
      after: new Uint8Array(after),
    };
  }

  /**
   * Applies the limits. An action past the age limit loses everything kept
   * for it, and one whose copies were all evicted loses its folder; a folder a
   * capture left without its manifest goes too. An action still being prepared
   * is never touched.
   */
  async cleanup(): Promise<void> {
    const found = await this.#folders();
    const cutoff = this.#now().getTime() - this.#limits.maximumAgeMs;
    const removed = new Set<string>();
    for (const item of found) {
      if (this.#inUse(item.folder)) continue;
      if (item.manifest && Date.parse(item.manifest.createdAt) >= cutoff)
        continue;
      // Looked for again: it may have been written since the first read.
      if (
        !item.manifest &&
        (await kind(join(item.folder, "manifest.json"))) !== "absent"
      )
        continue;
      await rm(item.folder, { recursive: true, force: true });
      removed.add(item.folder);
    }
    const loaded = found.filter(
      (item): item is KeptAction =>
        item.manifest !== undefined && !removed.has(item.folder),
    );
    const expired = new Set<string>();
    for (const item of loaded) {
      if (Date.parse(item.manifest.createdAt) >= cutoff) continue;
      for (const file of item.manifest.files) {
        if (file.status === "protected" && file.backup)
          expired.add(`${item.folder}:${file.backup}`);
      }
    }

    const versions = new Map<
      string,
      {
        readonly folder: string;
        readonly backup: string;
        readonly createdAt: string;
      }[]
    >();
    for (const item of loaded) {
      if (item.manifest.phase !== "committed") continue;
      for (const file of item.manifest.files) {
        if (file.status !== "protected" || !file.backup) continue;
        const identity = `${item.manifest.workspaceRoot}\u0000${file.path}`;
        versions.set(identity, [
          ...(versions.get(identity) ?? []),
          {
            folder: item.folder,
            backup: file.backup,
            createdAt: item.manifest.createdAt,
          },
        ]);
      }
    }
    for (const entries of versions.values()) {
      entries.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
      for (const entry of entries.slice(this.#limits.versionsPerPath))
        expired.add(`${entry.folder}:${entry.backup}`);
    }

    const retained = loaded
      .flatMap((item) =>
        item.manifest.files.flatMap((file) =>
          file.status === "protected" &&
          file.backup &&
          !expired.has(`${item.folder}:${file.backup}`)
            ? [
                {
                  folder: item.folder,
                  backup: file.backup,
                  bytes: file.bytes ?? 0,
                  createdAt: item.manifest.createdAt,
                },
              ]
            : [],
        ),
      )
      .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
    let total = retained.reduce((sum, entry) => sum + entry.bytes, 0);
    for (const entry of retained) {
      if (total <= this.#limits.totalBytes) break;
      expired.add(`${entry.folder}:${entry.backup}`);
      total -= entry.bytes;
    }

    for (const item of loaded) {
      let changed = false;
      const files = await Promise.all(
        item.manifest.files.map(async (file) => {
          if (!file.backup || !expired.has(`${item.folder}:${file.backup}`))
            return file;
          changed = true;
          await rm(join(item.folder, file.backup), { force: true });
          return {
            path: file.path,
            status: "unprotected" as const,
            reason:
              "The retained recovery copy expired or was evicted by storage limits.",
            before: file.before,
            ...(file.beforeDigest ? { beforeDigest: file.beforeDigest } : {}),
            ...(file.after ? { after: file.after } : {}),
            ...(file.afterDigest ? { afterDigest: file.afterDigest } : {}),
          };
        }),
      );
      if (!changed) continue;
      if (
        !this.#inUse(item.folder) &&
        files.every((file) => file.status !== "protected")
      )
        await rm(item.folder, { recursive: true, force: true });
      else await this.#writeManifest(item.folder, { ...item.manifest, files });
    }
  }

  async forgetConversation(conversationId: string): Promise<void> {
    for (const item of await this.#manifests()) {
      if (item.manifest.conversationId !== conversationId) continue;
      this.#prepared.delete(item.manifest.actionId);
      await rm(item.folder, { recursive: true, force: true });
    }
  }

  /** Whether a target writes inside its folder and copies from this store. */
  async #ownTarget(
    workspaceRoot: string,
    target: RestoreTarget,
  ): Promise<boolean> {
    const absolute = await safeAbsolute(workspaceRoot, target.path).catch(
      () => undefined,
    );
    return (
      absolute === target.absolute &&
      (target.backup === undefined || staysInside(this.#root, target.backup))
    );
  }

  /** Whether an action in this folder is being prepared or awaits its run. */
  #inUse(folder: string): boolean {
    return (
      this.#preparing.has(folder) ||
      [...this.#prepared.keys()].some(
        (actionId) => join(this.#root, key(actionId)) === folder,
      )
    );
  }

  async #manifest(actionId: string): Promise<Manifest | undefined> {
    const pending = this.#prepared.get(actionId);
    if (pending) return pending;
    try {
      return JSON.parse(
        await readFile(
          join(this.#root, key(actionId), "manifest.json"),
          "utf8",
        ),
      ) as Manifest;
    } catch {
      return undefined;
    }
  }

  async #restoreExclusively(target: RestoreTarget): Promise<void> {
    if (target.expected === "absent") {
      if (target.action !== "restore" || !target.backup)
        throw new Error("The retained bytes are unavailable.");
      return recreateExclusively({
        absolute: target.absolute,
        backup: target.backup,
        retained: target.restored,
      });
    }
    await restoreExclusively({
      absolute: target.absolute,
      expected: target.expected,
      action: target.action,
      ...(target.backup
        ? { backup: target.backup, retained: target.restored }
        : {}),
    });
  }

  async #manifests(): Promise<KeptAction[]> {
    return (await this.#folders()).filter(
      (item): item is KeptAction => item.manifest !== undefined,
    );
  }

  /** Each action's folder, with its manifest when one can be read. */
  async #folders(): Promise<
    { readonly folder: string; readonly manifest?: Manifest }[]
  > {
    let names: string[];
    try {
      names = await readdir(this.#root);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    return Promise.all(
      names.map(async (name) => {
        const folder = join(this.#root, name);
        try {
          return {
            folder,
            manifest: JSON.parse(
              await readFile(join(folder, "manifest.json"), "utf8"),
            ) as Manifest,
          };
        } catch {
          return { folder };
        }
      }),
    );
  }

  async #writeManifest(folder: string, manifest: Manifest): Promise<void> {
    await mkdir(folder, { recursive: true });
    const temporary = join(folder, `manifest.${randomUUID()}.tmp`);
    await writeFile(temporary, JSON.stringify(manifest), "utf8");
    await rename(temporary, join(folder, "manifest.json"));
  }
}
