"""
One of the CAD studio's two runs of a build, as its request says: the first
runs the script and hands on the parts it shows; the second, which runs no
code of the script's, measures them, exports what the call names and draws
them, then writes its answer as JSON.

    python -P -B run.py [--fonts <folder>] <script request.json>
    python -I -X utf8 run.py [--when-ready] [--fonts <folder>] <request.json>

With --when-ready the second run is started beside the first: it loads
build123d and the harness while the script runs, then waits for its request,
which Zhiyin writes whole, under its name at once, only once the first run
has ended and handed on its parts. Until then it reads nothing of the run's.

With --fonts, ezdxf, which build123d loads, reads the list of the system's
fonts Zhiyin keeps in that folder, which the run may only read, instead of
listing the fonts again.

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
# ezdxf, which build123d loads, lists the system's fonts when it finds no list
# to read, warns of any it cannot read, and of a list it cannot write: nothing
# of the build's, and misleading in its answer.
logging.getLogger("ezdxf").setLevel(logging.ERROR)
OPTIONS = sys.argv[1:-1]
if "--fonts" in OPTIONS:
    # Read by ezdxf as it is first imported, below.
    os.environ["XDG_CACHE_HOME"] = OPTIONS[OPTIONS.index("--fonts") + 1]

from zhiyin_cad.main import main  # noqa: E402

# How often a run started beside the script's looks for its request.
WAITING_SECONDS = 0.02

if __name__ == "__main__":
    request = sys.argv[-1]
    if "--when-ready" in OPTIONS:
        while not os.path.exists(request):
            time.sleep(WAITING_SECONDS)
        # Its time counts from its request: its loading ran beside the script's run.
        STARTED = time.time()
    sys.exit(main(request, STARTED))
