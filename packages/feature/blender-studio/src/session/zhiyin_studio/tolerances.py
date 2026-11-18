"""
How near is near enough, in metres, for the measures that ask whether two surfaces touch, hold,
rest on or go into each other. Each value is defined once here; they differ where the question
differs, and each line says which question it answers.
"""

# Surfaces nearer than this touch, and the gap between them is said as 0 mm; a point this near a
# surface is on it, as a stroke's point laid on a sculpted surface or a wrapped point on its target.
TOUCH = 0.0001

# How far a shape's points are moved in, at most, before asking whether they lie inside another,
# so one resting on or against another is not taken to go into it.
INSET = 0.0005
# A thin sheet's points are moved in by this share of its thickness instead, when that is less,
# so lettering on a jar is still measured as a sheet.
THIN_SHARE = 0.25

# How near two surfaces are for one to hold the other: a running clearance, as a pin turning in
# its bore.
HELD = 0.001

# The gap Blender's rigid-body physics keeps round each shape.
PHYSICS_MARGIN = 0.0005

# Once rigid bodies have settled, a body nearer than this to another rests on it: the physics
# keeps PHYSICS_MARGIN between them.
SETTLED_ON = 0.002

# Deeper than this, one body is inside another's collision shape rather than resting on it.
INSIDE_COLLIDER = 0.001

# In a report of keyed motion, a part this near what is under it rests on it.
RESTS_IN_MOTION = 0.002

# A foot or a wheel this far or less into what it stands on rests on it.
STANDS_IN = 0.001

# Set down on several supports, how near another must come, once the object has landed, to be
# rested on too.
ALSO_RESTS_ON = 0.0005

# A bone's point is out of the body it was fitted to when farther than this outside it: a joint
# fitted to the body's sections sits on its surface or within this of it, as HELD's clearance.
BONE_OUT = 0.001
