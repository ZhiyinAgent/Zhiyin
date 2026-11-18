"""Writes solid-cjk.ttf: a font whose only glyphs are 中, 文 and the Latin
letters, each a filled square, and an empty .notdef. Text drawn with it is easy
to tell apart from the hollow box a font without the character draws in its
place, and from Latin text drawn in a font of its own.

Run with fontTools installed: python make-solid-font.py
"""

from pathlib import Path

from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen


def square():
    pen = TTGlyphPen(None)
    pen.moveTo((50, -70))
    pen.lineTo((50, 830))
    pen.lineTo((950, 830))
    pen.lineTo((950, -70))
    pen.closePath()
    return pen.glyph()


letters = [chr(code) for code in range(ord("A"), ord("Z") + 1)]
letters += [letter.lower() for letter in letters]
names = ["zhong", "wen", *letters]
characters = {0x4E2D: "zhong", 0x6587: "wen", **{ord(letter): letter for letter in letters}}

builder = FontBuilder(1000, isTTF=True)
builder.setupGlyphOrder([".notdef", *names])
builder.setupCharacterMap(characters)
builder.setupGlyf({".notdef": TTGlyphPen(None).glyph(), **{name: square() for name in names}})
builder.setupHorizontalMetrics({".notdef": (1000, 0), **{name: (1000, 50) for name in names}})
builder.setupHorizontalHeader(ascent=880, descent=-120)
builder.setupNameTable({"familyName": "Solid CJK Test", "styleName": "Regular"})
builder.setupOS2(sTypoAscender=880, sTypoDescender=-120, usWinAscent=880, usWinDescent=120)
builder.setupPost()
builder.save(str(Path(__file__).with_name("solid-cjk.ttf")))
