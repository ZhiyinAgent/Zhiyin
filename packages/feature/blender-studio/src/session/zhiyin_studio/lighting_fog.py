"""
Fog: a volume in a box round the scene and the camera, which a sun shines into; endless fog in
the world, which a sun's light never gets through; or fog filling objects, as a beam or a cloud.
It can thin with height, as mist over a field does. Its answer says how far one sees through it,
and a small Cycles picture with it and without measures what it adds to the picture's light and
what it costs a render.

Measured in Blender 5.2: under endless fog of density 0.02, a floor lit by a sun renders black in
Cycles and in EEVEE, while the same fog in a box round the scene leaves it lit. Fog thinning with
height thins in a box in both engines; endless fog thins only in Cycles, where a sun's light then
gets through it, EEVEE drawing it even and letting none through.
"""

import math

import bpy
import mathutils

from .arguments import colour, need, number
from .finding import scene, subjects
from .geometry import middle_of, world_bounds
from .lighting_links import NAMED, with_parts
from .lighting_measure import DIM, SAMPLES, Measures, no_camera
from .wording import hex_of, length, listed, size_text

FOG = "Zhiyin fog"
BOX = "Fog"
# Through fog this far, a twentieth of the light gets through: ln 20 over its density.
SEEN_THROUGH = 0.05
# How much bigger than the scene, the camera and the lights the box is, each way.
BOX_MARGIN = 0.1
# Steps along the way to the farthest shape, to add up fog that thins with height.
STEPS = 64
# Which way fog scatters light, -1 back to 1 onward: least, most and by default.
ANISOTROPY = (-1, 1, 0)
EEVEE_FOG = "EEVEE draws it with shadows in the fog on, for shafts of light."


def fog_material(name, density, anisotropy, rgba, thinning):
    material = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    material.use_nodes = True
    nodes = material.node_tree.nodes
    nodes.clear()
    volume = nodes.new("ShaderNodeVolumePrincipled")
    set_volume(material.node_tree, volume, density, anisotropy, rgba, thinning)
    output = nodes.new("ShaderNodeOutputMaterial")
    material.node_tree.links.new(volume.outputs["Volume"], output.inputs["Volume"])
    return material


def set_volume(tree, volume, density, anisotropy, rgba, thinning):
    """
    The fog's look, and its density: even, or with `thinning`, (half, base),
    halving every `half` metres above the height `base`, full below it.
    """
    for node in [n for n in tree.nodes if n.name.startswith(f"{FOG} height")]:
        tree.nodes.remove(node)
    volume.inputs["Density"].default_value = density
    volume.inputs["Anisotropy"].default_value = anisotropy
    volume.inputs["Color"].default_value = rgba
    if thinning is None:
        return
    half, base = thinning
    nodes, links = tree.nodes, tree.links

    def node(kind, operation=None, value=None):
        made = nodes.new(kind)
        made.name = f"{FOG} height {len(nodes)}"
        if operation:
            made.operation = operation
        if value is not None:
            made.inputs[1].default_value = value
        return made

    where = node("ShaderNodeNewGeometry")
    parts = node("ShaderNodeSeparateXYZ")
    above = node("ShaderNodeMath", "SUBTRACT", base)
    floor = node("ShaderNodeMath", "MAXIMUM", 0)
    halves = node("ShaderNodeMath", "MULTIPLY", -math.log(2) / half)
    share = node("ShaderNodeMath", "EXPONENT")
    thick = node("ShaderNodeMath", "MULTIPLY", density)
    links.new(where.outputs["Position"], parts.inputs["Vector"])
    links.new(parts.outputs["Z"], above.inputs[0])
    links.new(above.outputs[0], floor.inputs[0])
    links.new(floor.outputs[0], halves.inputs[0])
    links.new(halves.outputs[0], share.inputs[0])
    links.new(share.outputs[0], thick.inputs[0])
    links.new(thick.outputs[0], volume.inputs["Density"])


def remove_fog(group):
    """Takes away the box and the world's fog that fog made before; says what went."""
    gone = []
    box = next((o for o in group.objects if o.get("zhiyin_fog")), None)
    if box is not None:
        mesh = box.data
        bpy.data.objects.remove(box)
        if mesh.users == 0:
            bpy.data.meshes.remove(mesh)
        gone.append("the box of fog")
    world = scene().world
    if world is not None and world.use_nodes:
        tree = world.node_tree
        found = [n for n in tree.nodes if n.name.startswith(FOG)]
        if any(n.name == FOG for n in found):
            gone.append("the world's fog")
        for node in found:
            tree.nodes.remove(node)
    return gone


def world_fog(density, anisotropy, rgba, thinning):
    """Fog in the world, named so a new background keeps it."""
    world = scene().world or bpy.data.worlds.new("World")
    scene().world = world
    world.use_nodes = True
    tree = world.node_tree
    volume = tree.nodes.get(FOG) or tree.nodes.new("ShaderNodeVolumePrincipled")
    volume.name = FOG
    set_volume(tree, volume, density, anisotropy, rgba, thinning)
    output = next((n for n in tree.nodes if n.type == "OUTPUT_WORLD"), None) or tree.nodes.new("ShaderNodeOutputWorld")
    tree.links.new(volume.outputs["Volume"], output.inputs["Volume"])


def keep_world_fog(tree):
    """Links the world's fog to its output again, after the world's surface is made anew."""
    volume = tree.nodes.get(FOG)
    output = next((n for n in tree.nodes if n.type == "OUTPUT_WORLD"), None)
    if volume is not None and output is not None:
        tree.links.new(volume.outputs["Volume"], output.inputs["Volume"])


def fog_box(group, material):
    """A box round the scene, its camera and its lights, filled with fog; the box."""
    s = scene()
    bpy.context.view_layer.update()
    points = []
    bounds = world_bounds(subjects())
    if bounds:
        points += list(bounds)
    # A sun stands nowhere, so its place is not boxed.
    points += [
        o.matrix_world.translation for o in s.objects if o.type == "CAMERA" or (o.type == "LIGHT" and o.data.type != "SUN")
    ]
    need(points, "There is nothing in the scene to fill with fog.")
    low = mathutils.Vector([min(p[i] for p in points) for i in range(3)])
    high = mathutils.Vector([max(p[i] for p in points) for i in range(3)])
    grow = (high - low) * BOX_MARGIN + mathutils.Vector((0.1, 0.1, 0.1))
    low, high = low - grow, high + grow
    old = next((o for o in group.objects if o.get("zhiyin_fog")), None)
    if old is not None:
        mesh = old.data
        bpy.data.objects.remove(old)
        if mesh.users == 0:
            bpy.data.meshes.remove(mesh)
    mesh = bpy.data.meshes.new(BOX)
    corners = [(x, y, z) for x in (low.x, high.x) for y in (low.y, high.y) for z in (low.z, high.z)]
    faces = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]
    mesh.from_pydata(corners, [], faces)
    mesh.materials.append(material)
    box = bpy.data.objects.new(BOX, mesh)
    box["zhiyin_fog"] = True
    group.objects.link(box)
    return box


def farthest_seen():
    """The farthest shape the camera sees by its middle, the camera's place and the shape's middle; or nothing."""
    camera = scene().camera
    shown = [o for o in subjects() if o.type == "MESH"]
    if camera is None or not shown:
        return None
    eye = camera.matrix_world.translation
    far = max(shown, key=lambda o: (middle_of(o) - eye).length)
    return far, eye, middle_of(far)


def through(density, thinning, start, end):
    """The share of light that gets through fog from one point to another."""
    if thinning is None:
        return math.exp(-density * (end - start).length)
    half, base = thinning
    step = (end - start).length / STEPS
    depth = sum(density * 0.5 ** (max(0, (start + (end - start) * (i + 0.5) / STEPS).z - base) / half) * step for i in range(STEPS))
    return math.exp(-depth)


def thinning_of(spec):
    """How the fog thins with height, (half, base), from the call; or nothing when it is even."""
    if spec.get("height_falloff") is None:
        return None
    half = number(spec["height_falloff"], "fog height_falloff", minimum=0)
    if half == 0:
        return None
    bounds = world_bounds(subjects())
    return half, bounds[0].z if bounds else 0.0


def set_fog(spec, group):
    """Fog as the call gives it; the line that says it."""
    need(isinstance(spec, dict), "fog gives a density, and an anisotropy, a colour and where it is.")
    density = number(spec.get("density"), "fog density", minimum=0, maximum=1000)
    need(not (spec.get("objects") is not None and spec.get("world")), "fog fills objects or the world, not both.")
    if density == 0:
        need(spec.get("objects") is None, "Fog in objects is their material: give them another with blender_set_material.")
        gone = remove_fog(group)
        return f"fog removed: {listed(gone, NAMED)}" if gone else "no fog to remove: none was made here"
    least, most, default = ANISOTROPY
    anisotropy = number(spec.get("anisotropy"), "fog anisotropy", minimum=least, maximum=most, default=default)
    rgba = colour(spec.get("color"), "fog color", default="#ffffff")
    thinning = thinning_of(spec)
    s = scene()
    s.eevee.use_volumetric_shadows = True
    if spec.get("objects") is not None:
        filled = with_parts(spec["objects"], "fog objects")
        filled = [o for o in filled if o.type == "MESH"]
        need(filled, "fog fills meshes: name a box, a cone or another closed shape.")
        material = fog_material(f"{FOG} in {filled[0].name}", density, anisotropy, rgba, thinning)
        for obj in filled:
            obj.data.materials.clear()
            obj.data.materials.append(material)
        where = f"filling {listed([o.name for o in filled], NAMED)}"
    elif spec.get("world"):
        remove_fog(group)
        world_fog(density, anisotropy, rgba, thinning)
        where = "everywhere, endless, in the world"
    else:
        world = s.world
        if world is not None and world.use_nodes:
            for node in [n for n in world.node_tree.nodes if n.name.startswith(FOG)]:
                world.node_tree.nodes.remove(node)
        box = fog_box(group, fog_material(FOG, density, anisotropy, rgba, thinning))
        where = f"in {box.name}, a {size_text(box.dimensions)} box round the scene, its camera and its lights"
    toward = "onward, so shafts show looking toward a light" if anisotropy > 0 else "back toward a light" if anisotropy < 0 else "evenly every way"
    said = f"fog of density {density:g} a metre, scattering {toward} (anisotropy {anisotropy:g}), {hex_of(rgba)}, {where}"
    if thinning is not None:
        half, base = thinning
        said += f", thinning by half every {length(half)} above the scene's lowest point, at {length(base)}"
    said += f": {length(math.log(1 / SEEN_THROUGH) / density)} of it{' at its densest' if thinning else ''} lets {SEEN_THROUGH:.0%} of the light through"
    seen = farthest_seen()
    if seen is not None:
        far, eye, middle = seen
        said += (
            f", and {far.name}, the farthest shape from the camera at {length((middle - eye).length)},"
            f" shows through {through(density, thinning, eye, middle):.0%} of it"
        )
    if spec.get("world"):
        suns = [o.name for o in s.objects if o.type == "LIGHT" and o.data.type == "SUN" and not o.hide_render]
        if thinning is None:
            said += (
                ". A sun's light never gets through endless fog, in Cycles or EEVEE"
                + (f": {listed(suns, NAMED)} lights nothing now" if suns else "")
                + "; leave world out for a box round the scene, which a sun shines into"
            )
        else:
            said += (
                ". Thinning with height, endless fog lets a sun's light through in Cycles; EEVEE draws endless fog even throughout,"
                " so there it does not thin and no sun's light gets through"
                + (f": {listed(suns, NAMED)} lights nothing in EEVEE" if suns else "")
            )
    return said


def fog_switch(group):
    """Turns the fog made here off (False) or on (True): its box, the objects it fills and the world's."""
    box = [o for o in group.objects if o.get("zhiyin_fog")]
    filled = [o for o in scene().objects if o.type == "MESH" and any(m and m.name.startswith(f"{FOG} in ") for m in o.data.materials)]
    world = scene().world
    tree = world.node_tree if world is not None and world.use_nodes else None
    volume = tree.nodes.get(FOG) if tree is not None else None
    output = next((n for n in tree.nodes if n.type == "OUTPUT_WORLD"), None) if tree is not None else None
    hidden = {o.name: o.hide_render for o in box + filled}

    def switch(on):
        for obj in box + filled:
            obj.hide_render = hidden[obj.name] if on else True
        if volume is not None and output is not None:
            if on:
                tree.links.new(volume.outputs["Volume"], output.inputs["Volume"])
            else:
                for link in list(output.inputs["Volume"].links):
                    tree.links.remove(link)

    return switch


def fog_measured(group):
    """
    What the fog adds to the picture's light and what it costs, from small
    Cycles pictures with it and without; sentences for after the answer.
    """
    why = no_camera()
    if why:
        return f"The fog's light and cost are not measured. {why} {EEVEE_FOG}"
    switch = fog_switch(group)
    with Measures() as measures:
        try:
            switch(False)
            # The first picture readies Cycles; it is not timed.
            clear, _ = measures.picture()
            switch(True)
            foggy, slow = measures.picture()
            switch(False)
            _, quick = measures.picture()
        finally:
            switch(True)
        size = measures.size
    if clear is None or foggy is None:
        return EEVEE_FOG
    lift = (float(foggy.mean()) - float(clear.mean())) / max(float(clear.mean()), DIM)
    return (
        f"In a {size} Cycles picture at {SAMPLES} samples, the fog {'adds' if lift >= 0 else 'takes'} {abs(lift):.0%}"
        f" {'to' if lift >= 0 else 'from'} its mean brightness, and the picture took {slow:.2g} s against {quick:.2g} s without it,"
        f" {slow / max(quick, 1e-3):.2g} times as long; fog also needs more samples than a clear scene for its grain to go. {EEVEE_FOG}"
    )
