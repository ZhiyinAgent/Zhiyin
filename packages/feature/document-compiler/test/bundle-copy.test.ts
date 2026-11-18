import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TemporaryFolders } from "@zhiyin/test-support";
import { tectonicBundleCopy, type RunProgram } from "../src/index.js";
import { documentCompilers } from "./reading-here.js";

const folders = new TemporaryFolders();

afterEach(() => folders.removeAll());

/** As Tectonic 0.17.0 says it when its bundle's server does not answer. */
const unreachable =
  'warning: failure fetching "booktabs.sty" from network (1/3)\ncaused by: error sending request for url (https://relay.fullyjustified.net/default_bundle_v33.tar)\nerror: paper.tex:2: Undefined control sequence\nwarning: errors were issued by the TeX engine, but were ignored; use --print and/or --keep-logs for details.';

type Ran = {
  readonly kind: "compile" | "format" | "fetch";
  readonly bundle: string | undefined;
  readonly cwd: string;
};

/**
 * Tectonic as the compiler meets it: it writes what its command asks, and
 * reaches its own server only while `server.reachable` holds.
 */
async function latexWith(
  server: { reachable: boolean },
  /** A format kept from before, so a compile need not wait for one. */
  formatKept = false,
) {
  const root = await realpath(await folders.make("zhiyin-compiler-"));
  const cache = await folders.make("zhiyin-latex-cache-");
  if (formatKept) {
    await mkdir(join(cache, "packages", "formats"), { recursive: true });
    await writeFile(join(cache, "packages", "formats", "latex.fmt"), "kept");
  }
  await writeFile(join(root, "paper.tex"), "\\documentclass{article}");
  const ran: Ran[] = [];
  const run: RunProgram = async (given) => {
    const args = given.arguments;
    const own = given.environment?.["TECTONIC_CACHE_DIR"] as string;
    const at = args.indexOf("--bundle");
    const bundle = at >= 0 ? args[at + 1] : undefined;
    const kind =
      args[0] === "-X"
        ? "fetch"
        : basename(args.at(-1)!) === "format.tex"
          ? "format"
          : "compile";
    ran.push({ kind, bundle, cwd: given.cwd });
    if (!bundle && !server.reachable && kind !== "fetch")
      return { exitCode: 0, stdout: "", stderr: unreachable };
    const kept = join(own, "bundles", "data", "digest");
    await mkdir(kept, { recursive: true });
    if (kind === "format") {
      await mkdir(join(own, "formats"), { recursive: true });
      await writeFile(join(own, "formats", "latex.fmt"), "format");
    } else if (kind === "fetch")
      await writeFile(join(kept, args.at(-1)!), `fetched ${args.at(-1)!}`);
    else {
      await writeFile(join(kept, "booktabs.sty"), "fetched by the compile");
      const outdir = args[args.indexOf("--outdir") + 1]!;
      await writeFile(join(outdir, "paper.pdf"), "%PDF-1.7\n");
      await writeFile(
        args[args.indexOf("--makefile-rules") + 1]!,
        `${join(outdir, "paper.pdf")} : ${args.at(-1)!}\n`,
      );
    }
    return { exitCode: 0, stdout: "", stderr: "" };
  };
  const compilers = documentCompilers({
    programs: async () => ({ tectonic: "C:/programs/tectonic.exe" }),
    tectonicCache: cache,
    run,
    confine: async () => undefined,
    containment: {
      open: () => {
        throw new Error("The stand-in compiler opens no container.");
      },
    },
  });
  return { root, cache, ran, compiler: compilers(() => root) };
}

type Result = { isError?: boolean; content: { text: string }[] };

describe("when Tectonic's own server cannot be reached", () => {
  it("compiles again from Zhiyin's copy of the TeX bundle, and keeps the PDF", async () => {
    const { compiler, ran } = await latexWith({ reachable: false }, true);

    const result = (await compiler.callTool("compile_document", {
      path: "paper.tex",
    })) as Result;

    expect(result.isError).toBeUndefined();
    expect(result.content[0]!.text).toMatch(/^Tectonic wrote paper\.pdf/);
    expect(
      ran.filter((step) => step.kind === "compile").map((step) => step.bundle),
    ).toEqual([undefined, tectonicBundleCopy.url]);
  });

  it("builds the format from the copy too, and starts later compiles from it", async () => {
    const { compiler, ran } = await latexWith({ reachable: false });

    await compiler.callTool("compile_document", { path: "paper.tex" });
    await compiler.callTool("compile_document", { path: "paper.tex" });

    expect(
      ran
        .filter((step) => step.kind !== "fetch")
        .map((step) => `${step.kind} from ${step.bundle ?? "Tectonic's own"}`),
    ).toEqual([
      "format from Tectonic's own",
      `format from ${tectonicBundleCopy.url}`,
      `compile from ${tectonicBundleCopy.url}`,
      `compile from ${tectonicBundleCopy.url}`,
    ]);
  });

  it("fetches into the shared cache by name from the copy, through the settings file Tectonic reads", async () => {
    const { compiler, ran, cache } = await latexWith({ reachable: false });

    await compiler.callTool("compile_document", { path: "paper.tex" });

    const fetches = ran.filter((step) => step.kind === "fetch");
    expect(fetches.length).toBeGreaterThan(0);
    for (const fetch of fetches) {
      expect(fetch.cwd).not.toBe(join(cache, "packages"));
      const settings = await readFile(join(fetch.cwd, "Tectonic.toml"), "utf8");
      expect(settings).toContain(`bundle = "${tectonicBundleCopy.url}"`);
    }
    expect(
      await readFile(
        join(cache, "packages", "bundles", "data", "digest", "booktabs.sty"),
        "utf8",
      ),
    ).toBe("fetched booktabs.sty");
  });
});

describe("when Tectonic's own server answers", () => {
  it("compiles from it alone, and fetches by name with no settings file", async () => {
    const { compiler, ran, cache } = await latexWith({ reachable: true });

    await compiler.callTool("compile_document", { path: "paper.tex" });

    expect(ran.every((step) => step.bundle === undefined)).toBe(true);
    expect(ran.filter((step) => step.kind === "compile")).toHaveLength(1);
    for (const fetch of ran.filter((step) => step.kind === "fetch"))
      expect(fetch.cwd).toBe(join(cache, "packages"));
  });
});

describe("what a person is asked to approve", () => {
  it("names where Tectonic downloads packages from, the copy included", async () => {
    const { compiler } = await latexWith({ reachable: true });

    expect(
      await compiler.inspect("compile_document", { path: "paper.tex" }),
    ).toMatchObject({
      detail: expect.stringContaining(
        "Tectonic downloads the TeX packages this document needs from relay.fullyjustified.net through data1b.fullyjustified.net, or from Zhiyin's copy on media.zhiyinagent.app when those cannot be reached.",
      ),
    });
  });
});
