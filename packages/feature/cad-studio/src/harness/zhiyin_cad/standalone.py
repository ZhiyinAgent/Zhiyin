"""
The helpers module as one file for a script to run anywhere: the harness's
own zhiyin_cad_helpers.py, holding the source of every module the helpers
import. Three of those record, for the build, what the helpers made, so it
can be measured and meshed; run without a build there is nothing to tell,
and the copy holds a module that keeps nothing in place of each. What the
helpers say they did is printed as they say it.
"""

import ast
import os

# The modules the helpers import, held as they are.
COPIED = ("helpers", "bent_path", "fits", "sheet_metal", "strength", "strength_materials", "words")
# In place of the modules that tell the build what the helpers made: the same calls, keeping nothing.
STANDING_IN = {
    "making": '"""What the helpers made, which only a build measures."""\n\n\ndef note(kind, **fields):\n    pass\n',
    "meshing": '"""Faces to mesh finer, which only a build meshes."""\n\n\ndef wire(faces, deflection, angular):\n    pass\n',
    "surfaces": '"""Named groups of faces, which only a build gives materials."""\n\n\ndef name(faces, group):\n    pass\n',
    "notes": (
        '"""What the helpers did, printed as they say it."""\n\nsaid = []\n\n\n'
        "def say(text):\n    said.append(text)\n    print(text)\n"
    ),
}

_HARNESS = os.path.dirname(os.path.abspath(__file__))
_MODULE = os.path.join(os.path.dirname(_HARNESS), "zhiyin_cad_helpers.py")
# The line of the helpers module a copy fills in.
_EMPTY = "_SOURCES = None\n"


def _source(name):
    with open(os.path.join(_HARNESS, f"{name}.py"), encoding="utf-8") as file:
        return file.read()


def sources():
    """Each module the copy holds, by name, as its source."""
    return {**{name: _source(name) for name in COPIED}, **STANDING_IN}


def imported(source):
    """The harness's modules a module's source imports, by name, wherever in it the import is."""
    found = set()
    for node in ast.walk(ast.parse(source)):
        if isinstance(node, ast.ImportFrom) and node.level == 1:
            if node.module:
                found.add(node.module.split(".")[0])
            else:
                found.update(alias.name for alias in node.names)
    return found


def _literal(source):
    """A module's source as Python writes it, readable as the module itself where it can be."""
    if "'''" not in source and not source.endswith("\\"):
        return f"r'''{source}'''"
    return repr(source)


def text():
    """The helpers module as one file, every module it needs held in it."""
    with open(_MODULE, encoding="utf-8") as file:
        module = file.read()
    if module.count(_EMPTY) != 1:
        raise RuntimeError("The helpers module has no one line for the sources a copy holds.")
    held = "".join(f"    {name!r}: {_literal(source)},\n" for name, source in sources().items())
    return module.replace(_EMPTY, f"_SOURCES = {{\n{held}}}\n")


def write(path):
    """Writes the one file, and answers its size."""
    with open(path, "w", encoding="utf-8", newline="\n") as out:
        out.write(text())
    return os.path.getsize(path)
