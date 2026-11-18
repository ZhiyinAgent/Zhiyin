/**
 * What the CAD studio hands the reviewer of a design a conversation built:
 * its requirements as first written there, with what was removed or changed
 * since and the latest measures, the last build's answer as the model read
 * it, and the part drawn from four sides. Kept in the conversation's own
 * folder each time a design is built against requirements; a design built
 * against several requirements files is handed over as one. Of the scripts
 * built against one file, each is handed over for the requirements whose
 * latest measure is its own, and one holding none is not handed over.
 */

import { createHash } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type {
  ProducedImage,
  ReviewMaterial,
  StudioReviews,
} from "@zhiyin/contract";
import { replaceFile } from "@zhiyin/files";
import {
  lastOf,
  reviewBrief,
  type Last,
  type Requirement,
} from "@zhiyin/studio-requirements";
import { JsonRecord } from "./json-record.js";
import { asObject, isRecord } from "./json-values.js";

/** The reviewer the CAD studio's plugin defines. */
export const partReviewer = "3d-rendering/part-reviewer";

/** One design's last build checked against requirements. */
type Reviewed = {
  readonly design: string;
  readonly file: string;
  readonly first: readonly Requirement[];
  readonly current: readonly Requirement[];
  readonly last: Readonly<Record<string, Last>>;
  readonly builtAt: string;
  /** When the design was first built against the file. */
  readonly firstAt?: string;
  /** This record's place among every build kept, the latest highest. */
  readonly order?: number;
  readonly answer: string;
  /** The four-side drawing, kept beside the record, if the build drew one. */
  readonly picture?: string;
};

/** The requirements of one file a design is reviewed for, with their latest measures. */
type Held = {
  readonly first: readonly Requirement[];
  readonly current: readonly Requirement[];
  readonly last: Readonly<Record<string, Last>>;
};

/** Earlier builds first. */
const later = (a: Reviewed, b: Reviewed) =>
  (a.order ?? 0) - (b.order ?? 0) ||
  Date.parse(a.builtAt) - Date.parse(b.builtAt);

const measured = (last: Last | undefined) =>
  last !== undefined && last.holds !== null;

/**
 * Of the designs built against one requirements file, each one's share: the
 * requirements whose latest measure is its build's. One no build measured
 * goes with the design that measured most of them, the latest of equals, and
 * a design holding none is left out, as the model's own check.
 */
function heldIn(builds: readonly Reviewed[]): Map<Reviewed, Held> {
  const ordered = [...builds].sort(later);
  const lasts = new Map(ordered.map((one) => [one, lastOf(one.last)]));
  const firstBuilt = [...ordered].sort(
    (a, b) =>
      Date.parse(a.firstAt ?? a.builtAt) - Date.parse(b.firstAt ?? b.builtAt),
  )[0]!;
  const first = firstBuilt.first;
  const current = ordered.at(-1)!.current;
  const most = ordered.reduce((best, one) =>
    Object.values(lasts.get(one)!).filter(measured).length >=
    Object.values(lasts.get(best)!).filter(measured).length
      ? one
      : best,
  );
  const holder = new Map<string, Reviewed>();
  for (const { id } of [...first, ...current]) {
    if (holder.has(id)) continue;
    const latest = ordered.findLast((one) => measured(lasts.get(one)![id]));
    holder.set(id, latest ?? most);
  }
  const shares = new Map<Reviewed, Held>();
  for (const one of ordered) {
    const mine = (requirement: Requirement) =>
      holder.get(requirement.id) === one;
    if (!first.some(mine) && !current.some(mine)) continue;
    const last: Record<string, Last> = {};
    for (const [id, by] of holder) {
      const measure = lasts.get(by)![id];
      if (by === one && measure) last[id] = measure;
    }
    shares.set(one, {
      first: first.filter(mine),
      current: current.filter(mine),
      last,
    });
  }
  return shares;
}

export class PartReviews implements StudioReviews {
  readonly reviewer = partReviewer;
  readonly #directory: (conversationId: string) => string;
  /** Each conversation folder's record, one for each so its changes wait their turn. */
  readonly #records = new Map<string, JsonRecord<Record<string, unknown>>>();

  /** Keeps each conversation's record in its own folder, `directory`. */
  constructor(directory: (conversationId: string) => string) {
    this.#directory = directory;
  }

  #record(folder: string): JsonRecord<Record<string, unknown>> {
    const path = join(folder, "reviews.json");
    let record = this.#records.get(path);
    if (!record) {
      record = new JsonRecord(path, asObject, () => ({}));
      this.#records.set(path, record);
    }
    return record;
  }

  /**
   * A build of `design` checked against the requirements in `file`, as
   * listed now, with the verdicts it gave and its answer and drawing.
   */
  async built(
    folder: string,
    build: {
      readonly design: string;
      readonly file: string;
      readonly requirements: readonly Requirement[];
      readonly last: Readonly<Record<string, Last>>;
      readonly answer: string;
      readonly picture?: Buffer;
      readonly at: Date;
    },
  ): Promise<void> {
    return this.#record(folder).change(async (all) => {
      const key = JSON.stringify([build.file.toLowerCase(), build.design]);
      const before = all[key];
      const first =
        isRecord(before) && Array.isArray(before["first"])
          ? (before["first"] as Requirement[])
          : build.requirements;
      const picture = build.picture
        ? join(
            folder,
            "reviews",
            `${createHash("sha256").update(key).digest("hex").slice(0, 32)}.png`,
          )
        : undefined;
      if (picture && build.picture) {
        await mkdir(dirname(picture), { recursive: true });
        await replaceFile(picture, build.picture);
      }
      const order = Math.max(
        0,
        ...Object.values(all).map((one) =>
          isRecord(one) && typeof one["order"] === "number" ? one["order"] : 0,
        ),
      );
      const record: Reviewed = {
        design: build.design,
        file: build.file,
        first,
        current: build.requirements,
        last: build.last,
        builtAt: build.at.toISOString(),
        firstAt:
          isRecord(before) && typeof before["firstAt"] === "string"
            ? before["firstAt"]
            : build.at.toISOString(),
        order: order + 1,
        answer: build.answer,
        ...(picture ? { picture } : {}),
      };
      all[key] = record;
    });
  }

  async hasChangedSince(conversationId: string, since: Date): Promise<boolean> {
    return (await this.#changed(conversationId, since)).designs.size > 0;
  }

  async changedSince(
    conversationId: string,
    since: Date,
    pictures: boolean,
  ): Promise<readonly ReviewMaterial[]> {
    const { designs, held } = await this.#changed(conversationId, since);
    const material: ReviewMaterial[] = [];
    for (const builds of designs.values()) {
      builds.sort(later);
      const latest = builds.at(-1)!;
      const drawn: ProducedImage[] =
        pictures && latest.picture
          ? await readFile(latest.picture).then(
              (data) => [
                { mediaType: "image/png", data: data.toString("base64") },
              ],
              () => [],
            )
          : [];
      const named = latest.design || "code given in the call";
      material.push({
        reviewer: partReviewer,
        subject: `the parts built by ${named}`,
        brief: [
          ...builds.map((one) =>
            reviewBrief({
              title: `Requirements in ${one.file}`,
              ...held.get(one)!,
            }),
          ),
          "## The last build, as the studio answered it",
          latest.answer,
          ...(drawn.length
            ? [
                "The picture shows the parts from the front, the right, the top and three-quarter.",
              ]
            : []),
        ].join("\n\n"),
        pictures: drawn,
      });
    }
    return material;
  }

  /**
   * The designs built against requirements since `since`, each with its
   * builds, and what each build held of its requirements.
   */
  async #changed(
    conversationId: string,
    since: Date,
  ): Promise<{
    designs: Map<string, Reviewed[]>;
    held: Map<Reviewed, Held>;
  }> {
    const all = await this.#record(this.#directory(conversationId)).read();
    const kept = Object.values(all).filter(
      (one): one is Reviewed =>
        isRecord(one) &&
        typeof one["design"] === "string" &&
        typeof one["file"] === "string" &&
        typeof one["builtAt"] === "string" &&
        Array.isArray(one["first"]) &&
        Array.isArray(one["current"]),
    );
    const byFile = new Map<string, Reviewed[]>();
    for (const one of kept) {
      const key = one.file.toLowerCase();
      byFile.set(key, [...(byFile.get(key) ?? []), one]);
    }
    const held = new Map<Reviewed, Held>();
    for (const builds of byFile.values())
      for (const [one, part] of heldIn(builds)) held.set(one, part);
    // A design built against several requirements files is one piece.
    const designs = new Map<string, Reviewed[]>();
    for (const one of kept) {
      if (!(Date.parse(one.builtAt) > since.getTime()) || !held.has(one))
        continue;
      const key = one.design.toLowerCase();
      designs.set(key, [...(designs.get(key) ?? []), one]);
    }
    return { designs, held };
  }
}
