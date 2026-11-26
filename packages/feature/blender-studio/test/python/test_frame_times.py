"""
The moments a frame sheet draws: so many frames from a first time, every so many milliseconds,
spread evenly to an end, or spread to the timeline's end when neither is given. One frame needs
no spacing.
"""

import pytest
from zhiyin_studio.errors import Refused
from zhiyin_studio.frame_times import frame_times

# Where the timeline ends, in seconds, as the scene says.
TIMELINE_END = 4.0


def test_one_frame_is_drawn_at_its_time_with_no_spacing():
    assert frame_times({"count": 1}, TIMELINE_END) == ([0.0], None)
    assert frame_times({"count": 1, "time": 2.5}, TIMELINE_END) == ([2.5], None)


def test_frames_every_so_many_milliseconds_start_at_the_first_time():
    times, every = frame_times({"time": 1, "count": 3, "every_ms": 250}, TIMELINE_END)
    assert times == [1.0, 1.25, 1.5]
    assert every == 250


def test_frames_with_an_end_are_spread_evenly_from_the_first_time_to_it():
    times, every = frame_times({"time": 1, "end": 3, "count": 5}, TIMELINE_END)
    assert times == [1.0, 1.5, 2.0, 2.5, 3.0]
    assert every == pytest.approx(500)


def test_frames_with_neither_spacing_nor_end_are_spread_to_the_timelines_end():
    times, _ = frame_times({"count": 5}, TIMELINE_END)
    assert times == [0.0, 1.0, 2.0, 3.0, 4.0]
    # Twelve frames when the call does not say how many.
    times, _ = frame_times({}, TIMELINE_END)
    assert len(times) == 12
    assert times[0] == 0.0
    assert times[-1] == TIMELINE_END


@pytest.mark.parametrize(
    ("asked", "said"),
    [
        ({"count": 4, "every_ms": 250, "end": 2}, "every_ms spaces the frames and end spreads them to a time: give one of them."),
        ({"count": 4, "time": 2, "end": 1}, "end must come after time."),
        ({"count": 4, "time": 4}, "time is at or after the timeline's end, 4 s: give an earlier time, or an end or every_ms."),
        ({"count": 4, "every_ms": 0}, "every_ms must be at least 1."),
        ({"count": 3, "time": 599, "every_ms": 1000}, "The frames reach past 600 s."),
    ],
)
def test_frames_that_cannot_be_drawn_are_refused_in_words(asked, said):
    with pytest.raises(Refused) as refused:
        frame_times(asked, TIMELINE_END)
    assert str(refused.value) == said
