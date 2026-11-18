/**
 * What a failed script's error means when the library's own words mislead: a
 * habit from CadQuery, which build123d does not share, and the geometry
 * kernel's errors, which never say what to change. Each pattern is matched
 * against the error as the answer quotes it, the script's lines included, so
 * a pattern may name the call on the line that failed. Each habit's error was
 * measured in the CAD environment.
 */

import { pageOf } from "./library-versions.js";

/** A known failure, the id it goes by, and what fixes it, in words. */
export type ScriptHint = {
  readonly id: string;
  readonly pattern: string;
  readonly says: string;
  readonly see?: readonly string[];
};

const at = (name: string) => pageOf("build123d", name);
const part = "doc:3d-rendering/cad-build123d";

/** A selector or method a script calls, on the line quoted as it failed. */
const called = (names: string) => String.raw`\.(?:${names})\(`;

export const cadQueryHabits: readonly ScriptHint[] = [
  {
    id: "workplane",
    pattern: String.raw`No module named 'cadquery'|name '(?:cq|Workplane)' is not defined`,
    says: `build123d is not CadQuery and has no cq or Workplane: a part is made in \`with BuildPart() as made:\`, a 2D shape in a BuildSketch inside it then extrude(amount=…), and the part is made.part. ${part} has CadQuery's forms beside build123d's.`,
    see: [at("BuildPart")],
  },
  {
    id: "string-selectors",
    pattern: String.raw`${called("faces|edges|vertices|wires|solids|shells|sort_by|filter_by|group_by")}\s*["']|'Axis' object has no attribute 'name'`,
    says: 'build123d has no selector strings such as faces(">Z") and its selectors take no axis: faces().sort_by(Axis.Z)[-1] is the top face and [0] the bottom, edges().filter_by(Axis.Z) the edges along z, edges().group_by(Axis.Z)[-1] those at the top, filter_by(GeomType.CIRCLE) the round ones.',
    see: [at("ShapeList")],
  },
  {
    id: "centered",
    pattern: String.raw`got an unexpected keyword argument 'centered'`,
    says: "build123d centres a Box, Cylinder or Sphere on its origin and takes align, not centered: align=(Align.CENTER, Align.CENTER, Align.MIN) sits it on z = 0, and align=(Align.MIN, Align.MIN, Align.MIN) puts its corner at the origin.",
    see: [at("Align")],
  },
  {
    id: "diameter",
    pattern: String.raw`(?:Hole|CounterBoreHole|CounterSinkHole|Cylinder|Cone|Circle|Sphere)\.__init__\(\) got an unexpected keyword argument '(?:diameter|d|dia)'`,
    says: "build123d sizes holes, circles and cylinders by radius: Hole(radius=d / 2), Circle(d / 2), Cylinder(d / 2, height).",
    see: [at("Hole")],
  },
  {
    id: "hole",
    pattern: String.raw`object has no attribute '(?:hole|cboreHole|cskHole)'`,
    says: "A hole is cut inside the BuildPart, at Locations, sized by radius: Hole(radius=d / 2), CounterBoreHole(radius, counter_bore_radius, counter_bore_depth) or CounterSinkHole(radius, counter_sink_radius); a screw's is ClearanceHole(screw) or TapHole(screw), from bd_warehouse.fastener.",
    see: [at("Hole"), pageOf("bd_warehouse", "fastener.ClearanceHole")],
  },
  {
    id: "shell",
    pattern: String.raw`shell\(\) takes 1 positional argument|object has no attribute 'shell'`,
    says: "A part is hollowed with offset(amount=-t, openings=faces) in its BuildPart, or offset(part, amount=-t, openings=faces): walls t thick inside its outside, the faces given left open.",
    see: [at("offset")],
  },
  {
    id: "translate",
    pattern: String.raw`Shape\.translate\(\) takes from 2 to 3 positional arguments|${called("rotate")}\s*\([\s\S]*'tuple' object has no attribute 'wrapped'`,
    says: "A shape moves by a location and turns about an axis: part.moved(Pos(x, y, z)) or Pos(x, y, z) * part, part.rotate(Axis.Z, angle) or Rot(Z=angle) * part; translate takes one (x, y, z).",
    see: [at("Location"), at("Axis")],
  },
  {
    id: "lowercase-axes",
    pattern: String.raw`Unexpected keyword arguments: [xyz]\b|Unexpected argument\(s\): [xyz]\b`,
    says: "Pos and Rot take capitals, Pos(X=10), Rot(Z=90), or the three numbers in order, Pos(10, 0, 0), Rot(0, 0, 90).",
    see: [at("Pos"), at("Rot")],
  },
  {
    id: "chain-methods",
    pattern: String.raw`has no attribute '(?:workplane|rect|box|circle|polygon|polyline|lineTo|moveTo|pushPoints|rarray|polarArray|cutBlind|cutThruAll|twistExtrude|union|val|vals|findSolid|toPending|exportStl|exportStep)'|name '(?:polarArray|rarray|pushPoints)' is not defined`,
    says: `build123d has no CadQuery chain methods: a sketch is drawn in \`with BuildSketch():\` inside the BuildPart, then extrude(amount=d), or extrude(amount=-d, mode=Mode.SUBTRACT) to cut; copies go \`with GridLocations(x, y, nx, ny):\` or \`with PolarLocations(r, n):\` around what they place; a + b joins and a - b cuts. ${part} has the table.`,
    see: [at("extrude"), at("GridLocations")],
  },
  {
    id: "list-fillet",
    pattern: String.raw`'ShapeList' object has no attribute '(?:fillet|chamfer)'`,
    says: "Edges are rounded by an operation or by their shape, not by their list: fillet(edges, radius=r) in a BuildPart, or part.fillet(r, edges); chamfer(edges, length=l) likewise.",
    see: [at("fillet")],
  },
  {
    id: "face-extrude",
    pattern: String.raw`Face\.extrude\(\) missing 1 required positional argument: 'direction'`,
    says: "A face is pulled into a solid with extrude(face, amount=d), or with extrude(amount=d) in a BuildPart after its BuildSketch.",
    see: [at("extrude")],
  },
  {
    id: "assembly",
    pattern: String.raw`name 'Assembly' is not defined`,
    says: "build123d has no cq.Assembly: show each part where it goes, show(part.moved(Location((x, y, z))), name=…), or join them with Compound(children=[…], label=…).",
    see: [at("Compound")],
  },
  {
    id: "exporters",
    pattern: String.raw`name 'exporters' is not defined|module 'build123d\.exporters' has no attribute 'export'|has no attribute 'export(?:Stl|Step|Svg|Dxf)'`,
    says: 'A script writes no files: name them in cad_build\'s exports, as { "path": "part.step" }, and cad_draw\'s outputs.',
  },
];

/** The kernel's errors, which say only that it failed. */
const kernel = String.raw`(?:StdFail_NotDone|Standard_\w+|BRep_API: command not done|Null TopoDS_Shape object)`;

export const kernelErrors: readonly ScriptHint[] = [
  {
    id: "fillet",
    pattern: String.raw`Failed creating a fillet with radius of`,
    says: "The kernel could not round these edges at that radius: most often it is wider than a face beside an edge leaves room for, or many edges meet at a corner. Round fewer edges at a time, the smallest first; part.max_fillet(edges, max_iterations=20) gives the largest radius those edges take (with its default 10 steps it gives up on most parts over about 25 mm), and round_edges(part, edges, radius) rounds what it can and says what it left.",
    see: [at("fillet")],
  },
  {
    id: "chamfer",
    pattern: String.raw`Failed creating a chamfer`,
    says: "The kernel could not chamfer these edges at that length: most often it is longer than a face beside an edge leaves room for. Chamfer fewer edges at a time, with a shorter length.",
    see: [at("chamfer")],
  },
  {
    id: "revolve",
    pattern: String.raw`\brevolve\([^\n]*\n[\s\S]*${kernel}`,
    says: "A revolve the kernel cannot make: its profile crosses the axis it turns about. Draw the profile on one side of the axis, in a plane holding it, as Plane.XZ for Axis.Z with x from the axis outward: Rectangle(w, h, align=(Align.MIN, Align.CENTER)) at x of 0 or more.",
    see: [at("revolve")],
  },
  {
    id: "offset",
    pattern: String.raw`\boffset\([^\n]*\n[\s\S]*${kernel}`,
    says: "An offset the kernel cannot make: the wall is thicker than the shape has room for somewhere, as half its thinnest section. Give a thinner wall.",
    see: [at("offset")],
  },
  {
    id: "kernel",
    pattern: kernel,
    says: "The geometry kernel could not make the shape on the line the error names, and its words never say why. Build that step on its own and print its inputs' sizes, as bounding_box(): most often a profile crosses itself or its axis, a wall or a round is larger than the shape has room for, or two shapes only touch along a line or at a point.",
  },
];
