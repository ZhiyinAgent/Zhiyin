"""Draws every picture of the Dots look into its folder, as lossless WebP.

    python scripts/looks/dots/draw.py

Needs NumPy, SciPy and Pillow; the pictures in the repository were drawn with
NumPy 2.4.4, SciPy 1.17.1 and Pillow 12.2.0, and other versions may place a
few dots differently. Takes about half a minute and under 1 GB of memory.
"""

from pathlib import Path

import bamboo
import landscape
import mark
from PIL import Image

REPOSITORY = Path(__file__).resolve().parents[3]
LOOK = REPOSITORY / "apps" / "desktop" / "src" / "renderer" / "looks" / "dots"
ICON = REPOSITORY / "apps" / "desktop" / "build" / "icon.png"
THEME = {"night": "dark", "day": "light"}


def save(array, name):
    path = LOOK / f"{name}.webp"
    Image.fromarray(array).save(path, "WEBP", lossless=True, quality=100, method=6)
    print("wrote", path.relative_to(REPOSITORY), f"{path.stat().st_size // 1024} KiB")


def main():
    night, day = landscape.draw()
    save(night, "landscape-dark")
    save(day, "landscape-light")
    for theme, strip in zip(("night", "day"), bamboo.draw()):
        save(strip, f"bamboo-{THEME[theme]}")
    # The mark beside the name is the 24 px one; the small one sits in a line
    # of the conversation, as SVG.
    suffix = {24: "", "large": "-large"}
    for (theme, size), image in mark.draw(ICON).items():
        if size == 17:
            path = LOOK / f"mark-{THEME[theme]}-small.svg"
            path.write_text(mark.svg(image, size), encoding="utf-8")
            print("wrote", path.relative_to(REPOSITORY))
        else:
            save(image, f"mark-{THEME[theme]}{suffix[size]}")


if __name__ == "__main__":
    main()
