"""
One of the CAD studio's two runs of a build, as its request says: the first
runs the script and hands on the parts it shows; the second, which runs no
code of the script's, measures them, exports what the call names and draws
them, then writes its answer as JSON.

    python -P -B run.py <script request.json>
    python -I -X utf8 run.py <request.json>

Exit 0 with an answer, 2 when the script itself failed or showed nothing, in
words the model can act on; anything else is Zhiyin's own failure.
"""

import time

# Taken first, before anything is loaded, so a build's time counts loading build123d too.
STARTED = time.time()

import faulthandler  # noqa: E402
import logging  # noqa: E402
import os  # noqa: E402
import sys  # noqa: E402

# A crash of Python itself, as the geometry kernel causes on a shape it cannot
# work, writes the stack it happened in, so the answer can say where.
faulthandler.enable()

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
# What the script prints reaches Zhiyin line by line, so a build stopped
# part way still shows what it printed.
sys.stdout.reconfigure(line_buffering=True)
# ezdxf, which build123d loads, lists the system's fonts on every start and
# warns of any it cannot read: nothing of the build's, and misleading in its answer.
logging.getLogger("ezdxf").setLevel(logging.ERROR)

from zhiyin_cad.main import main  # noqa: E402

if __name__ == "__main__":
    sys.exit(main(sys.argv[1], STARTED))
