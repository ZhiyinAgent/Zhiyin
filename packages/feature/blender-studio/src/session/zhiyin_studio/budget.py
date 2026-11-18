"""
The time a command may still spend, and the share of it each check takes.

Zhiyin sends each command with the seconds it may run; past them Blender is stopped. The session
starts the command's budget as the command arrives, keeping back a tenth for saving and the
answer. A check that runs within a time asks for its share: the most it would take on its own,
and never more than half of what is left, so checks run one after another leave time for each
other and for the work after them, and together never take the whole.
"""

import contextlib
import math
import time

# The share of a command's time kept back for saving the scene and writing the answer.
KEPT_BACK = 0.1
# The most of what is left one check takes.
SHARE = 0.5

_ends = {"at": math.inf}


def start(seconds):
    """Starts a command's budget: `seconds` it may run, or no limit when it names none."""
    timed = isinstance(seconds, (int, float)) and not isinstance(seconds, bool)
    _ends["at"] = time.monotonic() + max(0.0, seconds) * (1 - KEPT_BACK) if timed else math.inf


def left():
    """The seconds the command has left for its checks, never below 0."""
    return max(0.0, _ends["at"] - time.monotonic())


def share(most):
    """The seconds one check may take: `most`, or half of what is left when that is less."""
    return min(float(most), SHARE * left())


@contextlib.contextmanager
def limited(seconds):
    """For as long as it lasts, the command's time is `seconds` from now; then it is as it was."""
    was = _ends["at"]
    start(seconds)
    try:
        yield
    finally:
        _ends["at"] = was
