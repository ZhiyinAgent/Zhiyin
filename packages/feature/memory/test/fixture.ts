import { join } from "node:path";
import { TemporaryFolders } from "@zhiyin/test-support";
import { FileMemory } from "../src/index.js";
import type { WriteContext } from "../src/index.js";

export const folders = new TemporaryFolders();

/** A clock the test moves on by hand, a minute at a time by default. */
class Clock {
  #now = new Date("2026-10-31T09:00:00.000Z").getTime();
  readonly now = () => new Date(this.#now);
  later(minutes = 1): void {
    this.#now += minutes * 60_000;
  }
}

/** A memory in a folder of its own, and what its tests need around it. */
export async function memoryIn(
  options: {
    readonly folder?: string;
    readonly broadFolders?: readonly string[];
    readonly recycled?: string[];
  } = {},
) {
  const folder =
    options.folder ?? join(await folders.make("zhiyin-memory-"), "memory");
  const clock = new Clock();
  let ids = 0;
  const recycled = options.recycled ?? [];
  const memory = new FileMemory({
    folder,
    now: clock.now,
    newId: () => `w${(ids += 1)}`,
    broadFolders: options.broadFolders ?? [],
    recycle: async (path) => {
      recycled.push(path);
      const { rm } = await import("node:fs/promises");
      await rm(path, { recursive: true, force: true });
    },
  });
  return { memory, folder, clock, recycled };
}

/** A conversation with nothing outside in it, where the person said `said`. */
export function conversation(
  said: readonly string[] = [],
  more: Partial<WriteContext> = {},
): WriteContext {
  return {
    conversation: { id: "c1", title: "Thesis template setup" },
    personsWords: said,
    held: {},
    ...more,
  };
}

/** A Knowledge entry for everything the person does. */
export const typst = {
  section: "knowledge",
  scope: "everything",
  title: "Typst over LaTeX",
  summary: "The university template needs a grid the LaTeX class breaks",
  text: "Chosen on 3 October. The title page needs the logo and the jury list on a grid.",
} as const;
