"""
What each simulation in the scene holds, as the tools that show a moment, describe the scene or
render a video say it. A baked one is read from its bake, over the frames it was baked over, which
may fall short of the scene's; an unbaked one Blender works out from the frame
before, so it is reached by stepping every frame from where it starts, and a video that skips
frames, starts after it or is rendered over several calls would jump it: such a video is refused
until it is baked.
"""

from .errors import Refused
from .finding import scene
from .sim_bake import simulations
from .timeline import seconds_of, seconds_text
from .wording import listed


def frames_text(span):
    return f"frames {span[0]} to {span[1]}"


def states():
    """Each simulation with the frames its bake holds: nothing when it is not baked, or baked over frames not kept."""
    return [(one, one.baked_range() if one.baked() else None) for one in simulations()]


def unbaked():
    """The simulations not baked, which are worked out from the frame before."""
    return [one for one in simulations() if not one.baked()]


def stepping_start():
    """The frame stepping must start from to reach any moment of every unbaked simulation: the earliest of their starts."""
    room = scene()
    return min([room.frame_start] + [one.starts() for one in unbaked()])


def all_baked():
    """Whether every simulation in the scene is baked, so any moment can be read straight from its bake."""
    return all(one.baked() for one in simulations())


def scene_text():
    """The scene's simulations for its description: each baked range against the scene's, or unbaked; nothing when there are none."""
    room = scene()
    found = states()
    if not found:
        return ""
    said = []
    for one, span in found:
        if span is not None:
            line = f"{one.label} baked over {frames_text(span)}"
            short = [
                part
                for part in (
                    f"starting after the scene's {room.frame_start}" if span[0] > room.frame_start else "",
                    f"ending before the scene's {room.frame_end}" if span[1] < room.frame_end else "",
                )
                if part
            ]
            if short:
                line += f", {' and '.join(short)}: frames outside it show it as at the bake's ends, so bake again"
            said.append(line)
        elif one.baked():
            said.append(f"{one.label} baked")
        else:
            said.append(f"{one.label} not baked: worked out frame by frame from frame {one.starts()}, so it must be baked before a video that skips frames")
    return f"Simulations, against the scene's frames {room.frame_start} to {room.frame_end}: " + "; ".join(said) + "."


def reached_text(first, last):
    """
    How a look at frames `first` to `last` reached each simulation: read from its bake, which may
    not cover them, or stepped through every frame from its start; nothing when there are none.
    """
    found = states()
    if not found:
        return ""
    stepped = [one.label for one, _ in found if not one.baked()]
    read = [one for one, _ in found if one.baked()]
    said = []
    if stepped:
        start = stepping_start()
        said.append(
            f"{listed(stepped)} {'is' if len(stepped) == 1 else 'are'} not baked, so each moment was reached by stepping"
            f" every frame from frame {start} ({seconds_text(max(0.0, seconds_of(start)))})"
        )
    for one in read:
        span = one.baked_range()
        if span is None:
            said.append(f"{one.label} was read from its bake")
            continue
        line = f"{one.label} was read from its bake of {frames_text(span)}"
        if first < span[0] or last > span[1]:
            line += f", which does not reach every frame looked at ({round(first)} to {round(last)}): there it shows as at the bake's ends"
        said.append(line)
    return "Simulations: " + "; ".join(said) + "."


def video_check(first, last, sequential):
    """
    Refuses a video that would show a simulation wrongly, and answers what it says of the rest.
    `sequential` is whether Blender renders every frame from `first` to `last` in order in this
    call, as it steps an unbaked simulation itself.
    """
    found = states()
    if not found:
        return ""
    faults, said = [], []
    for one, span in found:
        if span is not None:
            if first < span[0] or last > span[1]:
                faults.append(
                    f"{one.label} is baked over {frames_text(span)}, and the video runs over frames {first} to {last}"
                )
            else:
                said.append(f"{one.label} read from its bake")
        elif one.baked():
            said.append(f"{one.label} read from its bake")
        elif not sequential or first > one.starts():
            how = "starts after it does" if sequential else "skips frames or is rendered over several calls"
            faults.append(f"{one.label} is not baked, and this video {how}, which would jump it")
        else:
            said.append(f"{one.label}, not baked, worked out by Blender frame by frame as it rendered from frame {first}")
    if faults:
        raise Refused(
            "This video would show a simulation wrongly: " + "; ".join(faults) + "."
            " Bake every simulation over the timeline first with blender_simulate's bake true, then render."
        )
    return " Simulations: " + "; ".join(said) + "."
