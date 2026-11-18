import { describe, expect, it } from "vitest";
import { sceneToShow } from "../src/index.js";

const picture = {
  data: "",
  width: 640,
  height: 360,
  view: "overview" as const,
  sequence: 1,
};

describe("sceneToShow", () => {
  it("is a scene once a file is open or a picture of it was drawn", () => {
    expect(
      sceneToShow({
        status: "open",
        file: "desk.blend",
        view: "overview",
        working: true,
      }),
    ).toBe(true);
    expect(
      sceneToShow({
        status: "open",
        view: "overview",
        working: false,
        preview: picture,
      }),
    ).toBe(true);
    // Blender starting again for a file it had open still shows that file.
    expect(
      sceneToShow({
        status: "starting",
        file: "desk.blend",
        view: "overview",
        working: false,
      }),
    ).toBe(true);
  });

  it("is no scene while Blender is starting for the first time, or failed before it had one", () => {
    expect(
      sceneToShow({ status: "starting", view: "overview", working: false }),
    ).toBe(false);
    expect(
      sceneToShow({
        status: "failed",
        view: "overview",
        working: false,
        reason: "Blender is not installed.",
      }),
    ).toBe(false);
    expect(
      sceneToShow({ status: "closed", view: "overview", working: false }),
    ).toBe(false);
  });
});
