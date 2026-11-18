/**
 * build123d's and bd_warehouse's reference, read by introspection in the CAD
 * environment's Python the first time it is asked for, and kept in the
 * studio's data folder under the versions the environment is made with, so
 * an environment made with others is read afresh (ADR 0024). The run reads
 * only the library and the harness and writes only its own folder; what it
 * leaves is read as data, and a reference that is not one is not kept.
 */

import { randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import type { CadPython } from "./cad-python.js";
import { notInstalled } from "./environment-words.js";
import { libraries, type Library } from "./library-versions.js";
import { plainFile } from "./run-answer.js";
import { removeRun } from "./run-folders.js";
import { minutes } from "./run-time.js";

/** One page, as the library said it. */
export type ReferencePage = {
  readonly library: Library;
  /** Its name in the library, as `Face` or `fastener.HexNut`. */
  readonly name: string;
  readonly kind: "class" | "function" | "module";
  readonly summary: string;
  /** Its members' names, for the search. */
  readonly terms: readonly string[];
  readonly text: string;
};

export type Reference = { readonly pages: readonly ReferencePage[] };

/** How long reading the reference may take. */
const readingMs = minutes(3);
/** The most the reference may be. */
const largest = 64 * 1024 * 1024;

const isString = (value: unknown): value is string => typeof value === "string";

/** The reference the run left, when it is one, of the versions pinned. */
function referenceIn(said: unknown): Reference | string {
  const given = said as { versions?: unknown; pages?: unknown } | undefined;
  const versions = given?.versions as Record<string, unknown> | undefined;
  if (!versions || !Array.isArray(given?.pages))
    return "The CAD environment's Python gave no reference.";
  for (const library of Object.keys(libraries) as Library[])
    if (versions[library] !== libraries[library])
      return `The CAD environment holds ${library} ${String(versions[library])}, not the ${libraries[library]} Zhiyin is made for. Update the CAD studio from the 3D & Rendering plugin on the Plugins page.`;
  const pages: ReferencePage[] = [];
  for (const page of given.pages as unknown[]) {
    const one = page as Record<string, unknown>;
    if (
      !(one["library"] === "build123d" || one["library"] === "bd_warehouse") ||
      !isString(one["name"]) ||
      // A Python name, or names joined by dots.
      one["name"].length > 200 ||
      !/^[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*$/.test(one["name"]) ||
      !(
        one["kind"] === "class" ||
        one["kind"] === "function" ||
        one["kind"] === "module"
      ) ||
      !isString(one["summary"]) ||
      !isString(one["text"]) ||
      !Array.isArray(one["terms"]) ||
      !one["terms"].every(isString)
    )
      return "The CAD environment's Python gave a reference Zhiyin cannot read.";
    pages.push({
      library: one["library"],
      name: one["name"],
      kind: one["kind"],
      summary: one["summary"],
      terms: one["terms"] as string[],
      text: one["text"],
    });
  }
  return { pages };
}

export class LibraryReference {
  readonly #python: CadPython;
  readonly #harness: string;
  readonly #folder: string;
  readonly #file: string;
  #kept: Reference | undefined;
  #reading: Promise<Reference | string> | undefined;

  constructor(python: CadPython, harness: string, directory: string) {
    this.#python = python;
    this.#harness = harness;
    this.#folder = join(directory, "reference");
    this.#file = join(
      this.#folder,
      `build123d-${libraries.build123d}-bd_warehouse-${libraries.bd_warehouse}.json`,
    );
  }

  /** The reference kept for these versions, if it was read before; nothing is run. */
  async kept(): Promise<Reference | undefined> {
    if (this.#kept) return this.#kept;
    const text = await readFile(this.#file, "utf8").catch(() => undefined);
    if (text === undefined) return undefined;
    let said: unknown;
    try {
      said = JSON.parse(text);
    } catch {
      return undefined;
    }
    const found = referenceIn(said);
    if (typeof found === "string") return undefined;
    this.#kept = found;
    return found;
  }

  /** The reference, read from the library when none is kept; or why it cannot be. */
  async read(): Promise<Reference | string> {
    const kept = await this.kept();
    if (kept) return kept;
    this.#reading ??= this.#build().finally(() => {
      this.#reading = undefined;
    });
    return this.#reading;
  }

  async #build(): Promise<Reference | string> {
    if ((await this.#python.state()) !== "ready") return notInstalled;
    const run = join(this.#folder, "runs", randomUUID());
    const out = join(run, "out");
    await mkdir(out, { recursive: true });
    try {
      const request = join(run, "request.json");
      await writeFile(
        request,
        JSON.stringify({ reference: true, output: out }),
        "utf8",
      );
      const ran = await this.#python.run({
        arguments: [this.#harness, request],
        cwd: run,
        read: [dirname(this.#harness), run],
        write: [out],
        home: join(run, "home"),
        homeLastsOneRun: true,
        timeoutMs: readingMs,
      });
      if (!ran.ok) return ran.reason;
      const file = await plainFile(out, "reference.json", largest);
      if (!file)
        return `The CAD library's reference could not be read.\n${`${ran.run.stdout}\n${ran.run.stderr}`.trim()}`;
      const text = await readFile(file.path, "utf8");
      let said: unknown;
      try {
        said = JSON.parse(text);
      } catch {
        return "The CAD environment's Python gave a reference Zhiyin cannot read.";
      }
      const found = referenceIn(said);
      if (typeof found === "string") return found;
      await this.#keep(text);
      this.#kept = found;
      return found;
    } finally {
      await removeRun(run);
    }
  }

  /** Kept whole or not at all, and the reference of other versions let go. */
  async #keep(text: string) {
    const next = `${this.#file}.${randomUUID()}.tmp`;
    await writeFile(next, text, "utf8");
    await rename(next, this.#file);
    const others = await readdir(this.#folder).catch(() => []);
    await Promise.all(
      others
        .filter(
          (name) =>
            name.endsWith(".json") && join(this.#folder, name) !== this.#file,
        )
        .map((name) => rm(join(this.#folder, name), { force: true })),
    );
  }
}
