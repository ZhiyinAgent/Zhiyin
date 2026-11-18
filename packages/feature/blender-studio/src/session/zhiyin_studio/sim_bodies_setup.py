"""
Rigid bodies set up: each group given its role, collision shape, mass and contact, and the world
its gravity, substeps and solver iterations over the scene's timeline. An active body's mass is its
measured volume times a density, a material's from Blender's own table, or a mass given. Bodies
that would start inside each other, by their shapes or inside another's convex collision shape,
are refused before anything changes: the physics throws them apart.
"""

import bmesh
import bpy
import mathutils
import mathutils.bvhtree

from . import overlaps
from .arguments import need, number, vector, whole
from .errors import Refused
from .finding import find_objects, is_helper, scene
from .geometry import sampled, world_mesh
from .placing import keyed_paths
from .shown_mesh import is_inside
from .timeline import fps, seconds_of, seconds_text
from .tolerances import INSIDE_COLLIDER, PHYSICS_MARGIN
from .wording import clean, length, volume_text

SHAPES = {
    "hull": "CONVEX_HULL",
    "mesh": "MESH",
    "box": "BOX",
    "sphere": "SPHERE",
    "cylinder": "CYLINDER",
    "capsule": "CAPSULE",
    "cone": "CONE",
}
NAMED = {kind: name for name, kind in SHAPES.items()}
ROLES = ("active", "passive", "animated")
# Blender's own densities in kg/m³, as its Calculate Mass offers them.
DENSITIES = {
    "Air": 1.0, "Acrylic": 1400.0, "Asphalt (Crushed)": 721.0, "Bark": 240.0, "Beans (Cocoa)": 593.0,
    "Beans (Soy)": 721.0, "Brick (Pressed)": 2400.0, "Brick (Common)": 2000.0, "Brick (Soft)": 1600.0,
    "Brass": 8216.0, "Bronze": 8860.0, "Carbon (Solid)": 2146.0, "Cardboard": 689.0, "Cast Iron": 7150.0,
    "Chalk (Solid)": 2499.0, "Concrete": 2320.0, "Charcoal": 208.0, "Cork": 240.0, "Copper": 8933.0,
    "Garbage": 481.0, "Glass (Broken)": 1940.0, "Glass (Solid)": 2190.0, "Gold": 19282.0,
    "Granite (Broken)": 1650.0, "Granite (Solid)": 2691.0, "Gravel": 2780.0, "Ice (Crushed)": 593.0,
    "Ice (Solid)": 919.0, "Iron": 7874.0, "Lead": 11342.0, "Limestone (Broken)": 1554.0,
    "Limestone (Solid)": 2611.0, "Marble (Broken)": 1570.0, "Marble (Solid)": 2563.0, "Paper": 1201.0,
    "Peanuts (Shelled)": 641.0, "Peanuts (Not Shelled)": 272.0, "Plaster": 849.0, "Plastic": 1200.0,
    "Polystyrene": 1050.0, "Rubber": 1522.0, "Silver": 10501.0, "Steel": 7860.0, "Stone": 2515.0,
    "Stone (Crushed)": 1602.0, "Timber": 610.0,
}
# Blender's least mass for a rigid body.
LEAST_MASS = bpy.types.RigidBodyObject.bl_rna.properties["mass"].hard_min
# A shape holding this share of its convex hull's volume is convex.
CONVEX = 0.99
# A body's friction and bounce: least, most and by default.
FRICTION = (0, 100, 0.5)
BOUNCE = (0, 1, 0)


class Body:
    """One object as a call gives it to the physics, before anything is changed."""

    def __init__(self, obj, role, shape, friction, bounce, weighed):
        self.obj, self.role, self.shape = obj, role, shape
        self.friction, self.bounce, self.weighed = friction, bounce, weighed
        # Whether its shape was chosen for it rather than given.
        self.chosen = False


def role_of(obj):
    body = obj.rigid_body
    if body.type == "PASSIVE":
        return "animated" if body.kinematic else "passive"
    return "animated" if body.kinematic else "active"


def rigid_objects():
    """Every object in the scene given to the rigid-body physics, in the scene's order."""
    return [o for o in scene().objects if o.rigid_body is not None]


def volume_of(obj):
    """An object's closed volume in the world, in m³, or None when its shape is not closed."""
    bm = world_mesh(obj)
    try:
        closed = bool(bm.faces) and all(edge.is_manifold for edge in bm.edges)
        return abs(bm.calc_volume()) if closed else None
    finally:
        bm.free()


def hull_of(points):
    """The convex hull round points, alone in a mesh of its own; None when they hold no volume."""
    bm = bmesh.new()
    for point in points:
        bm.verts.new(point)
    if len(bm.verts) < 4:
        bm.free()
        return None
    made = bmesh.ops.convex_hull(bm, input=list(bm.verts))
    left = {v for v in [*made["geom_interior"], *made["geom_unused"]] if isinstance(v, bmesh.types.BMVert)}
    bmesh.ops.delete(bm, geom=list(left), context="VERTS")
    if not bm.faces:
        bm.free()
        return None
    return bm


def is_convex(obj):
    """Whether a shape is closed and fills its convex hull, to a hundredth of its volume."""
    bm = world_mesh(obj)
    try:
        if not bm.faces or not all(edge.is_manifold for edge in bm.edges):
            return False
        volume = abs(bm.calc_volume())
        hull = hull_of([v.co for v in bm.verts])
    finally:
        bm.free()
    if hull is None:
        return False
    try:
        return volume >= CONVEX * abs(hull.calc_volume())
    finally:
        hull.free()


def default_shape(obj, role):
    """
    An active body is seen by its convex hull. A still one is seen by its hull where it is convex,
    as a block or a table top is, which the physics meets fastest, and by its mesh where it is not,
    as a bowl or a flat floor is, so a hollow stays open.
    """
    if role != "passive":
        return "hull"
    return "hull" if is_convex(obj) else "mesh"


def weighing(obj, role, given):
    """How an active body is weighed: by a material, a density or a mass. Others have none."""
    asked = [key for key in ("density", "material", "mass") if given.get(key) is not None]
    if role != "active":
        need(not asked, f"“{obj.name}” is {role}, which nothing moves, so it has no mass: leave out density, material and mass.")
        return None
    need(len(asked) == 1, f"Weigh “{obj.name}” by exactly one of density, material and mass.")
    if asked == ["mass"]:
        return ("mass", number(given["mass"], "mass", minimum=LEAST_MASS), None)
    if asked == ["material"]:
        wanted = str(given["material"]).strip().lower()
        found = next((name for name in DENSITIES if name.lower() == wanted), None)
        need(found is not None, f"{given['material']} is not in Blender's table of materials: {', '.join(DENSITIES)}.")
        return ("material", DENSITIES[found], found)
    return ("density", number(given["density"], "density", minimum=0.001), None)


def planned(groups):
    """The bodies a call gives, each checked: what it is, how it moves, and how it is weighed."""
    need(isinstance(groups, list) and groups, "rigid lists groups of objects for the rigid-body physics.")
    bodies = {}
    for i, given in enumerate(groups):
        need(isinstance(given, dict), f"Each group of rigid is an object; rigid[{i}] is not.")
        names = given.get("objects")
        need(isinstance(names, list) and names, f"rigid[{i}].objects names the objects of the group.")
        role = given.get("role", "active")
        need(role in ROLES, f"rigid[{i}].role is active, passive or animated.")
        shape = given.get("shape")
        need(shape is None or shape in SHAPES, f"rigid[{i}].shape is {', '.join(SHAPES)}.")
        friction = number(given.get("friction"), "friction", minimum=FRICTION[0], maximum=FRICTION[1], default=FRICTION[2])
        bounce = number(given.get("bounce"), "bounce", minimum=BOUNCE[0], maximum=BOUNCE[1], default=BOUNCE[2])
        for obj in find_objects(names):
            need(obj.type == "MESH" and not is_helper(obj), f"“{obj.name}” is not a shape the physics can move or meet.")
            if obj.parent is not None:
                raise Refused(f"“{obj.name}” is attached to “{obj.parent.name}”, which the physics would pull it away from: detach it first.")
            keyed = bool(keyed_paths(obj))
            if role == "active":
                need(not keyed, f"“{obj.name}” moves by keys, which the physics would override: make it animated, or clear its motion first.")
            if role == "animated":
                need(keyed, f"“{obj.name}” has no keys to move it: key it with blender_animate first, or make it passive.")
            chosen = shape or default_shape(obj, role)
            body = Body(obj, role, chosen, friction, bounce, weighing(obj, role, given))
            body.chosen = shape is None
            bodies[obj.name] = body
    return list(bodies.values())


def existing(obj):
    """A body an earlier call set up, as it is."""
    body = obj.rigid_body
    return Body(obj, role_of(obj), NAMED.get(body.collision_shape, "hull"), body.friction, body.restitution, None)


def hull_tree(body):
    """A convex collision shape in the world, as a tree to test points against: its convex hull, or its box."""
    obj = body.obj
    if body.shape == "box":
        points = [obj.matrix_world @ mathutils.Vector(corner) for corner in obj.bound_box]
    else:
        shape = world_mesh(obj)
        points = [v.co.copy() for v in shape.verts]
        shape.free()
    hull = hull_of(points)
    if hull is None:
        return None
    try:
        return mathutils.bvhtree.BVHTree.FromBMesh(hull)
    finally:
        hull.free()


def depth_inside_hull(points, tree):
    """How deep the deepest of these points lies inside a convex shape's tree; 0 when none is inside."""
    deepest = 0.0
    for point in points:
        if is_inside(tree, point):
            found = tree.find_nearest(point)
            if found[0] is not None:
                deepest = max(deepest, found[3])
    return deepest


def shape_words(shape):
    return {"hull": "its convex hull", "box": "its box"}.get(shape, f"its {shape}, measured as its convex hull")


def refuse_overlaps(bodies):
    """Refuses bodies that start inside each other, or inside another's convex collision shape, with how deep."""
    for i, one in enumerate(bodies):
        for other in bodies[i + 1 :]:
            # Two still bodies never meet.
            if one.role == "passive" and other.role == "passive":
                continue
            found = overlaps.goes_into(one.obj, [other.obj])
            if found:
                depth = found[0][1]
                deep = f"{length(depth)} into" if depth else "inside"
                inside, outside = (one, other) if one.role != "passive" else (other, one)
                raise Refused(
                    f"“{inside.obj.name}” starts {deep} “{outside.obj.name}”: rigid bodies that start inside each other are thrown apart."
                    " Move it out first; blender_edit_objects rest_on sets it down on what is below."
                )
    for inner in bodies:
        points = None
        for outer in bodies:
            if outer is inner or outer.shape == "mesh" or (inner.role == "passive" and outer.role == "passive"):
                continue
            tree = hull_tree(outer)
            if tree is None:
                continue
            if points is None:
                bm = world_mesh(inner.obj)
                points = sampled(bm.verts)
                bm.free()
            depth = depth_inside_hull(points, tree)
            if depth > INSIDE_COLLIDER:
                raise Refused(
                    f"“{inner.obj.name}” starts {length(depth)} inside “{outer.obj.name}”'s collision shape, {shape_words(outer.shape)},"
                    f" which fills its hollow: give “{outer.obj.name}” shape mesh, so the physics sees the hollow."
                )


def world_settings(given):
    """The world's settings a call gives, checked: gravity, substeps a frame and solver iterations."""
    if given is None:
        return {}
    need(isinstance(given, dict), "world gives gravity, substeps and iterations.")
    settings = {}
    if given.get("gravity") is not None:
        settings["gravity"] = vector(given["gravity"], "world gravity")
    if given.get("substeps") is not None:
        settings["substeps"] = whole(given["substeps"], "world substeps", minimum=1, maximum=1000)
    if given.get("iterations") is not None:
        settings["iterations"] = whole(given["iterations"], "world iterations", minimum=1, maximum=1000)
    return settings


def ensure_world():
    room = scene()
    if room.rigidbody_world is None:
        with bpy.context.temp_override(scene=room):
            bpy.ops.rigidbody.world_add()
    world = room.rigidbody_world
    world.enabled = True
    # The world runs over the scene's timeline.
    world.point_cache.frame_start = room.frame_start
    world.point_cache.frame_end = room.frame_end
    return world


def set_world(settings):
    world = ensure_world()
    room = scene()
    if "gravity" in settings:
        room.use_gravity = True
        room.gravity = settings["gravity"]
    if "substeps" in settings:
        world.substeps_per_frame = settings["substeps"]
    if "iterations" in settings:
        world.solver_iterations = settings["iterations"]


def world_text():
    """The world as Blender holds it, and the timeline it runs over."""
    room = scene()
    world = room.rigidbody_world
    pull = "(" + ", ".join(f"{clean(g):.4g}" for g in room.gravity) + " m/s²)" if room.use_gravity else "none"
    return (
        f"Rigid-body world: gravity {pull}, {world.substeps_per_frame} substeps a frame, {world.solver_iterations} solver iterations,"
        f" over the timeline: {seconds_text(0)} to {seconds_text(seconds_of(room.frame_end))} at {fps():g} frames a second"
        f" (frames {room.frame_start} to {room.frame_end})."
    )


def chosen_words(body):
    if not body.chosen or body.role != "passive":
        return ""
    return ", as it is convex" if body.shape == "hull" else ", as it is not convex"


def give(body):
    """Gives one object to the physics as planned; the line saying how it was set up."""
    obj = body.obj
    if obj.rigid_body is None:
        with bpy.context.temp_override(object=obj, active_object=obj, selected_objects=[obj]):
            bpy.ops.rigidbody.object_add(type="ACTIVE" if body.role == "active" else "PASSIVE")
    rb = obj.rigid_body
    rb.type = "ACTIVE" if body.role == "active" else "PASSIVE"
    rb.kinematic = body.role == "animated"
    rb.collision_shape = SHAPES[body.shape]
    # Its shape with every step on it, as it is seen: a cup's hole is cut by a step.
    rb.mesh_source = "FINAL"
    rb.collision_margin = PHYSICS_MARGIN
    rb.friction = body.friction
    rb.restitution = body.bounce
    said = [f"{obj.name}: {'animated by its keys' if body.role == 'animated' else body.role}", f"collision shape {body.shape}" + chosen_words(body)]
    if body.role == "active":
        how, value, material = body.weighed
        if how == "mass":
            rb.mass = value
            said.append(f"{rb.mass:.4g} kg as given")
        else:
            volume = volume_of(obj)
            need(volume is not None, f"“{obj.name}” is not closed, so it has no volume to weigh: give its mass in kg.")
            wanted = volume * value
            rb.mass = max(LEAST_MASS, wanted)
            of = f" of {material}" if material else ""
            said.append(f"{rb.mass:.4g} kg ({volume_text(volume)}{of} at {value:g} kg/m³)")
            if wanted < LEAST_MASS:
                said[-1] += f", raised from {wanted:.3g} kg to Blender's least"
    said += [f"friction {rb.friction:.3g}", f"bounce {rb.restitution:.3g}"]
    return ", ".join(said) + "."


def set_up(groups, settings):
    """Sets up the bodies and the world a call gives; the lines saying how each was set up."""
    bodies = planned(groups) if groups is not None else []
    given = {b.obj.name for b in bodies}
    everyone = bodies + [existing(o) for o in rigid_objects() if o.name not in given]
    refuse_overlaps(everyone)
    set_world(settings)
    return [give(body) for body in bodies]
