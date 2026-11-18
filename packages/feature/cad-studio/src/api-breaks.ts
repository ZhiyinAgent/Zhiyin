/**
 * The changes between the build123d models were trained on and the one the
 * CAD environment holds (ADR 0024), each with the error or warning the old
 * form gives in it, which a build's answer meets with the new form. Each was
 * measured in the CAD environment: the old form gives the error matched, the
 * new one runs. bd_warehouse 0.2 to 0.4 removed no public name, method or
 * argument, so it has none.
 */

import type { ApiBreak } from "@zhiyin/contract";
import { pageOf } from "./library-versions.js";

/** A change, with the id its catalog entry goes by. */
export type CadBreak = ApiBreak & { readonly id: string };

const at = (name: string) => pageOf("build123d", name);

export const cadBreaks: readonly CadBreak[] = [
  {
    id: "add",
    pattern: String.raw`add\(\) is deprecated; use insert\(\) instead`,
    wrong: "add(shape) in a builder",
    right: "insert(shape)",
    see: [at("insert")],
  },
  {
    id: "to_tuple",
    pattern: String.raw`'(?:Vector|Location|Color|Vertex)' object has no attribute 'to_tuple'`,
    wrong: "v.to_tuple() of a Vector, Location, Color or Vertex",
    right: "tuple(v)",
    see: [at("Vector"), at("Location")],
  },
  {
    id: "to_wire",
    pattern: String.raw`'(?:Edge|Wire)' object has no attribute 'to_wire'`,
    wrong: "edge.to_wire()",
    right: "Wire(edge), or Wire([edge, ...]) for several",
    see: [at("Wire")],
  },
  {
    id: "to_axis",
    pattern: String.raw`'(?:Edge|Location)' object has no attribute 'to_axis'`,
    wrong: "edge.to_axis() or location.to_axis()",
    right: "Axis(edge) or Axis(location)",
    see: [at("Axis")],
  },
  {
    id: "to_plane",
    pattern: String.raw`'Axis' object has no attribute 'to_plane'`,
    wrong: "axis.to_plane()",
    right: "Plane(axis)",
    see: [at("Plane")],
  },
  {
    id: "make_plane",
    pattern: String.raw`type object 'Face' has no attribute 'make_plane'`,
    wrong: "Face.make_plane(plane)",
    right: "Face(plane)",
    see: [at("Face")],
  },
  {
    id: "relocate",
    pattern: String.raw`object has no attribute 'relocate'`,
    wrong: "shape.relocate(location)",
    right:
      "shape.moved(location) or shape.move(location) to move it by the location, shape.located(location) or shape.locate(location) to place it at the location",
    see: [at("Solid")],
  },
  {
    id: "is_planar_face",
    pattern: String.raw`object has no attribute 'is_planar_face'`,
    wrong: "face.is_planar_face",
    right: "face.is_planar",
    see: [at("Face")],
  },
  {
    id: "planar",
    pattern: String.raw`(?:location_at|locations)\(\) got an unexpected keyword argument 'planar'`,
    wrong: "location_at(d, planar=True) or locations(ds, planar=True)",
    right:
      "location_at(d, x_dir=v), v the way the location's x axis points, square to the edge",
    see: [at("Edge")],
  },
  {
    id: "is_inside",
    pattern: String.raw`Use BoundBox\.within\(\) instead`,
    wrong:
      "box.is_inside(other), which now asks whether box lies in other, the reverse of what it asked before 0.12",
    right: "small.within(big), or big.contains(small)",
    see: [at("BoundBox")],
  },
  {
    id: "new_edges",
    pattern: String.raw`Builder\.new_edges is deprecated`,
    wrong: "builder.new_edges",
    right: "builder.edges(Select.NEW)",
    see: [at("BuildPart"), at("Select")],
  },
  {
    id: "tangent-objects",
    pattern: String.raw`name '(?:PointArcTangentLine|PointArcTangentArc|ArcArcTangentLine|ArcArcTangentArc)' is not defined`,
    wrong:
      "PointArcTangentLine, PointArcTangentArc, ArcArcTangentLine or ArcArcTangentArc",
    right:
      "ConstrainedLines(arc, point) for lines tangent to an arc, ConstrainedArcs(one, two, radius=r) for arcs tangent to two curves; each gives every solution, and selector=lambda found: found[0] keeps one",
    see: [at("ConstrainedLines"), at("ConstrainedArcs")],
  },
  {
    id: "end_angle",
    pattern: String.raw`EllipticalCenterArc\.__init__\(\) got an unexpected keyword argument '(?:end_angle|angular_direction)'`,
    wrong: "EllipticalCenterArc(..., end_angle=a) or angular_direction=",
    right:
      "EllipticalCenterArc(center, x_radius, y_radius, start_angle=a, arc_size=s), s the angle it sweeps",
    see: [at("EllipticalCenterArc")],
  },
  {
    id: "workplane",
    pattern: String.raw`BuildLine\.__init__\(\) got an unexpected keyword argument 'workplane'`,
    wrong: "BuildLine(workplane=plane)",
    right: "BuildLine(plane)",
    see: [at("BuildLine")],
  },
];
