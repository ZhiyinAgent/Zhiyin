/**
 * Blender's Python API as the installed Blender has it, built the first time
 * a page of it is asked for and kept in the studio's data by Blender's
 * version (ADR 0024). Listing the pages never starts Blender: it reads the
 * kept build, or, before there is one for this Blender, names the one entry
 * that builds it.
 */

import { mkdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { CatalogEntry, CatalogPage } from "@zhiyin/contract";
import { replaceFile } from "@zhiyin/files";

/** One page of the build, as Blender's introspection writes it. */
type BuiltPage = {
  readonly name: string;
  readonly summary: string;
  readonly text: string;
  readonly terms: readonly string[];
};

/** A build: the version it was read from, its series, as `5.2`, and its pages. */
type Built = {
  readonly version: string;
  readonly series: string;
  readonly pages: readonly BuiltPage[];
};

/** Which build is this Blender's: the executable it was read from, as it was then. */
type Installed = {
  readonly blender: string;
  readonly version: string;
  readonly folder: string;
};

export type ApiReferenceOptions = {
  /** Where builds are kept, one folder for each version. */
  readonly directory: string;
  readonly plugin: string;
  /** The installed Blender, or nothing when it is not installed. */
  readonly blender: () => Promise<string | undefined>;
  /** Reads the API from the installed Blender: the build, as JSON text. */
  readonly build: () => Promise<string>;
};

/** The entry that names the reference before it is built, and its index after. */
const referenceId = "doc:blender/api";
const prefix = "doc:blender/";

/** The executable as it is now: a new or updated Blender reads differently. */
async function stamp(executable: string): Promise<string> {
  const status = await stat(executable).catch(() => undefined);
  return status
    ? `${executable}|${status.size}|${status.mtimeMs}`
    : `${executable}|missing`;
}

function parsed(text: string): Built {
  const built = JSON.parse(text) as Partial<Built>;
  if (
    typeof built.version !== "string" ||
    typeof built.series !== "string" ||
    !Array.isArray(built.pages)
  )
    throw new Error("Blender's API could not be read: it gave no pages.");
  return built as Built;
}

const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

export class ApiReference {
  readonly #options: ApiReferenceOptions;
  /** The build read into memory, by the folder it is kept in. */
  #loaded: { readonly folder: string; readonly built: Built } | undefined;
  #building: Promise<Built> | undefined;

  constructor(options: ApiReferenceOptions) {
    this.#options = options;
  }

  /** The reference's entries, from the build kept for this Blender, or the one entry that builds it. */
  async entries(): Promise<readonly CatalogEntry[]> {
    const built = await this.#kept();
    if (!built) return [this.#placeholder()];
    return [
      this.#index(built),
      ...built.pages.map((page) => this.#entry(built, page)),
    ];
  }

  /**
   * A page of the reference, built first when this Blender has none kept; a
   * reference that cannot be built is a page saying why, and is tried again
   * the next time.
   */
  async page(id: string): Promise<CatalogPage | undefined> {
    if (!id.startsWith(prefix)) return undefined;
    let built: Built;
    try {
      built = await this.#current();
    } catch (error) {
      return {
        entry: this.#placeholder(),
        text: `Blender's API reference could not be built: ${message(error)} blender_api answers for one name from the running Blender.`,
      };
    }
    const rest = id.slice(prefix.length);
    if (rest === "api" || rest === built.series)
      return { entry: this.#index(built), text: this.#indexText(built) };
    // A page asked for by another version's id is this Blender's page of that name.
    const name = rest.slice(rest.indexOf("/") + 1);
    const found = built.pages.find((page) => page.name === name);
    return found
      ? { entry: this.#entry(built, found), text: found.text }
      : undefined;
  }

  /** The build kept for the installed Blender, without starting it. */
  async #kept(): Promise<Built | undefined> {
    const executable = await this.#options.blender();
    if (!executable) return undefined;
    const installed = await readFile(this.#installedFile, "utf8")
      .then((text) => JSON.parse(text) as Installed)
      .catch(() => undefined);
    if (!installed || installed.blender !== (await stamp(executable)))
      return undefined;
    if (this.#loaded?.folder === installed.folder) return this.#loaded.built;
    const built = await readFile(
      join(this.#options.directory, installed.folder, "pages.json"),
      "utf8",
    )
      .then(parsed)
      .catch(() => undefined);
    if (built) this.#loaded = { folder: installed.folder, built };
    return built;
  }

  /** The build for the installed Blender, made now when none is kept. */
  async #current(): Promise<Built> {
    const kept = await this.#kept();
    if (kept) return kept;
    this.#building ??= this.#build().finally(() => {
      this.#building = undefined;
    });
    return this.#building;
  }

  async #build(): Promise<Built> {
    const executable = await this.#options.blender();
    if (!executable) throw new Error("Blender is not installed.");
    const before = await stamp(executable);
    const text = await this.#options.build();
    const built = parsed(text);
    const folder = built.version.replace(/[^\w.-]+/g, "-");
    await mkdir(join(this.#options.directory, folder), { recursive: true });
    await replaceFile(
      join(this.#options.directory, folder, "pages.json"),
      text,
    );
    const installed: Installed = {
      blender: before,
      version: built.version,
      folder,
    };
    await replaceFile(this.#installedFile, JSON.stringify(installed));
    this.#loaded = { folder, built };
    return built;
  }

  get #installedFile(): string {
    return join(this.#options.directory, "installed.json");
  }

  #placeholder(): CatalogEntry {
    return {
      id: referenceId,
      kind: "doc",
      title: "Blender's Python API",
      summary:
        "Every type, operator, bmesh and mathutils function of the installed Blender, read from it when this is first opened.",
      plugin: this.#options.plugin,
      terms: ["bpy", "bpy.types", "bpy.ops", "bmesh", "mathutils", "API"],
    };
  }

  #index(built: Built): CatalogEntry {
    return {
      id: `${prefix}${built.series}`,
      kind: "doc",
      title: `Blender ${built.series}'s Python API`,
      summary: `What the installed Blender ${built.version} has: its types, operators, bmesh, mathutils and bpy_extras, a page each.`,
      plugin: this.#options.plugin,
      terms: ["bpy", "bpy.types", "bpy.ops", "bmesh", "mathutils", "API"],
    };
  }

  #entry(built: Built, page: BuiltPage): CatalogEntry {
    return {
      id: `${prefix}${built.series}/${page.name}`,
      kind: "doc",
      title: page.name,
      summary: page.summary,
      plugin: this.#options.plugin,
      terms: page.terms,
    };
  }

  #indexText(built: Built): string {
    const count = (start: string) =>
      built.pages.filter((page) => page.name.startsWith(start)).length;
    const modules = [
      ...new Set(
        built.pages
          .map((page) => page.name)
          .filter((name) => !name.startsWith("bpy."))
          .map((name) => name.split(".").slice(0, 2).join(".")),
      ),
    ];
    return [
      `Blender ${built.version}'s Python API, read from the installed Blender.`,
      `Each page is opened as ${prefix}${built.series}/<name>:`,
      `- bpy.types.<Type>, as bpy.types.Object: ${count("bpy.types.")} types, each with its own properties and functions, a node's inputs and outputs by name, and the type it is based on.`,
      `- bpy.ops.<module>, as bpy.ops.mesh, and bpy.ops.<module>.<operator> where a module's operators each have a page: ${count("bpy.ops.")} pages.`,
      `- ${modules.join(", ")}, and their classes and functions.`,
      "find searches them by name and by what they hold.",
    ].join("\n");
  }
}
