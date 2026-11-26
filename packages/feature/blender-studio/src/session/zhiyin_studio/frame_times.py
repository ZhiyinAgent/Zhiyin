"""
The moments a frame sheet draws: so many frames from a first time, every so many milliseconds,
spread evenly to an end, or spread to the timeline's end when neither is given. One frame needs
no spacing.
"""

from .arguments import need, number, whole
from .timeline import LONGEST, START, moment, seconds_text

# How many frames a sheet draws at most, and when the call does not say.
MOST_FRAMES, FRAMES = 36, 12


def frame_times(args, timeline_end):
    """
    The times a sheet's frames are at, in seconds, and the milliseconds between them, or None
    for one frame. `timeline_end` is where the scene's timeline ends, in seconds.
    """
    first = moment(args.get("time"), "time", default=START)
    count = whole(args.get("count"), "count", minimum=1, maximum=MOST_FRAMES, default=FRAMES)
    need(
        args.get("every_ms") is None or args.get("end") is None,
        "every_ms spaces the frames and end spreads them to a time: give one of them.",
    )
    every = number(args["every_ms"], "every_ms", minimum=1, maximum=LONGEST * 1000) if args.get("every_ms") is not None else None
    if count == 1:
        return [first], None
    if every is None:
        if args.get("end") is not None:
            last = moment(args["end"], "end")
            need(last > first, "end must come after time.")
        else:
            last = min(timeline_end, LONGEST)
            need(
                last > first,
                f"time is at or after the timeline's end, {seconds_text(last)}: give an earlier time, or an end or every_ms.",
            )
        every = (last - first) * 1000 / (count - 1)
        # The last frame exactly at the end, whatever the sum of the steps comes to.
        return [first + i * every / 1000 for i in range(count - 1)] + [last], every
    times = [first + i * every / 1000 for i in range(count)]
    need(times[-1] <= LONGEST, f"The frames reach past {LONGEST} s.")
    return times, every
