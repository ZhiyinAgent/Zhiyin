"""
blender_simulate's colliders: objects every cloth, soft body and particle system in the scene meets,
each given collision as its last step, so it is met as it is shown, after whatever deforms it. The
thickness kept on its outside is a tenth of the finest spacing of the cloths and soft bodies it is
for, as a cloth's own colliders are, or as given.
"""

from .arguments import need, number
from .finding import find_objects, scene
from .sim_cloth_setup import COLLISION_SHARE, spacing_of
from .wording import length, listed

# The thickness kept on a collider's outside when only particles meet it.
PARTICLES_ONLY = 0.005
# The least thickness Blender keeps on a collider's outside: less is raised to it.
THINNEST = 0.001


def simulated():
    """What in the scene meets colliders: (label, mesh or nothing, the collection it meets only, if any)."""
    found = []
    for obj in scene().objects:
        for step in obj.modifiers:
            if step.type == "CLOTH":
                found.append((f"the cloth on {obj.name}", obj, step.collision_settings.collection))
            elif step.type == "SOFT_BODY":
                found.append((f"the soft body on {obj.name}", obj, step.settings.collision_collection))
            elif step.type == "PARTICLE_SYSTEM" and step.particle_system.settings.type == "EMITTER":
                settings = step.particle_system.settings
                found.append((f"the particles {step.name} on {obj.name}", None, settings.collision_collection))
    return found


def apply(args):
    """The lines this part answers; none when the call gives no colliders."""
    given = args.get("colliders")
    if given is None:
        return []
    need(isinstance(given, dict) and isinstance(given.get("objects"), list) and given["objects"], "colliders names the objects simulations meet, in objects.")
    objects = find_objects(given["objects"])
    meeting = simulated()
    need(
        meeting,
        "The scene has no cloth, soft body or particles for colliders to meet. A rigid body collides by its own shape, and a liquid meets its obstacles.",
    )
    for obj in objects:
        need(obj.type == "MESH", f"“{obj.name}” is not a mesh, and only a mesh collides.")
        need(all(obj != mesh for _, mesh, _ in meeting), f"“{obj.name}” is simulated itself; it meets itself by its own self-collision.")
    spacings = [spacing_of(mesh) for _, mesh, _ in meeting if mesh is not None]
    if given.get("thickness") is not None:
        thickness = number(given["thickness"], "thickness", maximum=1)
        need(
            thickness >= THINNEST,
            f"colliders.thickness is at least {length(THINNEST)}, the least Blender keeps on a collider's outside:"
            f" {length(thickness)} was given.",
        )
        why = "as given"
    elif any(spacings):
        thickness = max(THINNEST, COLLISION_SHARE * min(s for s in spacings if s > 0))
        why = f"a tenth of the finest spacing, {length(min(s for s in spacings if s > 0))}"
    else:
        thickness, why = PARTICLES_ONLY, "for particles"
    said = []
    for obj in objects:
        modifier = next((m for m in obj.modifiers if m.type == "COLLISION"), None)
        if modifier is None:
            modifier = obj.modifiers.new("Collision", "COLLISION")
        index = list(obj.modifiers).index(modifier)
        if index != len(obj.modifiers) - 1:
            obj.modifiers.move(index, len(obj.modifiers) - 1)
        obj.collision.use = True
        obj.collision.thickness_outer = thickness
        steps = len(obj.modifiers) - 1
        said.append(f"{obj.name} (after its {steps} other step{'s' if steps != 1 else ''})" if steps else obj.name)
    lines = [
        f"Colliders {listed(said)}, each {length(thickness)} thick on the outside, {why}, met by {listed([label for label, _, _ in meeting])}."
    ]
    names = {o.name for o in objects}
    for label, _, only in meeting:
        if only is not None and not names <= {o.name for o in only.all_objects}:
            missing = sorted(names - {o.name for o in only.all_objects})
            lines.append(f"{label[0].upper() + label[1:]} meets only the collection {only.name}, which holds no {listed(missing)}: it passes through them.")
    if args.get("bake") is not True:
        lines.append("A simulation baked before does not see new colliders: bake again with bake true.")
    return lines
