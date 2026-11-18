/**
 * What the 3D studio knows beyond its tools, for the catalog (ADR 0017, ADR
 * 0024): its toolkits' words, its own pages, the API changes since the
 * Blenders models were trained on, and Blender's API as the installed
 * Blender has it.
 */

import type {
  CatalogEntry,
  CatalogPage,
  KnowledgeSource,
} from "@zhiyin/contract";
import { apiBreaks, type KnownBreak } from "./api-breaks.js";
import {
  libraryFunctionId,
  libraryFunctions,
  libraryFunctionText,
  type LibraryFunction,
} from "./library-functions.js";
import type { ApiReference } from "./api-reference.js";
import { studioPlugin, toolkitDeclarations } from "./toolkits.js";
import { writtenPages, type WrittenPage } from "./written-pages.js";

const writtenEntry = (page: WrittenPage): CatalogEntry => ({
  id: page.id,
  kind: "doc",
  title: page.title,
  summary: page.summary,
  plugin: studioPlugin,
  terms: page.terms,
});

const functionEntry = (fn: LibraryFunction): CatalogEntry => ({
  id: libraryFunctionId(studioPlugin, fn.name),
  kind: "function",
  title: `zhiyin.${fn.name}`,
  summary: fn.summary,
  plugin: studioPlugin,
  terms: fn.terms,
});

const breakEntry = (change: KnownBreak): CatalogEntry => ({
  id: change.id,
  kind: "break",
  title: change.title,
  summary: `Blender 5.2 refuses ${change.wrong}; what works instead.`,
  plugin: studioPlugin,
  terms: [...change.wrong.matchAll(/[A-Za-z_][\w]*/g)].map((word) => word[0]),
});

const breakText = (change: KnownBreak) =>
  [
    `${change.title}, as Blender 5.2 has it.`,
    `Written for an earlier Blender: ${change.wrong}`,
    `In Blender 5.2: ${change.right}`,
    `To read: ${change.see.join(", ")}.`,
  ].join("\n");

/** The 3D studio's knowledge, its API reference built on the PC by `reference`. */
export function sceneKnowledge(reference: ApiReference): KnowledgeSource {
  return {
    plugin: studioPlugin,
    toolkits: toolkitDeclarations,
    breaks: apiBreaks,
    async entries() {
      return [
        ...writtenPages.map(writtenEntry),
        ...libraryFunctions.map(functionEntry),
        ...apiBreaks.map(breakEntry),
        ...(await reference.entries()),
      ];
    },
    async page(id): Promise<CatalogPage | undefined> {
      const written = writtenPages.find((page) => page.id === id);
      if (written) return { entry: writtenEntry(written), text: written.text };
      const fn = libraryFunctions.find(
        (one) => libraryFunctionId(studioPlugin, one.name) === id,
      );
      if (fn)
        return { entry: functionEntry(fn), text: libraryFunctionText(fn) };
      const change = apiBreaks.find((one) => one.id === id);
      if (change) return { entry: breakEntry(change), text: breakText(change) };
      return reference.page(id);
    },
  };
}
