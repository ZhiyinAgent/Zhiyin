"""
Caustics, the light glass and mirrors focus, which Cycles draws and EEVEE does not: reflective
and refractive caustics, the glossy filter that blurs them, and shadow caustics drawn by manifold
next-event estimation (MNEE) from chosen lights through chosen glass onto chosen surfaces, and
path guiding, which finds them sooner on the processor. Small Cycles pictures with caustics and
without measure the light they bring to what they fall on, and its noise.
"""

import numpy

from .arguments import need, number
from .finding import find_objects, scene
from .lighting_links import NAMED, with_parts
from .lighting_measure import DIM, SAMPLES, Measures, change, no_camera, noise, shown
from .material_marks import lets_light_through
from .seen import SMALLEST
from .wording import listed

# Glass whose material lets at least this share of the light through refracts it.
REFRACTS = 0.5
# Caustics are often a small bright spot, so they are measured in a larger
# picture than other lighting: this many pixels on its longest side.
SIDE = 192
# A pixel lit by caustics is brighter with them than without by this share or
# more; with the same seed both pictures are the same elsewhere. Caustic light
# is said to be found where this many pixels are.
BRIGHTER = 0.1
FOUND = 4


def refracts(obj):
    """Whether any of an object's materials lets light through, as glass does."""
    for slot in obj.material_slots:
        material = slot.material
        if material is None or not material.use_nodes:
            continue
        for node in material.node_tree.nodes:
            if node.type in ("BSDF_GLASS", "BSDF_REFRACTION"):
                return True
            if node.type == "BSDF_PRINCIPLED" and node.inputs["Transmission Weight"].default_value >= REFRACTS:
                return True
    return False


def flagged(objects, attribute, owner):
    """Sets a caustics flag on exactly the objects named, clearing it on every other."""
    named = {o.name for o in objects}
    for obj in scene().objects:
        holder = owner(obj)
        if holder is not None:
            setattr(holder, attribute, obj.name in named)


def set_caustics(spec):
    """Caustics as the call gives them; the line that says them."""
    need(isinstance(spec, dict), "caustics gives reflective, refractive, filter_glossy, casters, receivers or lights.")
    cycles = scene().cycles
    for key in ("reflective", "refractive"):
        if spec.get(key) is not None:
            need(isinstance(spec[key], bool), f"caustics {key} is true or false.")
            setattr(cycles, f"caustics_{key}", spec[key])
    if spec.get("filter_glossy") is not None:
        cycles.blur_glossy = number(spec["filter_glossy"], "filter_glossy", minimum=0, maximum=10)
    if spec.get("path_guiding") is not None:
        need(isinstance(spec["path_guiding"], bool), "caustics path_guiding is true or false.")
        cycles.use_guiding = spec["path_guiding"]
        if spec["path_guiding"]:
            cycles.use_surface_guiding = True
    if spec.get("casters") is not None:
        casters = [o for o in with_parts(spec["casters"], "caustics casters") if o.type == "MESH"]
        flagged(casters, "is_caustics_caster", lambda o: o.cycles if o.type == "MESH" else None)
    if spec.get("receivers") is not None:
        receivers = [o for o in with_parts(spec["receivers"], "caustics receivers") if o.type == "MESH"]
        flagged(receivers, "is_caustics_receiver", lambda o: o.cycles if o.type == "MESH" else None)
    if spec.get("lights") is not None:
        need(isinstance(spec["lights"], list), "caustics lights is a list of light names.")
        lights = find_objects(spec["lights"], {"LIGHT"})
        flagged(lights, "is_caustics_light", lambda o: o.data.cycles if o.type == "LIGHT" else None)
    return caustics_text()


def caustics_text():
    """What the scene's caustics are, in Cycles, and that EEVEE draws none."""
    s = scene()
    cycles = s.cycles
    on = [kind for kind in ("reflective", "refractive") if getattr(cycles, f"caustics_{kind}")]
    said = (
        "caustics, which Cycles draws and EEVEE does not: "
        + (f"{' and '.join(on)} on" if on else "reflective and refractive off")
        + f", glossy filter {cycles.blur_glossy:g} ("
        + ("blurring sharp light paths, which cuts their noise; 0 keeps them sharp)" if cycles.blur_glossy > 0 else "caustics kept sharp, and grainy)")
    )
    if cycles.use_guiding:
        said += (
            f"; path guiding on: over its first {cycles.guiding_training_samples} samples Cycles learns where light comes from"
            " and sends more paths that way, which finds caustics sooner, on the processor only: a picture drawn on a graphics card goes without it"
        )
    casters = [o for o in s.objects if o.type == "MESH" and o.cycles.is_caustics_caster]
    receivers = [o for o in s.objects if o.type == "MESH" and o.cycles.is_caustics_receiver]
    lights = [o for o in s.objects if o.type == "LIGHT" and o.data.cycles.is_caustics_light]
    if not (casters or receivers or lights):
        return said
    missing = [what for what, found in (("a light", lights), ("a caster", casters), ("a receiver", receivers)) if not found]
    if missing:
        return said + f"; shadow caustics (MNEE) need a light, a caster and a receiver, and have no {listed([m.split(' ', 1)[1] for m in missing], NAMED)} yet"
    said += (
        f"; shadow caustics (MNEE) from {listed([o.name for o in lights], NAMED)} through {listed([o.name for o in casters], NAMED)}"
        f" onto {listed([o.name for o in receivers], NAMED)}"
    )
    opaque = [o.name for o in casters if not refracts(o)]
    if opaque:
        one = len(opaque) == 1
        said += f"; {listed(opaque, NAMED)} {'lets' if one else 'let'} no light through, and MNEE draws caustics only through glass that refracts"
    return said


def caustics_measured():
    """
    The light caustics bring to what they fall on, from small Cycles pictures
    with them and without: on the receivers named, or else on every surface
    the camera sees that lets no light through; with the noise there.
    """
    s = scene()
    cycles = s.cycles
    casters = [o for o in s.objects if o.type == "MESH" and o.cycles.is_caustics_caster]
    receivers = [o for o in s.objects if o.type == "MESH" and o.cycles.is_caustics_receiver and not o.hide_render]
    if not (cycles.caustics_reflective or cycles.caustics_refractive or casters):
        return ""
    why = no_camera()
    if why:
        return f"What the caustics light is not measured. {why}"
    with Measures(SIDE) as measures:
        objects = shown(receivers)
        owner = measures.owners(objects)
        lit, _ = measures.picture(seed=1)
        again, _ = measures.picture(seed=2)
        kept = (cycles.caustics_reflective, cycles.caustics_refractive, [o.cycles.is_caustics_caster for o in casters])
        try:
            cycles.caustics_reflective = cycles.caustics_refractive = False
            for obj in casters:
                obj.cycles.is_caustics_caster = False
            unlit, _ = measures.picture(seed=1)
        finally:
            cycles.caustics_reflective, cycles.caustics_refractive = kept[0], kept[1]
            for obj, flag in zip(casters, kept[2]):
                obj.cycles.is_caustics_caster = flag
        size = measures.size
    if lit is None or unlit is None:
        return ""
    onto = {o.name for o in receivers} if receivers else {o.name for o in objects if not lets_light_through(o)}
    found = []
    for drawn, obj in enumerate(objects, start=1):
        where = owner == drawn
        if obj.name not in onto or where.mean() < SMALLEST:
            continue
        brighter = where & (lit - unlit > numpy.maximum(unlit * BRIGHTER, DIM))
        peak = float((lit[brighter] / numpy.maximum(unlit[brighter], DIM)).max()) if brighter.any() else 1.0
        before, after = float(unlit[where].mean()), float(lit[where].mean())
        found.append((int(brighter.sum()), brighter.sum() / where.sum(), peak, obj.name, change(after, before), after, before, noise(lit, again, where)))
    if not found:
        return f"What the caustics light is not measured: the camera sees too little of {listed(sorted(onto), NAMED)}." if onto else ""
    found.sort(reverse=True)
    lines = [
        f"{name} brighter by a tenth or more over {share:.2%} of it"
        + (f", up to {peak:.2g} times" if count else "")
        + f", {lift:+.1%} over all of it ({after:.3g} of white with them, {before:.3g} without); its noise {grain:.0%} of its brightness"
        for count, share, peak, name, lift, after, before, grain in found[:NAMED]
    ]
    reached = [name for count, _, _, name, *_ in found if count >= FOUND]
    verdict = (
        f"caustic light reaches {listed(reached, NAMED)}"
        if reached
        else f"no caustic light was found on {listed([name for _, _, _, name, *_ in found], NAMED)} at these samples"
    )
    return f"Caustics in a {size} Cycles picture at {SAMPLES} samples, against one without them: {'; '.join(lines)}. So {verdict}."


def eevee_caustics():
    """Said with an EEVEE picture of a scene that asks for shadow caustics, or nothing."""
    s = scene()
    casters = [o.name for o in s.objects if o.type == "MESH" and o.cycles.is_caustics_caster and not o.hide_render]
    if not casters:
        return ""
    return f" EEVEE draws no caustics: those set through {listed(casters, NAMED)} show only in Cycles."

