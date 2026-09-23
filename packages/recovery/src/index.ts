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
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import type {
  FileChange,
  RewindCommitResult,
  RewindFileEffect,
  TaskAction,
} from "@zhiyin/contract";
import { restoreExclusively } from "./exclusive-restore.js";

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
  readonly workspaceRoot: string;
  readonly createdAt: string;
  readonly phase: "prepared" | "committed";
  readonly files: readonly CapturedFile[];
};

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

export type RecoveryStorage = {
  readonly usedBytes: number;
  readonly retainedFiles: number;
  readonly excludedFiles: number;
  readonly limits: {
    readonly totalBytes: number;
    readonly fileBytes: number;
    readonly versionsPerPath: number;
    readonly maximumAgeDays: number;
  };
};

export interface Recovery {
  prepare(
    actionId: string,
    workspaceRoot: string,
    changes: readonly FileChange[],
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
  storage(): Promise<RecoveryStorage>;
  clear(): Promise<void>;
  cleanup(): Promise<void>;
}

function digest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function key(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function inside(root: string, target: string): boolean {
  const path = relative(root, target);
  return (
    path === "" ||
    (!isAbsolute(path) &&
      path !== ".." &&
      !path.startsWith(`..\\`) &&
      !path.startsWith("../"))
  );
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

async function safeAbsolute(
  root: string,
  path: string,
): Promise<string | undefined> {
  const target = resolve(root, path);
  if (!inside(root, target)) return;
  const entry = await kind(target);
  const resolved =
    entry === "absent"
      ? await nearestExistingParent(target)
      : await realpath(target);
  return inside(root, resolved) ? target : undefined;
}

export class FileRecovery implements Recovery {
  readonly #root: string;
  readonly #limits: RecoveryLimits;
  readonly #now: () => Date;
  readonly #prepared = new Map<string, Manifest>();

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
  ): Promise<RecoveryPreparation> {
    await this.cleanup();
    const root = await realpath(workspaceRoot);
    const folder = join(this.#root, key(actionId));
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
      const absolute = await safeAbsolute(root, normalized).catch(
        () => undefined,
      );
      if (!absolute) {
        files.push({
          path: normalized,
          status: "unprotected",
          before: "absent",
          reason: "The path could not be proven to stay inside the workspace.",
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
      const absolute = await safeAbsolute(
        manifest.workspaceRoot,
        file.path,
      ).catch(() => undefined);
      if (!absolute)
        return {
          ok: false as const,
          reason: `${file.path} is no longer safely inside the workspace.`,
        };
      const current = await currentDigest(absolute);
      const expected = file.before === "absent" ? "absent" : file.beforeDigest;
      if (current !== expected)
        return {
          ok: false as const,
          reason: `${file.path} changed after recovery was prepared.`,
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
              "No completed recovery capture exists for this action.",
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
      if (!absolute || !expected || !restored || current !== expected) {
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
      } catch {
        results.push({
          path: file.path,
          status: "unprotected",
          reason:
            "The retained bytes could not be applied; the current file was left in place.",
        });
      }
    }
    return { files: results };
  }

  async storage(): Promise<RecoveryStorage> {
    const manifests = await this.#manifests();
    const files = manifests.flatMap((item) => item.manifest.files);
    const retained = files.filter(
      (file) => file.status === "protected" && Boolean(file.backup),
    );
    return {
      usedBytes: retained.reduce((sum, file) => sum + (file.bytes ?? 0), 0),
      retainedFiles: retained.length,
      excludedFiles: files.length - retained.length,
      limits: {
        totalBytes: this.#limits.totalBytes,
        fileBytes: this.#limits.fileBytes,
        versionsPerPath: this.#limits.versionsPerPath,
        maximumAgeDays: Math.floor(
          this.#limits.maximumAgeMs / (24 * 60 * 60 * 1000),
        ),
      },
    };
  }

  async clear(): Promise<void> {
    this.#prepared.clear();
    await rm(this.#root, { recursive: true, force: true });
  }

  async cleanup(): Promise<void> {
    const loaded = await this.#manifests();
    const cutoff = this.#now().getTime() - this.#limits.maximumAgeMs;
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
      if (changed)
        await this.#writeManifest(item.folder, { ...item.manifest, files });
    }
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
    if (target.expected === "absent")
      throw new Error("There is no current file identity to lock.");
    await restoreExclusively({
      absolute: target.absolute,
      expected: target.expected,
      action: target.action,
      ...(target.backup ? { backup: target.backup } : {}),
    });
  }

  async #manifests(): Promise<
    { readonly folder: string; readonly manifest: Manifest }[]
  > {
    let names: string[];
    try {
      names = await readdir(this.#root);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    const manifests = await Promise.all(
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
          return undefined;
        }
      }),
    );
    return manifests.filter(
      (item): item is { folder: string; manifest: Manifest } =>
        item !== undefined,
    );
  }

  async #writeManifest(folder: string, manifest: Manifest): Promise<void> {
    await mkdir(folder, { recursive: true });
    const temporary = join(folder, `manifest.${randomUUID()}.tmp`);
    await writeFile(temporary, JSON.stringify(manifest), "utf8");
    await rename(temporary, join(folder, "manifest.json"));
  }
}
