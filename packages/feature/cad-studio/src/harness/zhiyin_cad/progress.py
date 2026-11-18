"""
The steps a run has taken, written down as it takes them, each with the time
since the run began: a run stopped part way says from them how far it got and
where its time went.
"""

import os
import time

_where = None
_began = 0.0


def begin(folder, began):
    """Steps from now on are written to `folder`'s progress.txt, timed from `began`."""
    global _where, _began
    _where, _began = os.path.join(folder, "progress.txt"), began


def step(text):
    """Writes one step down at once, so it is there however the run ends."""
    if _where is None:
        return
    with open(_where, "a", encoding="utf-8") as out:
        out.write(f"{time.time() - _began:.1f} s: {text}\n")
