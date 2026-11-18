/**
 * The CAD studio's knowledge for the catalog: its written pages and known API
 * changes, and build123d's and bd_warehouse's reference, read in the CAD
 * environment's Python the first time it is opened and kept for the versions
 * the environment is made with. Python is a stand-in answering as the harness
 * would; the real library's reference is read in the system-boundary tests.
 */

import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { catalogIndex } from "@zhiyin/catalog-search";
import { TemporaryFolders } from "@zhiyin/test-support";
import {
  cadEnvironment,
  cadKnowledge,
  type CadPython,
  type CadRun,
} from "../src/index.js";

const folders = new TemporaryFolders();
afterEach(() => folders.removeAll());

const pinned = (name: string) =>
  cadEnvironment.lock.locked.find((one) => one.name === name)!.version;
const versions = {
  build123d: pinned("build123d"),
  bd_warehouse: pinned("bd-warehouse"),
};
/** As a page id names a version: major and minor. */
const short = (version: string) => version.split(".").slice(0, 2).join(".");
const build123d = `doc:build123d/${short(versions.build123d)}`;
const warehouse = `doc:bd_warehouse/${short(versions.bd_warehouse)}`;

const reference = {
  versions,
  pages: [
    {
      library: "build123d",
      name: "Face",
      kind: "class",
      summary: "A bounded surface.",
      terms: ["is_planar", "area"],
      text: "class build123d.Face(...)\n- is_planar (property): Is the face planar",
    },
    {
      library: "build123d",
      name: "insert",
      kind: "function",
      summary: "Insert an object into a builder.",
      terms: [],
      text: "build123d.insert(objects, ...)",
    },
    {
      library: "bd_warehouse",
      name: "fastener",
      kind: "module",
      summary: "Threaded fasteners.",
      terms: ["HexNut"],
      text: "bd_warehouse.fastener\nParts in it:\n- HexNut: Hex Nut",
    },
    {
      library: "bd_warehouse",
      name: "fastener.HexNut",
      kind: "class",
      summary: "Hex Nut",
      terms: [],
      text: "class bd_warehouse.fastener.HexNut(size, ...)",
    },
  ],
};

/** A stand-in for the CAD environment's Python, answering a reference request with `answer`. */
function standIn(
  answer: unknown = reference,
  state: "ready" | "unavailable" = "ready",
) {
  const runs: CadRun[] = [];
  const python: CadPython = {
    state: async () => state,
    run: async (request) => {
      runs.push(request);
      const given = JSON.parse(
        await readFile(request.arguments.at(-1)!, "utf8"),
      ) as { reference?: boolean; output: string };
      if (given.reference)
        await writeFile(
          join(given.output, "reference.json"),
          JSON.stringify(answer),
        );
      return { ok: true, run: { exitCode: 0, stdout: "", stderr: "" } };
    },
  };
  return { python, runs };
}

async function studio(python: CadPython, directory?: string) {
  const data = directory ?? (await folders.make("zhiyin-cad-knowledge-"));
  const harness = join(data, "harness", "run.py");
  return {
    data,
    harness,
    knowledge: cadKnowledge(python, { harness, directory: data }),
  };
}

const ids = async (knowledge: {
  entries(): Promise<readonly { id: string }[]>;
}) => (await knowledge.entries()).map((entry) => entry.id);

describe("the CAD studio's knowledge", () => {
  it("belongs to the 3D & Rendering plugin, with no toolkits", async () => {
    const { knowledge } = await studio(standIn().python);

    expect(knowledge.plugin).toBe("3d-rendering");
    expect(knowledge.toolkits).toEqual([]);
    expect(
      (await knowledge.entries()).every(
        (entry) => entry.plugin === "3d-rendering",
      ),
    ).toBe(true);
  });

  it("lists, before the reference is read, the written pages, the known API changes and one entry per library saying it is read when opened, starting no Python", async () => {
    const { python, runs } = standIn();
    const { knowledge } = await studio(python);

    const entries = await knowledge.entries();

    expect(runs).toEqual([]);
    expect(entries.map((entry) => entry.id)).toEqual(
      expect.arrayContaining([
        "doc:3d-rendering/cad-requirements",
        "doc:3d-rendering/cad-drawings",
        `break:build123d/${short(versions.build123d)}/add`,
        build123d,
        warehouse,
      ]),
    );
    expect(entries.find((entry) => entry.id === build123d)?.summary).toContain(
      "the first time this is opened",
    );
    expect(entries.some((entry) => entry.id.startsWith(`${build123d}/`))).toBe(
      false,
    );
  });

  it("names in its written pages only ids the catalog lists", async () => {
    const { python } = standIn();
    const { knowledge } = await studio(python);
    const listed = new Set(
      (await knowledge.entries()).map((entry) => entry.id),
    );

    const named: string[] = [];
    for (const id of listed) {
      if (!id.startsWith("doc:3d-rendering/cad-")) continue;
      const text = (await knowledge.page(id))?.text ?? "";
      named.push(...(text.match(/(?:doc|break):[\w./-]*\w/g) ?? []));
    }

    expect(named).toContain(build123d);
    expect(named.filter((id) => !listed.has(id))).toEqual([]);
  });

  it("opens a written page as Zhiyin's own text, with no Python", async () => {
    const { python, runs } = standIn();
    const { knowledge } = await studio(python);

    const page = await knowledge.page("doc:3d-rendering/cad-requirements");

    expect(page?.entry.kind).toBe("doc");
    expect(page?.text).toContain("- insert: part, along [x, y, z]");
    expect(runs).toEqual([]);
  });

  it("opens a known API change with the form that works and the pages to read", async () => {
    const { knowledge } = await studio(standIn().python);

    const page = await knowledge.page(
      `break:build123d/${short(versions.build123d)}/to_tuple`,
    );

    expect(page?.entry.kind).toBe("break");
    expect(page?.text).toContain("write tuple(v), in place of v.to_tuple()");
    expect(page?.text).toContain(`open ${build123d}/Vector`);
  });

  it("reads the reference in the CAD environment's Python on first opening, reading only the harness and the run's own folder", async () => {
    const { python, runs } = standIn();
    const { knowledge, harness, data } = await studio(python);

    const page = await knowledge.page(`${build123d}/Face`);

    expect(page?.text).toContain("is_planar (property)");
    expect(page?.entry).toMatchObject({
      id: `${build123d}/Face`,
      kind: "doc",
      title: "build123d.Face",
      terms: ["is_planar", "area"],
    });
    expect(runs).toHaveLength(1);
    const [run] = runs;
    expect(run!.arguments[0]).toBe(harness);
    expect(run!.read).toEqual([dirname(harness), run!.cwd]);
    expect(run!.write).toEqual([join(run!.cwd, "out")]);
    expect(run!.homeLastsOneRun).toBe(true);
    // The run's folder goes with it; the reference is kept.
    expect(await readdir(join(data, "reference", "runs"))).toEqual([]);
  });

  it("lists every page once the reference is read, and the libraries' indexes name them", async () => {
    const { knowledge } = await studio(standIn().python);
    await knowledge.page(build123d);

    expect(await ids(knowledge)).toEqual(
      expect.arrayContaining([
        `${build123d}/Face`,
        `${build123d}/insert`,
        `${warehouse}/fastener`,
        `${warehouse}/fastener.HexNut`,
      ]),
    );
    const index = await knowledge.page(build123d);
    expect(index?.text).toContain("Classes: Face");
    expect(index?.text).toContain("Functions: insert");
    expect(index?.entry.summary).not.toContain("first time");
    expect((await knowledge.page(warehouse))?.text).toContain(
      "Modules: fastener",
    );
  });

  it("finds a library page by the plain words for what it makes, which its docstring lacks", async () => {
    const { knowledge } = await studio(
      standIn({
        ...reference,
        pages: [
          ...reference.pages,
          {
            library: "build123d",
            name: "fillet",
            kind: "function",
            summary: "Apply a fillet to the given edges.",
            terms: [],
            text: "build123d.fillet(objects, radius)",
          },
          {
            library: "build123d",
            name: "Text",
            kind: "class",
            summary: "Create text.",
            terms: [],
            text: "class build123d.Text(txt, font_size)",
          },
        ],
      }).python,
    );
    await knowledge.page(build123d);
    const index = catalogIndex(await knowledge.entries());
    const first = (query: string) => index.find(query)[0]?.entry.id;

    expect(first("round the edges of a part")).toBe(`${build123d}/fillet`);
    expect(first("make digit solids for numbering")).toBe(`${build123d}/Text`);
  });

  it("reuses the kept reference, in this run of Zhiyin and the next, with no further Python", async () => {
    const { python, runs } = standIn();
    const { knowledge, data } = await studio(python);
    await knowledge.page(`${build123d}/Face`);

    await knowledge.page(`${warehouse}/fastener.HexNut`);
    const next = (await studio(python, data)).knowledge;
    const page = await next.page(`${build123d}/insert`);

    expect(page?.text).toBe("build123d.insert(objects, ...)");
    expect(await ids(next)).toContain(`${build123d}/Face`);
    expect(runs).toHaveLength(1);
  });

  it("reads the reference once when it is opened several times at once", async () => {
    const { python, runs } = standIn();
    const { knowledge } = await studio(python);

    const pages = await Promise.all([
      knowledge.page(`${build123d}/Face`),
      knowledge.page(`${build123d}/insert`),
      knowledge.page(warehouse),
    ]);

    expect(pages.every((page) => page !== undefined)).toBe(true);
    expect(runs).toHaveLength(1);
  });

  it("answers a name the library does not have with nothing", async () => {
    const { knowledge } = await studio(standIn().python);

    expect(await knowledge.page(`${build123d}/Nothing`)).toBeUndefined();
    expect(await knowledge.page("doc:somewhere/else")).toBeUndefined();
  });

  it("says the studio is not set up when its Python cannot run, and runs nothing", async () => {
    const { python, runs } = standIn(reference, "unavailable");
    const { knowledge } = await studio(python);

    const page = await knowledge.page(`${build123d}/Face`);

    expect(page?.text).toBe(
      "The CAD studio is not installed, or needs updating since Zhiyin was updated. Set it up from the 3D & Rendering plugin on the Plugins page.",
    );
    expect(runs).toEqual([]);
  });

  it("keeps no reference read from other versions than the environment is made with, and says to update the studio", async () => {
    const { python, runs } = standIn({
      ...reference,
      versions: { ...versions, build123d: "0.9.1" },
    });
    const { knowledge } = await studio(python);

    const page = await knowledge.page(`${build123d}/Face`);
    await knowledge.page(`${build123d}/Face`);

    expect(page?.text).toBe(
      `The CAD environment holds build123d 0.9.1, not the ${versions.build123d} Zhiyin is made for. Update the CAD studio from the 3D & Rendering plugin on the Plugins page.`,
    );
    expect(runs).toHaveLength(2);
    expect(await ids(knowledge)).not.toContain(`${build123d}/Face`);
  });

  it.each(["../escape", "Face.", "a..b", "Face.__init__."])(
    "keeps no reference that is not one: a page named %s",
    async (name) => {
      const { python, runs } = standIn({
        versions,
        pages: [
          {
            library: "build123d",
            name: "Face",
            kind: "class",
            summary: "",
            terms: [],
            text: "Face.",
          },
          {
            library: "build123d",
            name,
            kind: "class",
            summary: "",
            terms: [],
            text: "",
          },
        ],
      });
      const { knowledge } = await studio(python);

      const page = await knowledge.page(`${build123d}/Face`);

      expect(page?.text).toBe(
        "The CAD environment's Python gave a reference Zhiyin cannot read.",
      );
      await knowledge.page(`${build123d}/Face`);
      expect(runs).toHaveLength(2);
    },
  );

  it("ignores a reference kept for other versions, and lets it go once this one is read", async () => {
    const data = await folders.make("zhiyin-cad-knowledge-");
    await mkdir(join(data, "reference"), { recursive: true });
    const old = join(
      data,
      "reference",
      "build123d-0.9.1-bd_warehouse-0.3.0.json",
    );
    await writeFile(
      old,
      JSON.stringify({
        versions: { build123d: "0.9.1", bd_warehouse: "0.3.0" },
        pages: [{ ...reference.pages[0], name: "OldFace" }],
      }),
    );
    const { knowledge } = await studio(standIn().python, data);

    expect(await ids(knowledge)).not.toContain(`${build123d}/OldFace`);
    await knowledge.page(`${build123d}/Face`);
    expect(await readdir(join(data, "reference"))).toEqual([
      `build123d-${versions.build123d}-bd_warehouse-${versions.bd_warehouse}.json`,
      "runs",
    ]);
  });
});
