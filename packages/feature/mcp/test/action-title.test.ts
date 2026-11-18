/**
 * The title a connection's tool is shown by, in its approval and while a call
 * to it is written: the connection's name, then what the tool does, without
 * saying the connection's name twice.
 */

import { describe, expect, it } from "vitest";
import { actionTitle } from "../src/action-title.js";

describe("a connection tool's title", () => {
  it("names the connection, then what the tool does", () => {
    expect(actionTitle("Remote", "browser_navigate")).toBe(
      "Remote · Browser navigate",
    );
  });

  it("leaves out a word of the connection's name that the tool's name repeats", () => {
    expect(actionTitle("CAD studio", "cad_build")).toBe("CAD studio · Build");
    expect(actionTitle("Tavily", "tavily_search")).toBe("Tavily · Search");
    expect(actionTitle("3D studio", "blender_render")).toBe(
      "3D studio · Blender render",
    );
  });

  it("is the connection's name alone when the tool's name is only that", () => {
    expect(actionTitle("Weather", "weather")).toBe("Weather");
  });
});
