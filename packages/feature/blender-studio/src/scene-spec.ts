/**
 * A scene measured against its spec: after every call that changes the
 * scene, and when it is opened or described, Blender measures each
 * requirement on the meshes in the same command, and the answer says how
 * many hold and only what does not, with each margin beside the last
 * change's. The person sees every verdict on the checks card. The verdicts
 * are kept in the conversation's own folder, so condensing loses none, and
 * the first time every size holds the card shows the block-out, once.
 */

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ActionDetail } from "@zhiyin/contract";
import { replaceFile } from "@zhiyin/files";
import { Serial } from "@zhiyin/one-at-a-time";
import {
  checkedIn,
  keptOf,
  lastOf,
  verdictDetail,
  verdictLines,
  type Checked,
  type Last,
  type Requirement,
  type Says,
  type Verdicts,
} from "@zhiyin/studio-requirements";
import type { SceneCommand } from "./scene-session.js";
import { measuredHere, specFor } from "./spec-file.js";

/** The commands after which the scene is measured against its spec. */
const measuring: ReadonlySet<SceneCommand> = new Set([
  "open",
  "describe",
  "add",
  "edit",
  "shape",
  "material",
  "camera",
  "lighting",
  "script",
  "animate",
  "settle",
  "scatter",
  "unwrap",
  "bake",
  "decal",
  "rig",
  "simulate",
]);
/** Those that change the scene, after which the block-out may be shown. */
const changing: ReadonlySet<SceneCommand> = new Set([
  "add",
  "edit",
  "shape",
  "material",
  "camera",
  "lighting",
  "script",
  "animate",
  "settle",
  "scatter",
  "unwrap",
  "bake",
  "decal",
  "rig",
  "simulate",
]);

/** What Blender is sent to measure: the requirements it measures, the file it writes their verdicts in, and where it draws the block-out, if it may. */
export type SpecSent = {
  readonly requirements: readonly Requirement[];
  readonly out: string;
  readonly blockout?: string;
};

/** One call's spec: the file read, or why it could not be, and what Blender was sent. */
export type SpecRun =
  | {
      readonly ok: true;
      readonly key: string;
      readonly file: string;
      readonly object?: string;
      readonly requirements: readonly Requirement[];
      readonly sent: SpecSent;
      /** The scene, workspace-relative, and whether the command changes it. */
      readonly scene: string;
      readonly changing: boolean;
    }
  | { readonly ok: false; readonly file: string; readonly reason: string };

/** What a call's answer and card say of the spec, and the block-out picture to show. */
export type SpecSaid = {
  readonly lines: readonly string[];
  readonly detail?: ActionDetail;
  readonly picture?: string;
};

/**
 * What is kept of one spec on one scene: its last verdicts, whether the
 * block-out was shown, its requirements as first and last read, and when a
 * change was last measured against it.
 */
type Kept = {
  readonly kept?: unknown;
  readonly offered?: boolean;
  readonly first?: readonly Requirement[];
  readonly current?: readonly Requirement[];
  readonly changedAt?: string;
  readonly file?: string;
  readonly scene?: string;
  readonly object?: string;
};

/** A spec whose scene was changed: what a reviewer of it is told. */
export type ChangedSpec = {
  readonly file: string;
  readonly scene: string;
  readonly object?: string;
  readonly first: readonly Requirement[];
  readonly current: readonly Requirement[];
  readonly last: Readonly<Record<string, Last>>;
};

const isRecord = (value: unknown): value is { [key: string]: unknown } =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** A kind's name in words, after "a" or "an". */
const aKind = (kind: string) =>
  `${/^[aeiou]/.test(kind) ? "an" : "a"} ${kind} requirement`;

/** Each spec's last verdicts in this conversation, by its file and scene. */
export class SceneSpecs {
  readonly #path: string;
  readonly #directory: string;
  readonly #now: () => Date;
  readonly #queue = new Serial();

  /** Keeps its record in the conversation's own folder, `directory`. */
  constructor(directory: string, now: () => Date = () => new Date()) {
    this.#directory = directory;
    this.#path = join(directory, "spec.json");
    this.#now = now;
  }

  /** Each spec whose scene a change was measured on after `since`. */
  async changedSince(since: Date): Promise<readonly ChangedSpec[]> {
    return Object.values(await this.#read()).flatMap((found) => {
      if (!isRecord(found)) return [];
      const record = found as Kept;
      const at = record.changedAt ? Date.parse(record.changedAt) : NaN;
      if (
        !(at > since.getTime()) ||
        !record.file ||
        !record.scene ||
        !Array.isArray(record.first) ||
        !Array.isArray(record.current)
      )
        return [];
      return [
        {
          file: record.file,
          scene: record.scene,
          ...(record.object ? { object: record.object } : {}),
          first: record.first,
          current: record.current,
          last: lastOf(record.kept),
        },
      ];
    });
  }

  async #read(): Promise<{ [key: string]: unknown }> {
    try {
      const value: unknown = JSON.parse(await readFile(this.#path, "utf8"));
      return isRecord(value) ? value : {};
    } catch {
      return {};
    }
  }

  async #record(key: string): Promise<Kept> {
    const found = (await this.#read())[key];
    return isRecord(found) ? found : {};
  }

  async #keep(key: string, record: Kept): Promise<void> {
    await this.#queue.run(async () => {
      const all = await this.#read();
      all[key] = record;
      await mkdir(dirname(this.#path), { recursive: true });
      await replaceFile(this.#path, JSON.stringify(all));
    });
  }

  /**
   * The spec a command on `scene` is measured against, if it is one that
   * measures and the workspace has a spec: what Blender is sent, or why the
   * file cannot be read.
   */
  async before(
    command: SceneCommand,
    root: string,
    scene: string | undefined,
  ): Promise<SpecRun | undefined> {
    if (!measuring.has(command) || !scene) return undefined;
    const found = await specFor(root, scene);
    if (!found) return undefined;
    if (!found.ok) return found;
    const key = JSON.stringify([found.file.toLowerCase(), scene.toLowerCase()]);
    const offered = (await this.#record(key)).offered === true;
    const out = join(this.#directory, "spec", `${randomUUID()}.json`);
    await mkdir(dirname(out), { recursive: true });
    const blockout =
      changing.has(command) && !offered
        ? join(this.#directory, "pictures", `${randomUUID()}.jpg`)
        : undefined;
    if (blockout) await mkdir(dirname(blockout), { recursive: true });
    return {
      ok: true,
      key,
      file: found.file,
      ...(found.object ? { object: found.object } : {}),
      requirements: found.requirements,
      scene,
      changing: changing.has(command),
      sent: {
        requirements: found.requirements.filter(measuredHere),
        out,
        ...(blockout ? { blockout } : {}),
      },
    };
  }

  /** What Blender sends the spec, if anything: nothing when the file cannot be read. */
  sent(run: SpecRun | undefined): SpecSent | undefined {
    return run?.ok ? run.sent : undefined;
  }

  /** Removes what a run that did not finish left. */
  async discard(run: SpecRun | undefined): Promise<void> {
    if (!run?.ok) return;
    await rm(run.sent.out, { force: true });
    if (run.sent.blockout) await rm(run.sent.blockout, { force: true });
  }

  /**
   * The spec's verdicts after the command, each margin beside the last
   * check of the same spec and scene, which they then replace.
   */
  async after(run: SpecRun | undefined): Promise<SpecSaid> {
    if (!run) return { lines: [] };
    if (!run.ok)
      return {
        lines: [
          `No spec check was made: ${run.reason} Fix the file, and the next change checks it.`,
        ],
        detail: {
          kind: "checks",
          label: `Spec in ${run.file}`,
          items: [{ label: run.file, holds: null, note: run.reason }],
        },
      };
    let written: unknown;
    try {
      written = JSON.parse(await readFile(run.sent.out, "utf8"));
    } catch {
      written = undefined;
    } finally {
      await rm(run.sent.out, { force: true });
    }
    const pictured =
      run.sent.blockout !== undefined &&
      (await stat(run.sent.blockout).then(
        (found) => found.size > 0,
        () => false,
      ));
    if (!isRecord(written) || !Array.isArray(written["checked"])) {
      if (run.sent.blockout) await rm(run.sent.blockout, { force: true });
      const why =
        isRecord(written) && typeof written["error"] === "string"
          ? written["error"]
          : "Blender gave no measures";
      return {
        lines: [`The spec in ${run.file} could not be measured: ${why}.`],
      };
    }
    const measured = new Map(
      (checkedIn(written["checked"]).requirements ?? []).map((one) => [
        one.id,
        one,
      ]),
    );
    const checked: Checked[] = run.requirements.map(
      (one) =>
        measured.get(one.id) ??
        (measuredHere(one)
          ? { id: one.id, holds: null, why: "Blender did not measure it" }
          : {
              id: one.id,
              holds: null,
              why: `${aKind(one.check)} is measured in the CAD studio`,
            }),
    );
    const says: Says = Object.fromEntries(
      run.requirements.map((one) => [
        one.id,
        typeof one["says"] === "string" ? one["says"] : undefined,
      ]),
    );
    const verdicts: Verdicts = {
      file: run.file,
      title: run.object ? `Spec for ${run.object}` : `Spec in ${run.file}`,
      since: "the last change",
      holding: "counted",
    };
    const record = await this.#record(run.key);
    const last = lastOf(record.kept);
    const lines = verdictLines(verdicts, checked, says, last);
    const detail = verdictDetail(
      { ...verdicts, holding: "listed" },
      checked,
      says,
      last,
    );
    const changedAt = run.changing
      ? this.#now().toISOString()
      : record.changedAt;
    await this.#keep(run.key, {
      kept: keptOf(checked, says),
      ...(record.offered || pictured ? { offered: true } : {}),
      first: record.first ?? run.requirements,
      current: run.requirements,
      ...(changedAt ? { changedAt } : {}),
      file: run.file,
      scene: run.scene,
      ...(run.object ? { object: run.object } : {}),
    });
    if (!pictured) return { lines, ...(detail ? { detail } : {}) };
    const offer =
      "Every size in the spec holds: below is the block-out, while changes are still cheap. Step in now to change its proportions; the work goes on unless you do.";
    return {
      lines: [
        ...lines,
        "Every size in the spec holds, so the person is shown this block-out and may step in to change its proportions; carry on unless they do.",
      ],
      ...(detail?.kind === "checks"
        ? {
            detail: {
              ...detail,
              note: detail.note ? `${detail.note} ${offer}` : offer,
            },
          }
        : {}),
      picture: run.sent.blockout as string,
    };
  }
}
