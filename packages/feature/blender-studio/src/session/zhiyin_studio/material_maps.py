"""
A texture set laid on a material: its pictures named one by one or found in a folder by the
word that ends each name (Color, Roughness, NormalGL, nor_gl, ORM...), each wired to the input
it drives and read as its kind needs, colour in sRGB and data as numbers. A normal map's
convention, OpenGL's or DirectX's, is the one given, or guessed from its name or its set; the
answer says the guess and why. Each map is said with its resolution and how large one of its
pixels lies on each object.
"""

import os
import re

import bpy

from .arguments import need, number
from .material_pictures import picture, pixels_text, placement
from .wording import one_of

KINDS = ("color", "roughness", "metallic", "normal", "height", "ao", "opacity", "orm")
# The words a map's name ends with, by kind.
WORDS = {
    "color": {"color", "colour", "albedo", "basecolor", "diffuse", "diff", "col", "alb"},
    "roughness": {"roughness", "rough", "rgh"},
    "metallic": {"metallic", "metalness", "metal", "met"},
    "normal": {"normal", "nor", "nrm", "norm", "nrml"},
    "height": {"height", "displacement", "disp", "displ", "bump"},
    "ao": {"ao", "occlusion", "ambientocclusion"},
    "opacity": {"opacity", "alpha", "transparency"},
    # Packed: occlusion in red, roughness in green and metalness in blue.
    "orm": {"orm", "arm"},
}
# The words a normal map's name gives its convention by.
CONVENTION_WORDS = {"gl": "opengl", "opengl": "opengl", "ogl": "opengl", "dx": "directx", "directx": "directx"}
CONVENTIONS = {"opengl": "OPENGL", "directx": "DIRECTX"}
# Words a name may end with after its kind: a resolution, a file format, a convention.
TRAILING = re.compile(r"^(\d+k|\d{3,5}(px)?|png|jpe?g|exr|tiff?|webp|bmp|hdr|gl|dx|opengl|directx|ogl)$", re.IGNORECASE)


def words_of(path):
    """The words of a file's name, split at separators and where lower case meets upper, in lower case."""
    stem = os.path.splitext(os.path.basename(path))[0]
    found = []
    for part in re.split(r"[^A-Za-z0-9]+", stem):
        if not part:
            continue
        if TRAILING.match(part):
            found.append(part.lower())
            continue
        found += [w.lower() for w in re.findall(r"[A-Z]+(?![a-z])|[A-Z]?[a-z]+|\d+", part)]
    return found


def kind_of(path):
    """The kind of map a file is by the last word of its name that is not a resolution, format or convention; or None."""
    for word in reversed(words_of(path)):
        if TRAILING.match(word):
            continue
        return next((kind for kind, words in WORDS.items() if word in words), None)
    return None


def named_convention(path):
    """The convention a file's name gives, or None."""
    return next((CONVENTION_WORDS[w] for w in reversed(words_of(path)) if w in CONVENTION_WORDS), None)


def convention_of(path, given, others=()):
    """A normal map's convention and why: as given, by its name, by its set's other normal maps, or Blender's own OpenGL."""
    if given is not None:
        need(given in CONVENTIONS, f"convention is {one_of(CONVENTIONS)}.")
        return given, "as given"
    named = named_convention(path)
    file = os.path.basename(path)
    if named == "directx":
        return "directx", f"guessed from {file}'s name, made for DirectX: its green is flipped to Blender's"
    if named == "opengl":
        return "opengl", f"guessed from {file}'s name, made for OpenGL as Blender reads it"
    if any(named_convention(o) == "directx" for o in others):
        return "opengl", "guessed from its set, which has a DirectX normal map beside it"
    return "opengl", (
        f"nothing in {file}'s name or its set says which, so it is read as OpenGL, Blender's own:"
        " give convention directx if its bumps look like dents"
    )


def chosen_maps(spec):
    """Each kind of map the set gives, the files of its folder it leaves and why, and the folder's files it could not place."""
    need(isinstance(spec, dict), "maps gives a folder or the pictures of a texture set.")
    found = {kind: [spec[kind]] for kind in KINDS if spec.get(kind)}
    named = set(found)
    unknown = []
    for path in spec.get("files") or []:
        kind = kind_of(path)
        if kind is None:
            unknown.append(os.path.basename(path))
        elif kind not in named:
            found.setdefault(kind, []).append(path)
    need(found, "maps found no texture map: name its pictures, or give a folder whose pictures end in Color, Roughness, Normal and so on.")
    chosen, left = {}, []
    for kind, paths in found.items():
        if len(paths) == 1:
            chosen[kind] = paths[0]
            continue
        best = max(paths, key=lambda p: preference(p, kind, spec.get("convention")))
        chosen[kind] = best
        left += [f"{os.path.basename(p)} (another {kind} map)" for p in sorted(paths) if p != best]
    others = [p for p in spec.get("files") or [] if kind_of(p) == "normal"]
    return chosen, left, unknown, others


def preference(path, kind, convention):
    """How a map is chosen among several of its kind: a normal map in the convention wanted, then the most pixels."""
    image = bpy.data.images.load(path, check_existing=True)
    pixels = image.size[0] * image.size[1]
    if kind != "normal":
        return (0, pixels, os.path.basename(path))
    fits = named_convention(path) == (convention or "opengl")
    return (1 if fits else 0, pixels, os.path.basename(path))


def draw_maps(material, shader, spec, targets):
    """Lays the set's maps on the material, each driving its input; the height map it leaves for height, and what the answer says."""
    chosen, left, unknown, others = chosen_maps(spec)
    laid = placement(material, spec, targets, "maps")
    tree, inputs, said = material.node_tree, shader.inputs, []
    driven = {}

    def lay(kind, socket_names, output="Color"):
        node = picture(material, chosen[kind], laid, kind)
        for socket in socket_names:
            tree.links.new(node.outputs[output], inputs[socket])
        driven.update(dict.fromkeys(socket_names, kind))
        return node

    for kind, socket in (("color", "Base Color"), ("roughness", "Roughness"), ("metallic", "Metallic"), ("opacity", "Alpha")):
        if kind in chosen:
            node = lay(kind, [socket])
            said.append(f"{kind} {_file(node)} ({_space(node)}, {pixels_text(node.image, laid)})")
    if "orm" in chosen:
        node = picture(material, chosen["orm"], laid, "orm")
        parts = tree.nodes.new("ShaderNodeSeparateColor")
        tree.links.new(node.outputs["Color"], parts.inputs["Color"])
        took = []
        for channel, socket, word in (("Green", "Roughness", "roughness"), ("Blue", "Metallic", "metalness")):
            if socket not in driven:
                tree.links.new(parts.outputs[channel], inputs[socket])
                took.append(f"{word} from its {channel.lower()}")
        said.append(f"orm {_file(node)} ({_space(node)}, {pixels_text(node.image, laid)}; {', '.join(took) or 'nothing its own maps did not give'})")
    if "normal" in chosen:
        convention, why = convention_of(chosen["normal"], spec.get("convention"), [o for o in others if o != chosen["normal"]])
        node = picture(material, chosen["normal"], laid, "normal")
        bump = tree.nodes.new("ShaderNodeNormalMap")
        bump.convention = CONVENTIONS[convention]
        bump.inputs["Strength"].default_value = number(spec.get("strength"), "maps strength", minimum=0, maximum=10, default=1)
        tree.links.new(node.outputs["Color"], bump.inputs["Color"])
        tree.links.new(bump.outputs["Normal"], inputs["Normal"])
        said.append(f"normal {_file(node)} ({_space(node)}, {pixels_text(node.image, laid)}; {convention_word(convention)}, {why})")
    if "ao" in chosen:
        said.append(f"ao {os.path.basename(chosen['ao'])} left out: Cycles and EEVEE shade the shape's own crevices themselves")
    if left:
        said.append("left out " + ", ".join(left))
    if unknown:
        said.append("not a map by its name: " + ", ".join(unknown))
    return chosen.get("height"), laid, driven, "Its maps: " + "; ".join(said) + "."


def convention_word(convention):
    return "OpenGL" if convention == "opengl" else "DirectX"


def _file(node):
    return bpy.path.basename(node.image.filepath) or node.image.name


def _space(node):
    return node.image.colorspace_settings.name
