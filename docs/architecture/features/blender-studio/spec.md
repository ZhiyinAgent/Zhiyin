# 3D studio: the spec

Invariants of the [3D studio](README.md): how a scene is measured against its
requirements, and what the answer and the person's card say. The README holds
what the studio is for, its interface and the invariants that hold for every
call. Each invariant here is covered by a test.

## The spec

- **A scene is measured against its spec.** The spec is requirements.json
  beside the scene file, or at the workspace's top, the requirements format
  both studios share. After every change, and when a scene is opened or
  described, Blender measures each requirement on the meshes in the same
  command: the shared kinds that mean the same on a mesh (size, fits,
  clearance, separate, wall, overhang) and the 3D kinds (thickness, width, reach,
  rests on, below, above, joined, inside, count, faces drawn, in view,
  separate in motion). A
  kind only the CAD studio measures is read and said to be measured there.
  A part named by a pattern that matches several objects is measured on
  each of them, the worst deciding whether it holds: the answer names that
  one and gives each of the others' measures in brief.
  Thickness and width are measured from the material's own side of each
  face, whichever way the face points, and never across a corner. How near
  two parts come, for clearance and joined, is measured surface to surface,
  so crossed boards are measured where their faces meet and boards face to
  face touch. Rests on is measured straight up and down between the part
  and what is under it, from points of both, so a top on legs inset under
  it rests on them. Inside is the solid of the parts it is to be inside, or
  the space they wall in together on every level side and below, so a
  room's notch is outside it and a room may be walls and a separate floor;
  a part outside is said with its farthest point out and how far that point
  is from their surface. Count and faces include every instance drawn, and
  joined tells up to 5,000 pieces of a part apart. Separate in motion steps
  the timeline, every frame or every so many, from a start to an end, the
  timeline's by default, and measures what goes into what at each as a
  motion report does, on the parts' surfaces; it holds when no overlap goes
  deeper than its limit, none by default, and says the deepest, between
  which parts, when, and over which spans. A cloth among the parts fails
  where its edges go through a closed other, however shallow its points go
  into it, measured as a bake measures a cloth, and the answer says what it
  goes through, when and how much of it. Those requirements are measured
  after the ones of the scene's moment, and the scene is set back at its
  own moment after them; one cut short by the time with nothing past its
  limit found is said not checked. A part moved by a simulation is
  measured from its bake alone: one whose simulation is not baked, or baked
  over frames short of those asked, is said not checked, with the fix of
  baking it, so no change waits while a simulation is stepped from its
  start; keyed motion and baked simulations are measured. The measures take at most
  30 s together, or half of what is left of the command's time when that is
  less, checked inside every measure, so a spec over hundreds of parts never
  holds a command past its time: what is left is said not checked, with the
  seconds the measures had, and a clearance cut short that already fails is said with the
  nearest gap found.
- **The spec's answer gives only what does not hold.** It says how many of
  the requirements checked hold, then each failure with its measure and
  how far past the limit, and its margin's move since the last change; those
  not checked are said with why, one line for each reason. The person's
  checks card shows every verdict. A requirement that failed and left the
  file is named once.
- **A spec that cannot be read never stops a change.** The change goes ahead,
  and the answer and the card say which requirement and field to mend.
  Measuring that fails in Blender is said, and the change stands.
- **The spec's verdicts are kept with the conversation.** The last verdicts
  of each spec and scene are kept in the conversation's own folder, so a
  margin moves from the last change's even after condensing or a restart.
- **The block-out is offered once.** The first time every size and fits
  requirement holds after a change, the answer carries a small picture of
  the scene, and the card says the person may step in while changes are
  cheap; the work goes on unless they do. It is never offered again for the
  same spec and scene.
