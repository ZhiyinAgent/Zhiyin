"""
Lettering in single strokes, as technical drawings are lettered: the Relief
SingleLine CAD font build123d ships, read as open strokes, so text is the same
lines in every format a drawing is written to, and a laser or a plotter draws
it as it is shown. Characters it lacks, Chinese, Japanese and Korean among
them, accented Latin, Greek and Cyrillic, and symbols such as ⌀, are drawn
from the first Windows font that has them, as their outlines, which at a
drawing's sizes read as the characters' strokes. Scripts whose letters join
or change shape beside each other, as Arabic, Hebrew, the Indian scripts and
Thai do, cannot be drawn a character at a time, and are not lettered.
"""

import functools
import math
import os
import unicodedata

from fontTools.pens.basePen import BasePen
from fontTools.ttLib import TTFont

# The font's capital height, which a text's height is measured by, as ISO 3098 does.
CAP_HEIGHT = 680


class _Strokes(BasePen):
    """
    A glyph's contours as open strokes. The font closes every stroke with a
    segment back to its start, which is not part of the letter.
    """

    def __init__(self, glyphs):
        super().__init__(glyphs)
        self.strokes = []
        self.current = None

    def _moveTo(self, point):
        self.current = [point]
        self.strokes.append(self.current)

    def _lineTo(self, point):
        self.current.append(point)

    def _curveToOne(self, one, two, three):
        start = self.current[-1]
        for step in range(1, 7):
            t = step / 6
            u = 1 - t
            self.current.append(
                tuple(u**3 * s + 3 * u * u * t * a + 3 * u * t * t * b + t**3 * e for s, a, b, e in zip(start, one, two, three))
            )

    def _qCurveToOne(self, control, end):
        start = self.current[-1]
        for step in range(1, 5):
            t = step / 4
            u = 1 - t
            self.current.append(tuple(u * u * s + 2 * u * t * c + t * t * e for s, c, e in zip(start, control, end)))

    def _closePath(self):
        self.current = None

    def _endPath(self):
        self.current = None


class _Outlines(_Strokes):
    """A glyph's contours as closed outlines, as an ordinary font's are."""

    def _closePath(self):
        if self.current and self.current[0] != self.current[-1]:
            self.current.append(self.current[0])
        self.current = None


# Windows fonts a character the lettering lacks is drawn from, the first that has it: Chinese, Korean
# and Japanese, the lightest first, then accented Latin, Greek and Cyrillic, then symbols.
OUTLINE_FONTS = (
    "msyhl.ttc",
    "msyh.ttc",
    "Deng.ttf",
    "simhei.ttf",
    "simsun.ttc",
    "malgun.ttf",
    "YuGothL.ttc",
    "segoeuil.ttf",
    "segoeui.ttf",
    "seguisym.ttf",
)
# How tall the em of such a font is drawn, against the capital height of the lettering: its characters
# stand a little taller than a capital, as they do beside Latin text.
WIDE_EM = 1.4
# Scripts whose letters join or change shape beside each other: Hebrew and Arabic, the Indian
# scripts, Thai and Lao, Myanmar, Khmer, and Arabic's presentation forms.
SHAPED = (
    (0x0590, 0x08FF),
    (0x0900, 0x0DFF),
    (0x0E00, 0x0EFF),
    (0x1000, 0x109F),
    (0x1780, 0x17FF),
    (0xFB1D, 0xFDFF),
    (0xFE70, 0xFEFF),
)


@functools.lru_cache(maxsize=1)
def _font():
    import build123d

    path = os.path.join(
        os.path.dirname(build123d.__file__), "data", "fonts", "reliefsingleline", "ReliefSingleLineCAD-Regular.ttf"
    )
    font = TTFont(path)
    return font.getBestCmap(), font.getGlyphSet(), font["hmtx"]


@functools.lru_cache(maxsize=None)
def _outline_font(name):
    """One of the Windows fonts characters are outlined from, if it is there."""
    path = os.path.join(os.environ.get("SystemRoot", r"C:\Windows"), "Fonts", name)
    try:
        font = TTFont(path, fontNumber=0) if path.lower().endswith(".ttc") else TTFont(path)
        return font.getBestCmap(), font.getGlyphSet(), font["hmtx"], font["head"].unitsPerEm
    except (OSError, ValueError):
        return None


def _shaped(character):
    return any(low <= ord(character) <= high for low, high in SHAPED)


def _outline_from(character):
    """The first font a character is outlined from, or nothing."""
    if _shaped(character):
        return None
    for name in OUTLINE_FONTS:
        font = _outline_font(name)
        if font is not None and ord(character) in font[0]:
            return font
    return None


def unlettered(text):
    """The characters of a text the lettering cannot draw, each once, in order."""
    cmap = _font()[0]
    missing = []
    for character in unicodedata.normalize("NFC", text):
        if character.strip() and ord(character) not in cmap and _outline_from(character) is None:
            if character not in missing:
                missing.append(character)
    return missing


@functools.lru_cache(maxsize=2048)
def _glyph(character):
    """
    A character's strokes and advance, in the lettering's font units: from
    its own font, else outlined from the first font that has it, else a
    question mark, which a drawing refuses before it letters.
    """
    cmap, glyphs, metrics = _font()
    name = cmap.get(ord(character))
    if name is None and character.strip():
        outline = _outline_from(character)
        if outline is not None:
            outline_cmap, outline_glyphs, outline_metrics, em = outline
            outline_name = outline_cmap[ord(character)]
            pen = _Outlines(outline_glyphs)
            outline_glyphs[outline_name].draw(pen)
            k = WIDE_EM * CAP_HEIGHT / em
            outlines = [[(x * k, y * k) for x, y in stroke] for stroke in pen.strokes if len(stroke) > 1]
            return outlines, outline_metrics[outline_name][0] * k
    name = name or cmap.get(ord("?"))
    pen = _Strokes(glyphs)
    glyphs[name].draw(pen)
    return [s for s in pen.strokes if len(s) > 1], metrics[name][0]


def width(text, height):
    """How wide a line of text is, in the units of `height`."""
    return sum(_glyph(c)[1] for c in unicodedata.normalize("NFC", text)) * height / CAP_HEIGHT


def strokes(text, height, x, y, anchor="left", angle=0.0):
    """
    A line of text as strokes, its baseline from (x, y) at `angle` degrees,
    anchored at its left, centre or right. Accents written apart from their
    letters are joined to them first, as one character each.
    """
    text = unicodedata.normalize("NFC", text)
    scale = height / CAP_HEIGHT
    shift = {"left": 0.0, "centre": -width(text, height) / 2, "right": -width(text, height)}[anchor]
    cos, sin = math.cos(math.radians(angle)), math.sin(math.radians(angle))
    out = []
    pen = shift
    for character in text:
        glyph, advance = _glyph(character)
        for stroke in glyph:
            points = []
            for gx, gy in stroke:
                px, py = pen + gx * scale, gy * scale
                points.append((x + px * cos - py * sin, y + px * sin + py * cos))
            out.append(points)
        pen += advance * scale
    return out
