"""
What an animation measures once all of a call's motion is set: a bone's tip at its key, a driven
value or a stretched part over the timeline. Each is worked out at the end of the call, in its
place in the answer.
"""

import math

from .finding import scene

# The most frames a value is read at over the timeline; past them, every so many.
MOST_READ = 360

_pending = []


def defer(said_by_object, name, work):
    """Keeps a place in an object's answer for what `work` says once the call's motion is set."""
    entries = said_by_object.setdefault(name, [])
    entries.append("")
    _pending.append((entries, len(entries) - 1, work))


def settle():
    """Works out every deferred measure, in the order given, and forgets them."""
    try:
        for entries, index, work in _pending:
            entries[index] = work()
    finally:
        _pending.clear()


def forget():
    _pending.clear()


def over_timeline(read):
    """`read()` at frames from the timeline's start to its end, as (frame, value) pairs."""
    s = scene()
    frames = list(range(s.frame_start, s.frame_end + 1))
    step = max(1, math.ceil(len(frames) / MOST_READ))
    taken = frames[::step]
    if taken[-1] != frames[-1]:
        taken.append(frames[-1])
    kept = s.frame_current
    found = []
    try:
        for frame in taken:
            s.frame_set(frame)
            found.append((frame, read()))
    finally:
        s.frame_set(kept)
    return found
