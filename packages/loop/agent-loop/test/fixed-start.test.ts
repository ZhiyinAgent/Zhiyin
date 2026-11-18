/**
 * The start of a turn's requests, its system messages and its tools, is what
 * a provider caches; opening the catalog's entries leaves it as it was, and
 * activating a plugin changes it only by that plugin's core tools, once
 * (ADR 0017).
 */

import { describe, expect, it } from "vitest";
import {
  overCatalog,
  startOf,
  toolNames,
  type MadeUpPlugin,
  type Step,
} from "./catalog-fixture.js";

const rendering: MadeUpPlugin = {
  id: "3d-rendering",
  cores: ["open_scene"],
  toolkits: [{ id: "surfacing", tools: ["set_material"] }],
  skills: [
    {
      id: "staging",
      description: "Stage a scene.",
      text: "Block out the scene first.",
    },
  ],
  specialists: [{ id: "scene-checker", description: "Checks a scene." }],
};

const writing: MadeUpPlugin = {
  id: "writing",
  cores: ["outline"],
  skills: [
    { id: "plain-style", description: "Write plainly.", text: "Be brief." },
  ],
  specialists: [{ id: "editor", description: "Edits prose." }],
};

function steps(...script: Step[]): (request: number) => Step {
  return (request) => script[request - 1] ?? { text: "Done." };
}

describe("the start of a turn's requests", () => {
  it("is the same, byte for byte, after a skill and a toolkit are opened and an opened tool is called", async () => {
    const fixture = overCatalog({
      plugins: [rendering, writing],
      route: "bridge",
      script: steps(
        {
          calls: [
            {
              name: "open",
              id: "skill",
              args: { id: "skill:3d-rendering/staging" },
            },
          ],
        },
        {
          calls: [
            {
              name: "open",
              id: "toolkit",
              args: { id: "toolkit:3d-rendering/surfacing" },
            },
          ],
        },
        {
          calls: [
            {
              name: "call",
              id: "paint",
              args: { name: "set_material", arguments: { path: "cube" } },
            },
          ],
        },
      ),
    });
    const taskId = await fixture.loop.createTask(["3d-rendering"]);
    await fixture.loop.start(taskId, "Paint the cube");

    expect(fixture.ran).toEqual([
      { name: "set_material", args: { path: "cube" } },
    ]);
    const starts = fixture.requests.map(startOf);
    expect(starts).toHaveLength(4);
    for (const start of starts) expect(start).toBe(starts[0]);
  });

  it("changes when a plugin is activated only by its core tools added, the system messages as they were", async () => {
    const fixture = overCatalog({
      plugins: [rendering, writing],
      route: "bridge",
      script: steps({
        calls: [
          {
            name: "open",
            id: "skill",
            args: { id: "skill:writing/plain-style" },
          },
        ],
      }),
    });
    const taskId = await fixture.loop.createTask(["3d-rendering"]);
    await fixture.loop.start(taskId, "Edit my essay");

    const [before, after] = fixture.requests;
    const system = (request: typeof before) =>
      JSON.stringify(
        (request?.messages ?? []).filter(
          (message) => message.role === "system",
        ),
      );
    expect(system(after)).toBe(system(before));
    expect(toolNames(after).filter((name) => name !== "outline")).toEqual(
      toolNames(before),
    );
    expect(toolNames(after)).toContain("outline");
    expect(
      JSON.stringify(
        (after?.tools ?? []).filter((tool) => tool.name !== "outline"),
      ),
    ).toBe(JSON.stringify(before?.tools));
  });
});
