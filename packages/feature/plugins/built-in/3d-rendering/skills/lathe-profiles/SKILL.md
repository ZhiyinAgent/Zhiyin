---
name: lathe-profiles
description: >-
  Use for anything turned about an axis, in the 3D studio or in CAD: bottles, flasks, vases, chess pieces, candlesticks, knobs, pulleys, wheels, shafts, rings and bushings, drawn as one profile and revolved.
metadata:
  stage: model features
  domain: product mechanical
  gate: Every turned object is closed, at its real height and widest diameter, with walls as thick as the real ones.
---

**A turned thing is one profile,** its cross-section from the axis outward, revolved once round the axis. Draw the profile from the real object's outline: its heights and radii in order, base to lip.

**Hollow things go up the outside and back down the inside.** Start on the axis at the base, run out and up the outside to the lip, cross the lip's thickness, and come back down the inside to the axis above the base, so the gap between the two runs is the wall. A tumbler 95 mm high, 72 mm across at its foot and 80 at its lip, with an 8 mm base and 3 mm walls, in the 3D studio, blender_add_objects with kind revolve, in metres as [radius, height]:

    "profile": [[0, 0], [0.036, 0], [0.04, 0.095], [0.037, 0.095], [0.033, 0.008], [0, 0.008]]

**Closing the profile.** A profile that starts and ends on the axis is closed by it; one that touches the axis at neither end, such as a ring's or a sleeve's, is a cross-section joined back to its first point. A bottle's inside runs down the neck and the shoulder as well, so it holds its liquid and lets light through as glass does.

**Curves are points close together.** Each point where the profile turns is a crease all the way round: a shoulder, a lip or a rounded foot is an arc of four to eight points, and only a real corner, such as a base's edge or a step, is one point. A rolled lip is a half circle of a few points across the wall. Read the outline at the three-quarter after adding it: a shoulder drawn with one point shows as a hard line round it.

**In CAD,** draw the profile on Plane.XZ, where the sketch's x is the radius and its y the height, and revolve it about Axis.Z, in millimetres:

    with BuildPart() as cup:
        with BuildSketch(Plane.XZ):
            with BuildLine():
                Polyline((0, 0), (40, 0), (42, 90), (39, 90), (37, 3), (0, 3), close=True)
            make_face()
        revolve(axis=Axis.Z)

**A groove, a step or a bore is part of the profile,** not a cut afterwards: a V-belt pulley's groove is two slanted lines in its outline, its bore the profile's inner edge kept off the axis. Arcs go in as ThreePointArc or a fillet on the sketch's corner, so the solid has true round faces. A part turned and then drilled across, as a knob with a set screw, is revolved first and cut after.

**Check the answer's size:** the widest diameter and the height are the real object's, and a hollow object's volume is its material, far less than its outside's.
