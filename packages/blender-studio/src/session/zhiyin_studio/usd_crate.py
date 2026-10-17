"""The strings a binary USD file holds.

Binary USD keeps every string it holds in one table, whatever the string is
for: names, values, and every file it names, whether another scene, a part
or a texture. That table is read here as USD lays it out, so what such a file
names can be checked before Blender's importer reads it.
"""

import struct

from .common import Refused

MAGIC = b"PXR-USDC"
# The newest layout read here. A newer one may keep strings elsewhere.
NEWEST = (0, 15)
UNREADABLE = "{name} is binary USD that cannot be read here ({why}). Export it as .usda, .glb or .obj and add that instead."


def _lz4_block(source):
    """One LZ4 block, unpacked."""
    out = bytearray()
    at, end = 0, len(source)

    def length(start):
        nonlocal at
        total = start
        if start == 15:
            while True:
                more = source[at]
                at += 1
                total += more
                if more != 255:
                    break
        return total

    while at < end:
        token = source[at]
        at += 1
        literals = length(token >> 4)
        out += source[at : at + literals]
        at += literals
        if at >= end:
            break
        offset = source[at] | source[at + 1] << 8
        at += 2
        match = length(token & 15) + 4
        start = len(out) - offset
        if offset == 0 or start < 0:
            raise ValueError("a copy reaches before the start")
        for index in range(match):
            out.append(out[start + index])
    return bytes(out)


def _unpacked(data):
    """USD's packing: a count of LZ4 blocks, each after its size, or one block when the count is 0."""
    (blocks,) = struct.unpack_from("<b", data, 0)
    if blocks == 0:
        return _lz4_block(data[1:])
    out, at = bytearray(), 1
    for _ in range(blocks):
        (size,) = struct.unpack_from("<i", data, at)
        at += 4
        out += _lz4_block(data[at : at + size])
        at += size
    return bytes(out)


def is_crate(content):
    return content.startswith(MAGIC)


def strings(content, name):
    """Every string a binary USD file holds."""
    version = tuple(content[8:10])
    if version[0] != 0 or version > NEWEST:
        raise Refused(UNREADABLE.format(name=name, why=f"its version {version[0]}.{version[1]} is newer than this check reads"))
    try:
        (contents,) = struct.unpack_from("<q", content, 16)
        (count,) = struct.unpack_from("<Q", content, contents)
        sections = {}
        for index in range(count):
            label, start, _size = struct.unpack_from("<16sqq", content, contents + 8 + 32 * index)
            sections[label.split(b"\0", 1)[0]] = start
        if b"TOKENS" not in sections:
            return []
        start = sections[b"TOKENS"]
        (number,) = struct.unpack_from("<Q", content, start)
        if version < (0, 4):
            (size,) = struct.unpack_from("<Q", content, start + 8)
            chars = content[start + 16 : start + 16 + size]
        else:
            size, packed = struct.unpack_from("<QQ", content, start + 8)
            chars = _unpacked(content[start + 24 : start + 24 + packed])
        words = chars.split(b"\0")
        if len(chars) != size or len(words) <= number:
            raise ValueError("its strings end early")
    except (struct.error, IndexError, ValueError) as error:
        raise Refused(UNREADABLE.format(name=name, why="it is damaged or cut short")) from error
    return [word.decode("utf-8", errors="replace") for word in words[:number]]
