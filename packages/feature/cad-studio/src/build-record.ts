/**
 * What this conversation's builds showed and wrote, kept in its own folder so
 * each build's answer can say what changed since: each script's parts as its
 * last build measured them, by the script and its arguments, and each file a
 * build exported, with the digest of what it wrote and a fingerprint of each
 * part it holds as the part was then.
 */

import { contentDigest } from "@zhiyin/files";
import { JsonRecord } from "./json-record.js";
import { asObject } from "./json-values.js";
import { listed } from "./shown-names.js";
import type { MeasuredPart } from "./wording.js";

/** What a part was at a build, for the next to compare with. */
type PartAtBuild = {
  readonly volume: number;
  readonly size: readonly [number, number, number];
  readonly solids: number;
  readonly valid: boolean;
  readonly print: string;
};

/** A file a build exported: the script it came from, its path as the model named it, its content's digest, and each part's fingerprint. */
type Exported = {
  readonly script: string;
  readonly relative: string;
  readonly digest: string;
  readonly parts: Readonly<Record<string, string>>;
};

type Builds = {
  scripts: Record<string, Record<string, PartAtBuild>>;
  files: Record<string, Exported>;
};

/** A file this build wrote: where it is, as the model named it, and the parts it holds. */
export type Placed = {
  readonly absolute: string;
  readonly relative: string;
  readonly parts: readonly string[];
};

const figures = (value: number) => Number(value.toPrecision(6));
const thousandths = (value: number) => Math.round(value * 1000) / 1000;

/**
 * A part's fingerprint: what the answer measures of it, to six figures or a
 * thousandth of a millimetre, so any change to the part that a file of it
 * would show changes it, and the kernel's last digits do not.
 */
function fingerprint(part: MeasuredPart): string {
  return JSON.stringify([
    figures(part.volume),
    figures(part.area),
    part.solids,
    part.valid,
    [...part.min, ...part.max].map(thousandths),
    part.centre?.map(thousandths) ?? null,
    Object.entries(part.faces).sort(),
    part.edges ?? null,
    part.holes.map((hole) => [thousandths(hole.diameter), hole.count]),
  ]);
}

export class BuildRecord {
  // None yet, one cut short, or one of another shape: nothing is known of earlier builds.
  readonly #record: JsonRecord<Builds>;

  constructor(path: string) {
    this.#record = new JsonRecord(
      path,
      (value) => {
        const all = asObject(value);
        return all && asObject(all["scripts"]) && asObject(all["files"])
          ? (all as Builds)
          : undefined;
      },
      () => ({ scripts: {}, files: {} }),
    );
  }

  /** The parts the last build of `script` showed, by name; nothing before its first. */
  async last(
    script: string,
  ): Promise<Readonly<Record<string, PartAtBuild>> | undefined> {
    return (await this.#record.read()).scripts[script];
  }

  /**
   * Each file an earlier build of `script` wrote that still holds what it
   * wrote, with the parts in it whose fingerprint `parts` no longer
   * matches; files this build wrote are left out.
   */
  async stale(
    script: string,
    parts: readonly MeasuredPart[],
    written: readonly Placed[],
  ): Promise<{ relative: string; parts: string[] }[]> {
    const now = new Map(parts.map((one) => [one.name, fingerprint(one)]));
    const fresh = new Set(written.map((one) => one.absolute.toLowerCase()));
    const found: { relative: string; parts: string[] }[] = [];
    for (const [where, file] of Object.entries(
      (await this.#record.read()).files,
    )) {
      if (file.script !== script || fresh.has(where)) continue;
      const changed = Object.entries(file.parts)
        .filter(([name, print]) => now.has(name) && now.get(name) !== print)
        .map(([name]) => name);
      if (changed.length && (await contentDigest(where)) === file.digest)
        found.push({ relative: file.relative, parts: changed });
    }
    return found;
  }

  /**
   * The parts a build of the script `file` names, with any arguments, wrote
   * to a file for printing, STL or 3MF, as the build takes them to be
   * printed; by name.
   */
  async printed(file: string): Promise<string[]> {
    const found = new Set<string>();
    for (const one of Object.values((await this.#record.read()).files)) {
      const [script] = JSON.parse(one.script) as [string | null];
      if (script === file.toLowerCase() && /\.(stl|3mf)$/i.test(one.relative))
        for (const name of Object.keys(one.parts)) found.add(name);
    }
    return [...found];
  }

  /** Keeps this build's parts as the last of `script`, and each file it wrote with its parts as they are. */
  keep(
    script: string,
    parts: readonly MeasuredPart[],
    written: readonly Placed[],
  ): Promise<void> {
    return this.#record.change(async (all) => {
      all.scripts[script] = Object.fromEntries(
        parts.map((one) => [
          one.name,
          {
            volume: one.volume,
            size: one.size,
            solids: one.solids,
            valid: one.valid,
            print: fingerprint(one),
          },
        ]),
      );
      const prints = new Map(parts.map((one) => [one.name, fingerprint(one)]));
      for (const one of written) {
        const digest = await contentDigest(one.absolute);
        if (!digest) continue;
        all.files[one.absolute.toLowerCase()] = {
          script,
          relative: one.relative,
          digest,
          parts: Object.fromEntries(
            one.parts.flatMap((name) => {
              const print = prints.get(name);
              return print ? [[name, print]] : [];
            }),
          ),
        };
      }
    });
  }
}

/** The parts of this build that are as the last build of the same script measured them, by name. */
export function unchangedSince(
  last: Readonly<Record<string, PartAtBuild>> | undefined,
  parts: readonly MeasuredPart[],
): string[] {
  if (!last) return [];
  return parts
    .filter((one) => last[one.name]?.print === fingerprint(one))
    .map((one) => one.name);
}

/** The least change in volume said, as a share of the last build's. */
const VOLUME_CHANGE = 0.02;
/** The least change in a side of a part's box said, as a share of its longest side. */
const SIZE_CHANGE = 0.01;

/** A volume in mm³, as cm³ to three figures from a cubic centimetre, else in mm³. */
const volumeWords = (volume: number, unit: "cm³" | "mm³") =>
  unit === "cm³"
    ? `${Number((volume / 1000).toPrecision(3))}`
    : `${Number(volume.toPrecision(3))}`;

const sizeWords = (size: readonly number[]) =>
  size.map((side) => `${Math.round(side * 1000) / 1000}`).join(" × ");

/**
 * The lines an answer gives each part that changed notably since the last
 * build of the same script, `script` naming it as the model knows it: its
 * volume by 2% or more, a side of its box by 1% of its longest or more, its
 * number of solids, or whether it is a valid solid. A part with no volume is
 * said whatever the last build showed, and the parts it showed that this one
 * does not are named.
 */
export function changeLines(
  script: string,
  last: Readonly<Record<string, PartAtBuild>> | undefined,
  parts: readonly MeasuredPart[],
): string[] {
  const lines: string[] = [];
  for (const part of parts) {
    if (part.volume <= 0) {
      lines.push(`${part.name} has no volume: it holds no material.`);
      continue;
    }
    const before = last?.[part.name];
    if (!before) continue;
    const said: string[] = [];
    const longest = Math.max(...before.size, ...part.size);
    if (
      before.volume <= 0 ||
      Math.abs(part.volume - before.volume) >= VOLUME_CHANGE * before.volume
    ) {
      const unit = Math.max(part.volume, before.volume) >= 1000 ? "cm³" : "mm³";
      const share =
        before.volume > 0
          ? ` (${part.volume >= before.volume ? "+" : "-"}${Math.round((Math.abs(part.volume - before.volume) / before.volume) * 100)}%)`
          : "";
      said.push(
        `volume ${volumeWords(before.volume, unit)} → ${volumeWords(part.volume, unit)} ${unit}${share}`,
      );
    }
    if (
      before.size.some(
        (side, axis) =>
          Math.abs(side - part.size[axis]!) >=
          Math.max(SIZE_CHANGE * longest, 1e-3),
      )
    )
      said.push(`size ${sizeWords(before.size)} → ${sizeWords(part.size)} mm`);
    if (before.solids !== part.solids)
      said.push(`${before.solids} → ${part.solids} solids`);
    if (before.valid !== part.valid)
      said.push(part.valid ? "now a valid solid" : "no longer a valid solid");
    if (said.length)
      lines.push(
        `${part.name} changed since the last build of ${script}: ${said.join(", ")}.`,
      );
  }
  const shown = new Set(parts.map((one) => one.name));
  const gone = Object.keys(last ?? {}).filter((name) => !shown.has(name));
  if (gone.length)
    lines.push(
      `${listed(gone)} ${gone.length === 1 ? "was" : "were"} shown by the last build of ${script} and ${gone.length === 1 ? "is" : "are"} not shown now.`,
    );
  return lines;
}

/** A line for each file an earlier build wrote whose parts have changed since. */
export function staleLines(
  stale: readonly { relative: string; parts: readonly string[] }[],
): string[] {
  return stale.map(
    (one) =>
      `${one.relative} was written by an earlier build; ${listed(one.parts)} ${one.parts.length === 1 ? "has" : "have"} changed since.`,
  );
}
