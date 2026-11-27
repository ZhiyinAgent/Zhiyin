"""
Lists the system's fonts as ezdxf, which build123d loads, does on a start
that finds no list, and writes the list into the folder given, for Zhiyin to
keep for the CAD studio's runs. It runs nothing else.

    python -I -X utf8 font_list.py <folder>
"""

import os
import sys

# ezdxf keeps its list below this folder, and lists the fonts as it is
# imported when no list is there.
os.environ["XDG_CACHE_HOME"] = sys.argv[1]

import ezdxf.fonts.fonts  # noqa: E402, F401
