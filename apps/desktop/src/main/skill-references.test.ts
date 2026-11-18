// @vitest-environment node
/**
 * The shipped skills tell the model what to open by catalog id; the studios
 * own the toolkits and pages those ids name. This is where the two meet, so a
 * skill that names a toolkit, page or function no studio has fails here
 * rather than as an open that finds nothing.
 */

import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ConversationScenes } from "@zhiyin/blender-studio";
import { cadKnowledge, type CadPython } from "@zhiyin/cad-studio";
import { loadBuiltInPlugins } from "@zhiyin/plugins";

const shipped = fileURLToPath(
  new URL("../../../../packages/feature/plugins/built-in", import.meta.url),
);

/** The studios' knowledge as the app composes it, without Blender or Python. */
function studioKnowledge() {
  const scenes = new ConversationScenes({
    blender: async () => undefined,
    directory: "unused",
    launch: () => {
      throw new Error("No session starts in this test.");
    },
    script: "unused",
  });
  return [
    scenes.knowledge(),
    cadKnowledge({} as CadPython, { harness: "unused", directory: "unused" }),
  ];
}

describe("the shipped skills' catalog ids", () => {
  it("name only skills, toolkits, pages and functions that are there", async () => {
    const plugins = await loadBuiltInPlugins(shipped);
    const skills = plugins.flatMap((plugin) => plugin.skills);
    const knowledge = studioKnowledge();
    const toolkits = new Set(
      knowledge.flatMap((source) =>
        source.toolkits.map((one) => `toolkit:${source.plugin}/${one.id}`),
      ),
    );
    const skillIds = new Set(skills.map((skill) => `skill:${skill.id}`));
    const opens = async (id: string) => {
      if (id.startsWith("skill:")) return skillIds.has(id);
      if (id.startsWith("toolkit:")) return toolkits.has(id);
      for (const source of knowledge) if (await source.page(id)) return true;
      return false;
    };

    const named = skills.flatMap((skill) =>
      [
        ...skill.instructions.matchAll(
          /\b(?:skill|toolkit|doc|function):[a-z0-9-]+\/[\w.-]*\w/g,
        ),
      ].map((found) => ({ skill: skill.id, id: found[0] })),
    );
    const missing = [];
    for (const one of named)
      if (!(await opens(one.id))) missing.push(`${one.skill} names ${one.id}`);

    expect(named.length).toBeGreaterThan(0);
    expect(missing).toEqual([]);
  });
});
