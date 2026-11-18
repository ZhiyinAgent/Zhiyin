---
name: cad-feature-order
description: >-
  Use when building a part in the CAD studio from more than a few features: the order features go in, from the base to the rounds, how to choose faces and edges by where they are, and what breaks a solid in two.
metadata:
  stage: sketch features
  domain: mechanical printing
  gate: The part is one valid solid after each group of features, its rounds added last, its holes the diameters planned.
  works-with: part-stages printable-parts lathe-profiles
---

**Build a part in the order it would be made,** so each feature finds the faces it needs and a failure points at one step.

1. **The base:** the main profile sketched on its plane and extruded, or revolved (skill:3d-rendering/lathe-profiles).
2. **What adds:** bosses, pads, ribs, flanges, each sketched on the face it stands on.
3. **What cuts:** pockets, slots and windows.
4. **Holes:** Hole, CounterBoreHole or CounterSinkHole at Locations, sized by radius, or a screw's own ClearanceHole, TapHole or InsertHole from bd_warehouse.fastener (skill:3d-rendering/printable-parts).
5. **Patterns:** a feature made once and placed with GridLocations, PolarLocations or HexLocations, never copied by hand.
6. **The shell,** after the outside rounds it should follow: the inside then follows them, an 8 mm round on a 2 mm wall coming out 6 mm inside, the wall even all round. Rounded after shelling, the corner inside stays sharp and the round eats into the wall there: on a 2 mm wall a 6 mm round leaves a third of a millimetre at the corner, and one of 7 mm or more fails.
7. **Rounds and chamfers last,** smallest edges and teeth left sharp: skill:3d-rendering/printable-parts says how wide.

**A feature joins only what it sinks into.** A rib or a boss that only touches its body, face to face or along a line, stays a separate solid: six ribs placed at a hub's radius make seven solids, and placed 3 mm inside it, one. cad_build's boss, pad and rib sink themselves; your own features must overlap what they stand on.

**Choose faces and edges by where they are,** never by their index, which changes as features are added:

    from build123d import *

    with BuildPart() as bracket:
        with BuildSketch():
            RectangleRounded(80, 50, 6)
        extrude(amount=8)
        with BuildSketch(bracket.faces().sort_by(Axis.Z)[-1]):
            Circle(12)
        extrude(amount=12)
        with Locations((0, 0, 20)):
            CounterBoreHole(radius=4.25, counter_bore_radius=7, counter_bore_depth=4, depth=20)
        with BuildSketch(bracket.faces().sort_by(Axis.Z)[0]):
            with GridLocations(60, 30, 2, 2):
                Circle(2.25)
        extrude(amount=-8, mode=Mode.SUBTRACT)
        root = bracket.edges().filter_by(GeomType.CIRCLE).group_by(Axis.Z)[1].sort_by(SortBy.RADIUS)[-1]
        fillet(root, radius=3)
    show(bracket, name="Bracket")

`faces().sort_by(Axis.Z)[-1]` is the top face and `[0]` the bottom; `edges().group_by(Axis.Z)[-1]` the edges at the top; `filter_by(Axis.Z)` the edges along z; `filter_by(GeomType.CIRCLE)` the round ones, and `sort_by(SortBy.RADIUS)` orders them by size. A sketch on the bottom face looks down, so a cut from it goes in with a negative amount. The same choices in other forms, by position, distance or measure, are on doc:3d-rendering/cad-build123d; there are no selector strings.

**Check after each group.** Run cad_build after each group of features: the answer's validity, size, faces by kind and hole diameters say whether the group did what it should, while the step is still the last one.
