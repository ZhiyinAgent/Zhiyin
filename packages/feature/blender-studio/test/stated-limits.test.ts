/**
 * The limits a motion is held to, as the model reads them before a call:
 * the longest timeline, the longest video and the longest formula a part
 * follows another by. Blender refuses a call past one, naming the limit and
 * how to work within it.
 */

import { describe, expect, it } from "vitest";
import { studioTools } from "../src/index.js";

type Schema = {
  readonly description?: string;
  readonly maximum?: number;
  readonly maxLength?: number;
  readonly properties?: Record<string, Schema>;
  readonly items?: Schema;
};

const tool = (name: string) => studioTools.find((one) => one.name === name);
const inputOf = (name: string) =>
  tool(name)?.inputSchema as unknown as Schema | undefined;

describe("a motion's limits", () => {
  it("states the longest timeline, 600 s, on the length a timeline is given", () => {
    expect(inputOf("blender_animate")?.properties?.["duration"]).toEqual({
      type: "number",
      maximum: 600,
      description:
        "How long the timeline lasts, in seconds, at most 600, the longest a timeline runs.",
    });
  });

  it("states the longest video, 300 s, and that a longer one is rendered in parts", () => {
    const video = inputOf("blender_render_video");

    expect(tool("blender_render_video")?.description).toContain(
      "A video lasts at most 300 s: render a longer one in parts, each with its own start and end.",
    );
    expect(video?.properties?.["start"]?.maximum).toBe(600);
    expect(video?.properties?.["end"]?.maximum).toBe(600);
  });

  it("states the longest formula a part follows another by, 500 characters", () => {
    const formula =
      inputOf("blender_animate")?.properties?.["follow"]?.items?.properties?.[
        "formula"
      ];

    expect(formula?.maxLength).toBe(500);
    expect(formula?.description).toContain("At most 500 characters.");
  });

  it("offers an area light's shapes, which Blender draws, a strip among them", () => {
    const light = inputOf("blender_set_lighting")?.properties?.["lights"]?.items
      ?.properties?.["shape"];

    expect(light).toMatchObject({
      type: "string",
      enum: ["square", "rectangle", "disk", "ellipse"],
    });
    expect(light?.description).toContain("round softbox");
    expect(light?.description).toContain("strip light");
  });
});
