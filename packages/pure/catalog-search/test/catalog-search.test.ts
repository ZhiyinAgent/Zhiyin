import { describe, expect, it } from "vitest";
import type { ApiBreak, CatalogEntry } from "@zhiyin/contract";
import { catalogIndex, matchBreaks } from "../src/index.js";

function entry(
  id: string,
  title: string,
  summary: string,
  terms?: readonly string[],
): CatalogEntry {
  const kind = id.slice(0, id.indexOf(":")) as CatalogEntry["kind"];
  return {
    id,
    kind,
    title,
    summary,
    plugin: "3d-rendering",
    ...(terms ? { terms } : {}),
  };
}

const catalog = [
  entry(
    "toolkit:3d-rendering/surfacing",
    "Surfacing",
    "Give objects materials and finishes.",
    ["blender_set_material", "Set material", "finish", "base_color"],
  ),
  entry(
    "toolkit:3d-rendering/light-and-camera",
    "Light and camera",
    "Place the camera and light the scene.",
    ["blender_set_camera", "blender_set_lighting", "focal_length"],
  ),
  entry(
    "skill:3d-rendering/scene-stages",
    "scene-stages",
    "The stages of a 3D job and what must hold before each moves on.",
    ["brief", "block-out", "model"],
  ),
  entry(
    "doc:blender/5.2/bpy.types.NodesModifier",
    "bpy.types.NodesModifier",
    "A modifier that runs a geometry nodes group; its inputs are read by identifier in Blender 5.2.",
  ),
  entry(
    "function:cad/build123d.fillet",
    "fillet",
    "Rounds the chosen edges of a part.",
    ["radius", "edge_list"],
  ),
  entry(
    "break:blender/5.2/socket-index",
    "Geometry nodes input by index",
    "Reading a modifier input by its old index fails in Blender 5.2.",
  ),
  entry(
    "doc:3d-rendering/materials-zh",
    "材质与表面",
    "为物体设置材质和表面处理。",
  ),
];

const ids = (found: readonly { entry: CatalogEntry }[]) =>
  found.map((match) => match.entry.id);

describe("finding catalog entries", () => {
  it("ranks the entry whose title matches above one that matches only in its terms", () => {
    const index = catalogIndex([
      entry("doc:a", "Notes", "Unrelated words.", ["material"]),
      entry("doc:b", "Material", "Unrelated words."),
    ]);

    expect(ids(index.find("material"))).toEqual(["doc:b", "doc:a"]);
  });

  it("puts the entry named as the query first, case and all, above entries that only share its words", () => {
    const index = catalogIndex([
      entry(
        "doc:build123d/0.13/edge",
        "build123d.edge",
        "The edge of a shape: an edge, its edges, the one edge.",
      ),
      entry("doc:build123d/0.13/edges", "build123d.edges", "Edges of a shape."),
      entry("doc:build123d/0.13/Edge", "build123d.Edge", "A curve in space."),
    ]);

    expect(ids(index.find("Edge"))[0]).toBe("doc:build123d/0.13/Edge");
    expect(ids(index.find("edge"))[0]).toBe("doc:build123d/0.13/edge");
    expect(ids(index.find("build123d.Edge"))[0]).toBe(
      "doc:build123d/0.13/Edge",
    );
  });

  it("puts an entry named as the query in another case next, above entries that only share its words", () => {
    const index = catalogIndex([
      entry(
        "doc:build123d/0.13/Locations",
        "build123d.Locations",
        "Location after location: each location in a list of locations.",
      ),
      entry("doc:build123d/0.13/Location", "build123d.Location", "A place."),
    ]);

    expect(ids(index.find("location"))[0]).toBe("doc:build123d/0.13/Location");
  });

  it("puts the owner of a member asked for by its dotted name first", () => {
    const index = catalogIndex([
      entry(
        "doc:build123d/0.13/offset",
        "build123d.offset",
        "Offset a shape: an offset outward or inward.",
      ),
      entry("doc:build123d/0.13/Plane", "build123d.Plane", "A flat plane."),
    ]);

    expect(ids(index.find("Plane.offset"))[0]).toBe("doc:build123d/0.13/Plane");
  });

  it("ranks a word among an entry's other names as in its title, above one in the summary", () => {
    const index = catalogIndex([
      entry("doc:a", "build123d.fillet", "Notes.", ["round"]),
      entry("doc:b", "build123d.fillet", "Round notes."),
      {
        ...entry("doc:c", "build123d.fillet", "Notes."),
        aliases: ["round"],
      },
      entry("doc:d", "Round fillet", "Notes."),
    ]);

    const found = index.find("round");
    const score = (id: string) =>
      found.find((match) => match.entry.id === id)?.score;

    expect(ids(found).slice(0, 2).sort()).toEqual(["doc:c", "doc:d"]);
    expect(score("doc:c")).toBeGreaterThan(score("doc:b")!);
    expect(score("doc:b")).toBeGreaterThan(score("doc:a")!);
  });

  it("ranks a match in the summary above one in the terms", () => {
    const index = catalogIndex([
      entry("doc:a", "Notes", "Unrelated words.", ["camera"]),
      entry("doc:b", "Notes", "Where the camera goes."),
    ]);

    expect(ids(index.find("camera"))).toEqual(["doc:b", "doc:a"]);
  });

  it("splits snake_case, camelCase and dotted names into their words, ignoring case", () => {
    const index = catalogIndex(catalog);

    expect(ids(index.find("set material")).at(0)).toBe(
      "toolkit:3d-rendering/surfacing",
    );
    expect(ids(index.find("NodesModifier")).at(0)).toBe(
      "doc:blender/5.2/bpy.types.NodesModifier",
    );
    expect(ids(index.find("FOCAL LENGTH")).at(0)).toBe(
      "toolkit:3d-rendering/light-and-camera",
    );
    expect(ids(index.find("baseColor")).at(0)).toBe(
      "toolkit:3d-rendering/surfacing",
    );
  });

  it("finds the entry an error's words point at, version included", () => {
    const index = catalogIndex(catalog);

    expect(
      ids(index.find("geometry nodes modifier input 5.2")).slice(0, 2).sort(),
    ).toEqual([
      "break:blender/5.2/socket-index",
      "doc:blender/5.2/bpy.types.NodesModifier",
    ]);
  });

  it("matches a word written singular to its plural and back", () => {
    const plurals = catalogIndex([
      entry("break:blender/5.2/channels", "Actions keep fcurves in slots", ""),
      entry("doc:blender/5.2/bpy.types.Mesh", "Mesh properties", ""),
      entry("doc:blender/5.2/bpy.types.Axis", "Axis and class", ""),
      entry("doc:blender/5.2/bpy.data", "bpy.data.meshes and brushes", ""),
    ]);
    const ids = (query: string) =>
      plurals.find(query).map((hit) => hit.entry.id);
    expect(ids("action fcurve")).toEqual(["break:blender/5.2/channels"]);
    expect(ids("property")).toEqual(["doc:blender/5.2/bpy.types.Mesh"]);
    expect(ids("brush")).toEqual(["doc:blender/5.2/bpy.data"]);
    expect(ids("mesh")).toContain("doc:blender/5.2/bpy.data");
    // Words that only end in s are not plurals.
    expect(ids("axi")).toEqual([]);
    expect(ids("clas")).toEqual([]);
  });

  it("compares Chinese text by pairs of characters", () => {
    const index = catalogIndex(catalog);

    expect(ids(index.find("怎么设置材质"))).toEqual([
      "doc:3d-rendering/materials-zh",
    ]);
    expect(ids(index.find("表面"))).toEqual(["doc:3d-rendering/materials-zh"]);
  });

  it("finds Chinese and Latin words written together", () => {
    const index = catalogIndex([
      entry("doc:a", "Blender材质", "Notes."),
      entry("doc:b", "Blender", "Notes."),
    ]);

    expect(ids(index.find("材质")).at(0)).toBe("doc:a");
    expect(ids(index.find("blender"))).toEqual(["doc:b", "doc:a"]);
  });

  it("returns only entries of the kind asked for", () => {
    const index = catalogIndex(catalog);

    const found = index.find("geometry nodes input 5.2", { kind: "break" });

    expect(ids(found)).toEqual(["break:blender/5.2/socket-index"]);
  });

  it("returns the best five unless a limit is given, best first with scores", () => {
    const many = Array.from({ length: 8 }, (_, number) =>
      entry(
        `doc:${number}`,
        number === 6 ? "Camera notes, camera" : "Camera notes",
        "Notes.",
      ),
    );
    const index = catalogIndex(many);

    const five = index.find("camera");
    const two = index.find("camera", { limit: 2 });

    expect(five).toHaveLength(5);
    expect(five[0]?.entry.id).toBe("doc:6");
    expect(two).toHaveLength(2);
    const scores = five.map((match) => match.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
    expect(scores.every((score) => score > 0)).toBe(true);
  });

  it("returns nothing for a query that matches nothing, or has no words", () => {
    const index = catalogIndex(catalog);

    expect(index.find("spreadsheet pivot")).toEqual([]);
    expect(index.find("  ...  ")).toEqual([]);
    expect(catalogIndex([]).find("material")).toEqual([]);
  });
});

describe("matching an error to known API changes", () => {
  const breaks: readonly ApiBreak[] = [
    {
      pattern: String.raw`KeyError: .*Socket_\d+`,
      wrong: 'modifier["Socket_2"] = 3',
      right: "modifier[input.identifier] = 3",
      see: ["doc:blender/5.2/bpy.types.NodesModifier"],
    },
    {
      pattern: "has no attribute 'fcurves'",
      wrong: "action.fcurves",
      right: "action.layers[0].strips[0].channelbag(slot).fcurves",
      see: [],
    },
    { pattern: "([unclosed", wrong: "", right: "", see: [] },
    {
      pattern: "use_auto_smooth|fcurves",
      wrong: "mesh.use_auto_smooth = True",
      right: "a Smooth by Angle modifier",
      see: [],
    },
  ];

  it("returns every change whose pattern the error matches, in the table's order", () => {
    const error = "AttributeError: 'Action' object has no attribute 'fcurves'";

    expect(matchBreaks(breaks, error)).toEqual([breaks[1], breaks[3]]);
  });

  it("matches by regular expression", () => {
    expect(
      matchBreaks(
        breaks,
        "KeyError: 'bpy_struct[key]: key \"Socket_12\" not found'",
      ),
    ).toEqual([breaks[0]]);
  });

  it("treats a pattern that is not a valid regular expression as matching nothing", () => {
    expect(() => matchBreaks(breaks, "([unclosed")).not.toThrow();
    expect(matchBreaks(breaks, "([unclosed")).toEqual([]);
  });

  it("returns nothing for an error no change explains", () => {
    expect(matchBreaks(breaks, "ZeroDivisionError: division by zero")).toEqual(
      [],
    );
  });
});
