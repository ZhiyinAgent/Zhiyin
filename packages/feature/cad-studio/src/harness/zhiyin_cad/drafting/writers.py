"""
A sheet written as SVG, PDF or PNG, each from the same lines in the same
millimetres: SVG and PDF as vectors at their true size, PNG as a picture of
it. Text is strokes already, so no format needs a font.
"""

import math
import zlib

from PIL import Image, ImageDraw

from .sheet import LAYERS, dashes

INK = (20, 22, 26)
PAPER = (255, 255, 255)


def _dashed(points, pattern):
    """A run of points cut into its dashes, as runs of points."""
    if not pattern:
        return [points]
    runs, current = [], [points[0]]
    index, left, on = 0, pattern[0], True
    for a, b in zip(points, points[1:]):
        length = math.dist(a, b)
        at = 0.0
        while length - at > left:
            at += left
            t = at / length
            point = (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)
            if on:
                current.append(point)
                runs.append(current)
            current = [point]
            on = not on
            index = (index + 1) % len(pattern)
            left = pattern[index]
        left -= length - at
        if on:
            current.append(b)
        else:
            current = [b]
    if on and len(current) > 1:
        runs.append(current)
    return [r for r in runs if len(r) > 1]


def svg(sheet, path):
    height = sheet.height
    out = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{sheet.width}mm" height="{height}mm" '
        f'viewBox="0 0 {sheet.width} {height}">',
        f'<rect width="{sheet.width}" height="{height}" fill="white"/>',
    ]
    by_layer = {}
    for layer, points, closed in sheet.polylines(0.02):
        by_layer.setdefault(layer, []).append((points, closed))
    for layer, runs in by_layer.items():
        style = LAYERS[layer]
        dash = f' stroke-dasharray="{" ".join(f"{d:g}" for d in style["dash"])}"' if style["dash"] else ""
        out.append(
            f'<g id="{layer}" fill="none" stroke="black" stroke-width="{style["width"]:g}" '
            f'stroke-linecap="round" stroke-linejoin="round"{dash}>'
        )
        for points, closed in runs:
            d = "M" + " L".join(f"{x:.3f},{height - y:.3f}" for x, y in points) + (" Z" if closed else "")
            own = dashes(layer, points, closed)
            if not style["dash"] or own == style["dash"]:
                fitted = ""
            elif own:
                fitted = f' stroke-dasharray="{" ".join(f"{v:.3f}" for v in own)}"'
            else:
                fitted = ' stroke-dasharray="none"'
            out.append(f'<path d="{d}"{fitted}/>')
        out.append("</g>")
    if sheet.fills:
        out.append('<g id="arrows" fill="black" stroke="none">')
        for _, points in sheet.fills:
            out.append('<path d="M' + " L".join(f"{x:.3f},{height - y:.3f}" for x, y in points) + ' Z"/>')
        out.append("</g>")
    out.append("</svg>")
    with open(path, "w", encoding="utf-8") as file:
        file.write("\n".join(out))


def pdf(sheet, path):
    unit = 72 / 25.4
    commands = ["1 J 1 j"]
    for layer, points, closed in sheet.polylines(0.02):
        style = LAYERS[layer]
        own = dashes(layer, points, closed)
        dash = " ".join(f"{d * unit:.3f}" for d in own) if own else ""
        commands.append(f"{style['width'] * unit:.3f} w [{dash}] 0 d")
        commands.append(
            f"{points[0][0] * unit:.3f} {points[0][1] * unit:.3f} m "
            + " ".join(f"{x * unit:.3f} {y * unit:.3f} l" for x, y in points[1:])
            + (" h S" if closed else " S")
        )
    for _, points in sheet.fills:
        commands.append(
            f"{points[0][0] * unit:.3f} {points[0][1] * unit:.3f} m "
            + " ".join(f"{x * unit:.3f} {y * unit:.3f} l" for x, y in points[1:])
            + " h f"
        )
    stream = zlib.compress("\n".join(commands).encode("ascii"))
    width, height = sheet.width * unit, sheet.height * unit
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {width:.3f} {height:.3f}] /Contents 4 0 R /Resources << >> >>".encode(),
        f"<< /Length {len(stream)} /Filter /FlateDecode >>\nstream\n".encode() + stream + b"\nendstream",
    ]
    body = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    offsets = []
    for number, content in enumerate(objects, start=1):
        offsets.append(len(body))
        body += f"{number} 0 obj\n".encode() + content + b"\nendobj\n"
    xref = len(body)
    body += f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode()
    for offset in offsets:
        body += f"{offset:010d} 00000 n \n".encode()
    body += f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    with open(path, "wb") as file:
        file.write(body)


def png(sheet, path, longest=2400):
    """The sheet as a picture, its long side `longest` pixels, drawn at twice that and reduced."""
    per_mm = longest / max(sheet.width, sheet.height)
    big = 2
    scale = per_mm * big
    size = (round(sheet.width * scale), round(sheet.height * scale))
    image = Image.new("RGB", size, PAPER)
    draw = ImageDraw.Draw(image)
    to = lambda p: (p[0] * scale, size[1] - p[1] * scale)
    for layer, points, closed in sheet.polylines(0.5 / per_mm):
        style = LAYERS[layer]
        run = points + [points[0]] if closed else points
        width = max(big, round(style["width"] * scale))
        for dash in _dashed(run, dashes(layer, points, closed)):
            draw.line([to(p) for p in dash], fill=INK, width=width, joint="curve")
    for _, points in sheet.fills:
        draw.polygon([to(p) for p in points], fill=INK)
    image = image.resize((round(sheet.width * per_mm), round(sheet.height * per_mm)), Image.LANCZOS)
    image.save(path, "PNG")
