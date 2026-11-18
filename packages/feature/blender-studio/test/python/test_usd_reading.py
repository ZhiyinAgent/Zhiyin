"""
What a USD model file names, read before Blender's importer reads it: the
strings of binary USD, the asset paths of USD text, and the scenes a USD
package holds, so that a model naming a file outside the workspace is found.
"""

import os
import struct
import zipfile

import pytest
from zhiyin_studio import usd_crate
from zhiyin_studio.errors import Refused
from zhiyin_studio.model_reads import named_outside


def lz4_literals(data):
    """One LZ4 block holding `data` as literals alone."""
    if len(data) < 15:
        head = bytes([len(data) << 4])
    else:
        rest, head = len(data) - 15, bytearray([0xF0])
        while rest >= 255:
            head.append(255)
            rest -= 255
        head.append(rest)
    return bytes(head) + data


def crate(strings, version=(0, 8), block=None):
    """A binary USD file whose one section is its table of strings."""
    chars = b"".join(text.encode() + b"\0" for text in strings)
    if version >= (0, 4):
        packed = bytes([0]) + (block if block is not None else lz4_literals(chars))
        section = struct.pack("<QQQ", len(strings), len(chars), len(packed)) + packed
    else:
        section = struct.pack("<QQ", len(strings), len(chars)) + chars
    contents = 24 + len(section)
    table = struct.pack("<Q", 1) + struct.pack("<16sqq", b"TOKENS", 24, len(section))
    return usd_crate.MAGIC + bytes([*version, 0, 0, 0, 0, 0, 0]) + struct.pack("<q", contents) + section + table


def test_binary_usd_gives_every_string_it_holds():
    assert usd_crate.strings(crate(["World", "textures/wood.png"]), "model.usdc") == ["World", "textures/wood.png"]


def test_a_long_string_is_read_whole():
    path = "textures/" + "a" * 600 + ".png"
    assert usd_crate.strings(crate([path]), "model.usdc") == [path]


def test_a_copy_that_overlaps_what_it_copies_repeats_it():
    # "abc" as literals, then 9 bytes copied from 3 back, then the string's end.
    block = bytes([0x35]) + b"abc" + bytes([3, 0]) + bytes([0x10]) + b"\0"
    assert usd_crate.strings(crate(["abcabcabcabc"], block=block), "model.usdc") == ["abcabcabcabc"]


def test_an_older_layout_keeps_its_strings_unpacked():
    assert usd_crate.strings(crate(["World", "a.png"], version=(0, 3)), "old.usdc") == ["World", "a.png"]


def test_a_file_with_no_strings_names_nothing():
    file = usd_crate.MAGIC + bytes([0, 8, 0, 0, 0, 0, 0, 0]) + struct.pack("<q", 24) + struct.pack("<Q", 0)
    assert usd_crate.strings(file, "empty.usdc") == []


@pytest.mark.parametrize(
    ("file", "why"),
    [
        (usd_crate.MAGIC, "damaged or cut short"),
        (crate(["World"])[:-10], "damaged or cut short"),
        (crate(["World"], version=(0, 16)), "newer than this check reads"),
        (crate(["World"], block=bytes([0x10]) + b"W" + bytes([9, 0])), "damaged or cut short"),
    ],
)
def test_binary_usd_that_cannot_be_read_is_refused_with_why(file, why):
    with pytest.raises(Refused, match=why):
        usd_crate.strings(file, "model.usdc")


@pytest.fixture
def workspace(tmp_path):
    folder = tmp_path / "workspace"
    folder.mkdir()
    return folder


def usda(*lines):
    return ("#usda 1.0\n" + "\n".join(lines) + "\n").encode()


def outside_file(workspace, name):
    return os.path.realpath(workspace.parent / name)


def test_usd_text_naming_a_file_outside_the_workspace_is_found(workspace):
    (workspace / "scene.usda").write_bytes(usda("(", "    subLayers = [@../secret.usda@, @./parts/inside.usda@]", ")"))
    found = named_outside(str(workspace / "scene.usda"), str(workspace))
    assert found == [outside_file(workspace, "secret.usda")]


def test_usd_text_naming_only_files_inside_names_nothing_outside(workspace):
    (workspace / "scene.usda").write_bytes(usda('def "A" (references = @./parts/wheel.usda@) {}'))
    assert named_outside(str(workspace / "scene.usda"), str(workspace)) == []


def test_a_scene_a_scene_names_is_read_too_however_deep(workspace):
    (workspace / "parts").mkdir()
    (workspace / "scene.usda").write_bytes(usda('def "A" (references = @./parts/wheel.usda@) {}'))
    (workspace / "parts" / "wheel.usda").write_bytes(usda('asset tex = @../../secret.png@'))
    found = named_outside(str(workspace / "scene.usda"), str(workspace))
    assert found == [outside_file(workspace, "secret.png")]


def test_binary_usd_naming_a_file_outside_is_found(workspace):
    elsewhere = os.path.realpath(workspace.parent / "elsewhere" / "wood.png")
    (workspace / "model.usdc").write_bytes(crate(["World", "Looks", elsewhere]))
    assert named_outside(str(workspace / "model.usdc"), str(workspace)) == [elsewhere]


def test_a_package_s_scenes_are_read_as_usd_reads_them(workspace):
    with zipfile.ZipFile(workspace / "model.usdz", "w", zipfile.ZIP_STORED) as package:
        package.writestr("model.usda", usda("asset tex = @../secret.png@"))
        package.writestr("textures/wood.png", b"not read")
    found = named_outside(str(workspace / "model.usdz"), str(workspace))
    assert found == [outside_file(workspace, "secret.png")]


def test_a_package_whose_files_are_compressed_is_refused(workspace):
    with zipfile.ZipFile(workspace / "model.usdz", "w", zipfile.ZIP_DEFLATED) as package:
        package.writestr("model.usda", usda("asset tex = @./wood.png@"))
    with pytest.raises(Refused, match="is a USD package that cannot be read here"):
        named_outside(str(workspace / "model.usdz"), str(workspace))


@pytest.mark.parametrize(
    ("lines", "why"),
    [
        (['def "A" (', "    clips = {}", ") {}"], "plays clips"),
        (['def "A" (', "    clipSets = []", ") {}"], "plays clips"),
        (["asset tex = @`if(true, 'a.png', 'b.png')`@"], "by an expression"),
        (["asset tex = @@@a\\@@@b.png@@@"], "escaped @@@"),
    ],
)
def test_usd_text_whose_files_cannot_be_checked_is_refused(workspace, lines, why):
    (workspace / "scene.usda").write_bytes(usda(*lines))
    with pytest.raises(Refused, match=why):
        named_outside(str(workspace / "scene.usda"), str(workspace))
