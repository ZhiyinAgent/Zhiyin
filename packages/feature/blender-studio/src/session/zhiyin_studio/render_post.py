"""
A picture's post: its steps laid over every render in order by a compositor node group of the
scene's, kept for later renders and videos, each mixed in by an amount. A render drawn with it is
drawn raw first, so its checks read the light the scene made, and then composited from that light,
a glare's threshold set from the picture's measured highlights.

Measured in Blender 5.2: a scene's compositor is the node group it names; a compositor that reads
a picture from a file and no render layer composites it without drawing the scene again, into the
same picture a composited render gives.
"""

import json
import os

import bpy
import numpy

from .arguments import need, number
from .finding import scene
from .lighting_links import NAMED
from .render_passes import COMBINED, light_file, luminance
from .reports import report
from .tone_effects import GLARES, bundled, picture_in, picture_out, step_node, title
from .wording import listed

TREE = "Zhiyin picture effects"
# How much of a step is mixed in: least, most and by default.
AMOUNT = (0, 1, 1)
# The steps as the call gave them, kept on the scene, so each picture measures its glare anew.
KEPT = "zhiyin_post"
# A glare's threshold lies a stop under the brightest share of the picture's light, this percentile.
HIGHLIGHT = 99.5


def ours():
    """Whether the scene is composited by the post set here."""
    s = scene()
    tree = s.compositing_node_group
    return tree is not None and tree.name == TREE and s.render.use_compositing and bool(s.get(KEPT))


def kept_steps():
    try:
        return json.loads(scene().get(KEPT) or "[]")
    except ValueError:
        return []


def chain(tree, picture, specs, thresholds):
    """Lays the steps over a picture in order; the picture they make and what each says of itself."""
    said = []
    for index, spec in enumerate(specs):
        node, values = step_node(tree, spec, index, thresholds.get(index))
        least, most, default = AMOUNT
        amount = number(spec.get("amount"), f"{title(node)}'s amount", minimum=least, maximum=most, default=default)
        tree.links.new(picture, node.inputs[picture_in(node)])
        out = node.outputs[picture_out(node)]
        if amount < 1:
            mix = tree.nodes.new("ShaderNodeMix")
            mix.data_type = "RGBA"
            sockets = {socket.identifier: socket for socket in mix.inputs}
            sockets["Factor_Float"].default_value = amount
            tree.links.new(picture, sockets["A_Color"])
            tree.links.new(out, sockets["B_Color"])
            out = next(socket for socket in mix.outputs if socket.type == "RGBA")
        picture = out
        said.append(f"{title(node)} at {amount:.0%} ({', '.join(values)})")
    return picture, said


def built(name, specs, thresholds, source):
    """A compositor group of the steps over `source(tree)`'s picture; it and what each step says."""
    tree = bpy.data.node_groups.new(name, "CompositorNodeTree")
    try:
        tree.interface.new_socket("Image", in_out="OUTPUT", socket_type="NodeSocketColor")
        picture, said = chain(tree, source(tree), specs, thresholds)
        tree.links.new(picture, tree.nodes.new("NodeGroupOutput").inputs[0])
    except Exception:
        bpy.data.node_groups.remove(tree)
        raise
    return tree, said


def from_render(tree):
    return tree.nodes.new("CompositorNodeRLayers").outputs["Image"]


def set_post(specs):
    """Lays steps over every render in order, replacing those set before; the line that says them."""
    need(isinstance(specs, list), "post is a list of steps.")
    s = scene()
    own = s.compositing_node_group
    replaced = own.name if own is not None and own.name != TREE else None
    if replaced:
        own.use_fake_user = True
    if not specs:
        old = bpy.data.node_groups.get(TREE)
        if old is not None:
            bpy.data.node_groups.remove(old)
        s.pop(KEPT, None)
        return "No post" + (f"; the scene's own compositor {replaced} stays." if replaced else ".")
    # Made whole beside the one before, which stays until this one is.
    tree, said = built(f"{TREE} new", specs, {}, from_render)
    old = bpy.data.node_groups.get(TREE)
    if old is not None:
        bpy.data.node_groups.remove(old)
    tree.name = TREE
    s.compositing_node_group = tree
    s.render.use_compositing = True
    s[KEPT] = json.dumps(specs)
    return (
        "Post, laid over this and every later render and video, in Cycles and EEVEE, in this order: "
        + "; ".join(said)
        + (f"; in place of the scene's own compositor {replaced}, which is kept in the file" if replaced else "")
        + "."
    )


def post(steps):
    """
    Lays compositor steps over every render and video in order, as
    blender_render's post does, replacing those set before; [] removes them.
    A glare's threshold is measured from the picture at each blender_render.
    """
    said = set_post(steps)
    glares = [s["step"] for s in steps if isinstance(s, dict) and s.get("step") in GLARES and s.get("threshold") is None]
    report(
        said[0].lower()
        + said[1:].rstrip(".")
        + (
            f"; {listed(glares, NAMED)}: {'its' if len(glares) == 1 else 'their'} threshold is measured from each picture blender_render makes,"
            " Blender's 1 until then"
            if glares
            else ""
        )
    )
    return scene().compositing_node_group if steps else None


def compositor_group(name):
    """Appends one of Blender's bundled compositor groups by its name, kept in the file, and says its inputs and outputs."""
    need(isinstance(name, str) and name.strip(), "compositor_group takes the name of one of Blender's compositor groups.")
    group = bundled(name.strip())
    sockets = [item for item in group.interface.items_tree if item.item_type == "SOCKET"]
    ins = [f"{i.name} ({i.socket_type.removeprefix('NodeSocket').lower()})" for i in sockets if i.in_out == "INPUT"]
    outs = [f"{i.name} ({i.socket_type.removeprefix('NodeSocket').lower()})" for i in sockets if i.in_out == "OUTPUT"]
    report(
        f"compositor group {group.name}, Blender's own: takes {', '.join(ins) or 'nothing'}; gives {', '.join(outs)}"
        "; it goes in a compositor tree as a CompositorNodeGroup node whose node_tree is it"
    )
    return group


def effects_text():
    """The post a render is composited with, in words, or nothing."""
    s = scene()
    tree = s.compositing_node_group
    if tree is None or not s.render.use_compositing:
        return ""
    if tree.name != TREE:
        return f", composited by the scene's own {tree.name}"
    named = [title(n) for n in sorted((n for n in tree.nodes if ". " in n.label), key=lambda n: int(n.label.split(".")[0]))]
    return f", composited with {listed(named, NAMED)}" if named else ""


def measured_thresholds(specs, light, within):
    """
    The threshold of each glare that gives none: a stop under the brightest
    half-percent of the picture's light, and never under the light that
    shows as white at the scene's exposure. With what to say of each glare.
    """
    shown = light[within] if within is not None and within.any() else light.ravel()
    white = 1 / 2 ** scene().view_settings.exposure
    highlight = float(numpy.percentile(shown, HIGHLIGHT)) if shown.size else 0.0
    thresholds, said = {}, []
    for index, spec in enumerate(specs):
        if spec.get("step") not in GLARES:
            continue
        given = spec.get("threshold", (spec.get("inputs") or {}).get("Threshold"))
        threshold = float(given) if given is not None else max(highlight / 2, white)
        if given is None:
            thresholds[index] = threshold
        above = float((shown > threshold).mean()) if shown.size else 0.0
        how = (
            "as given"
            if given is not None
            else f"a stop under the brightest half-percent of the picture's light ({highlight:.3g})"
            if highlight / 2 >= white
            else f"the light that shows as white at this exposure, the picture's brightest half-percent being {highlight:.3g}"
        )
        line = f"{spec['step'].replace('_', ' ')}'s threshold {threshold:.3g}, {how}: {above * 100:.2g}% of the picture is brighter"
        if above == 0:
            line += ", so nothing glows: brighten what should glow, or give a lower threshold"
        said.append(line)
    return thresholds, said


def composite_after(passes, folder, write, transparent):
    """
    Composites a picture drawn raw: the steps kept on the scene laid over its
    light as the scene's compositor lays them, glares at thresholds measured
    from it, which the scene's compositor then keeps too. `write` draws the
    picture through the compositor set. What is said of the glares, or None
    when there was no light to composite from.
    """
    light = passes.get(COMBINED)
    path = light_file(passes, os.path.join(folder, "post-light.exr")) if light is not None else None
    if path is None:
        return None
    specs = kept_steps()
    within = light[..., 3] > 0.5 if transparent and light.shape[2] == 4 else None
    thresholds, said = measured_thresholds(specs, luminance(light), within)
    s = scene()
    kept = s.compositing_node_group
    for index, threshold in thresholds.items():
        node = next((n for n in kept.nodes if n.label.startswith(f"{index + 1}. ")), None)
        if node is not None and "Threshold" in node.inputs:
            node.inputs["Threshold"].default_value = threshold
    image = bpy.data.images.load(path, check_existing=False)

    def from_light(tree):
        source = tree.nodes.new("CompositorNodeImage")
        source.image = image
        return source.outputs["Image"]

    tree = None
    try:
        tree, _ = built(f"{TREE} after", specs, thresholds, from_light)
        s.compositing_node_group = tree
        write()
    finally:
        s.compositing_node_group = kept
        if tree is not None:
            bpy.data.node_groups.remove(tree)
        bpy.data.images.remove(image)
    return said
