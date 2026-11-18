"""
The helpers module as one file, written beside a script for it to run
outside Zhiyin: it holds every module the helpers import, each as the
harness has it, so it never says other than the harness does.
"""

import ast
from pathlib import Path

from zhiyin_cad import standalone

HARNESS = Path(__file__).resolve().parents[2] / "src" / "harness"


def held(text):
    """The modules a copy holds, by name, read back from its text."""
    tree = ast.parse(text)
    for node in tree.body:
        if isinstance(node, ast.Assign) and getattr(node.targets[0], "id", None) == "_SOURCES":
            return ast.literal_eval(node.value)
    raise AssertionError("the copy holds no sources")


def test_the_copy_holds_every_module_the_helpers_import_however_deep():
    sources = held(standalone.text())
    wanted, seen = ["helpers"], set()
    while wanted:
        name = wanted.pop()
        if name in seen:
            continue
        seen.add(name)
        assert name in sources, f"{name} is imported by the helpers and not held"
        wanted += sorted(standalone.imported(sources[name]))
    assert {"helpers", "fits", "sheet_metal", "strength", "bent_path"} <= seen


def test_each_module_held_is_the_harness_s_own_source():
    sources = held(standalone.text())
    for name in standalone.COPIED:
        assert sources[name] == (HARNESS / "zhiyin_cad" / f"{name}.py").read_text(encoding="utf-8")


def test_the_modules_that_tell_a_build_what_was_made_are_stood_in_with_every_name_the_helpers_use():
    sources = held(standalone.text())
    for stood in standalone.STANDING_IN:
        assert stood not in standalone.COPIED
        given = {}
        exec(sources[stood], given)
        used = {
            node.attr
            for name in standalone.COPIED
            for node in ast.walk(ast.parse(sources[name]))
            if isinstance(node, ast.Attribute) and getattr(node.value, "id", None) == stood
        }
        assert used <= set(given), f"the stand-in for {stood} lacks {sorted(used - set(given))}"


def test_what_the_helpers_say_is_printed_as_they_say_it(capsys):
    namespace = {}
    exec(held(standalone.text())["notes"], namespace)
    namespace["say"]("round_edges: rounded 4 edges by 1.5 mm, not the 3 mm asked.")
    assert capsys.readouterr().out == "round_edges: rounded 4 edges by 1.5 mm, not the 3 mm asked.\n"


def test_the_copy_is_the_harness_s_helpers_module_with_its_sources_filled_in():
    text = standalone.text()
    ast.parse(text)
    module = (HARNESS / "zhiyin_cad_helpers.py").read_text(encoding="utf-8")
    before, _, after = module.partition("_SOURCES = None\n")
    assert text.startswith(before)
    assert text.endswith(after)
    # A held module reads as the module itself, not as one escaped line.
    assert "\n    'helpers': r'''\"\"\"\n" in text
