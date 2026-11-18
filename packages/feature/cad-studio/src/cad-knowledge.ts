/**
 * What the CAD studio knows beyond its tools, for the catalog (ADR 0017,
 * ADR 0024): its own written pages, build123d's and bd_warehouse's
 * reference, read from the installed library when first opened, and the
 * known API changes. Listing the entries never starts Python.
 */

import type {
  CatalogEntry,
  CatalogPage,
  KnowledgeSource,
} from "@zhiyin/contract";
import { cadBreaks, type CadBreak } from "./api-breaks.js";
import type { CadPython } from "./cad-python.js";
import {
  LibraryReference,
  type Reference,
  type ReferencePage,
} from "./library-reference.js";
import {
  pageOf,
  referenceOf,
  versionWords,
  type Library,
} from "./library-versions.js";
import { plainWords } from "./library-words.js";
import { writtenPageId, writtenPages } from "./written-pages.js";

const plugin = "3d-rendering";

const written = writtenPages.map((page) => ({
  entry: {
    id: writtenPageId(page.topic),
    kind: "doc",
    title: page.title,
    summary: page.summary,
    plugin,
    terms: page.terms,
  } satisfies CatalogEntry,
  text: page.text,
}));

const breakId = (one: CadBreak) =>
  `${referenceOf("build123d").replace(/^doc:/, "break:")}/${one.id}`;

const breaks = cadBreaks.map((one) => ({
  entry: {
    id: breakId(one),
    kind: "break",
    title: `${versionWords("build123d")}: ${one.right.split(",")[0]}, not ${one.wrong.split(",")[0]}`,
    summary: `The form that works in ${versionWords("build123d")} in place of ${one.wrong}.`,
    plugin,
  } satisfies CatalogEntry,
  text: [
    `In ${versionWords("build123d")}, write ${one.right}, in place of ${one.wrong}.`,
    `A build's error or warning that matches /${one.pattern}/ comes from it.`,
    `To read more, open ${one.see.join(" or ")}.`,
  ].join("\n"),
}));

const libraryWords: Record<Library, string> = {
  build123d: "classes and functions",
  bd_warehouse: "standard parts, module by module",
};

/** A library's whole reference, as one entry. */
const indexEntry = (library: Library, built: boolean): CatalogEntry => ({
  id: referenceOf(library),
  kind: "doc",
  title: `${versionWords(library)} reference`,
  summary: built
    ? `Every one of ${versionWords(library)}'s ${libraryWords[library]}, read from the library installed.`
    : `${versionWords(library)}'s ${libraryWords[library]}, read from the library installed the first time this is opened.`,
  plugin,
});

const pageEntry = (page: ReferencePage): CatalogEntry => ({
  id: pageOf(page.library, page.name),
  kind: "doc",
  title: `${page.library}.${page.name}`,
  summary: page.summary,
  plugin,
  ...(page.terms.length ? { terms: page.terms } : {}),
  ...aliasesOf(page),
});

/** The plain words for what a page's name makes, as other names for it. */
function aliasesOf(page: ReferencePage): { aliases?: readonly string[] } {
  const aliases = plainWords[page.library]?.[page.name];
  return aliases ? { aliases } : {};
}

/** The list of a library's pages, by kind. */
function indexText(library: Library, reference: Reference): string {
  const pages = reference.pages.filter((page) => page.library === library);
  const named = (kind: ReferencePage["kind"]) =>
    pages
      .filter((page) => page.kind === kind)
      .map((page) => page.name)
      .join(", ");
  return [
    `${versionWords(library)}, read from the library installed. Open ${referenceOf(library)}/<name> for any of these.`,
    ...(
      [
        ["Modules", "module"],
        ["Classes", "class"],
        ["Functions", "function"],
      ] as const
    )
      .map(([words, kind]) => [words, named(kind)] as const)
      .filter(([, names]) => names)
      .map(([words, names]) => `${words}: ${names}`),
  ].join("\n");
}

const libraryOf = (id: string): Library | undefined =>
  (["build123d", "bd_warehouse"] as const).find(
    (library) =>
      id === referenceOf(library) || id.startsWith(`${referenceOf(library)}/`),
  );

/**
 * The CAD studio's knowledge, its reference kept in `directory`, the
 * studio's folder in the app's data, and read with `harness`, the shipped
 * `run.py`, in the CAD environment's Python.
 */
export function cadKnowledge(
  python: CadPython,
  options: { readonly harness: string; readonly directory: string },
): KnowledgeSource {
  const reference = new LibraryReference(
    python,
    options.harness,
    options.directory,
  );
  return {
    plugin,
    toolkits: [],
    breaks: cadBreaks,

    async entries() {
      const kept = await reference.kept();
      return [
        ...written.map((one) => one.entry),
        indexEntry("build123d", kept !== undefined),
        indexEntry("bd_warehouse", kept !== undefined),
        ...(kept?.pages.map(pageEntry) ?? []),
        ...breaks.map((one) => one.entry),
      ];
    },

    async page(id): Promise<CatalogPage | undefined> {
      const own = [...written, ...breaks].find((one) => one.entry.id === id);
      if (own) return own;
      const library = libraryOf(id);
      if (!library) return undefined;
      const read = await reference.read();
      if (typeof read === "string")
        return { entry: indexEntry(library, false), text: read };
      if (id === referenceOf(library))
        return {
          entry: indexEntry(library, true),
          text: indexText(library, read),
        };
      const found = read.pages.find(
        (page) => pageOf(page.library, page.name) === id,
      );
      return found ? { entry: pageEntry(found), text: found.text } : undefined;
    },
  };
}
