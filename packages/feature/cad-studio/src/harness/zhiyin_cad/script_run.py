"""
A build's first run, the only one that runs the model's script: at the
build's own arguments, again with each cut checked when a part it showed is
not a valid solid, and at each other position. It writes only what the
script built, the parts as exact geometry with what was said of them, for
the run that measures them; nothing it says of the parts is taken as
measured.
"""

import json
import os
import time

from . import bom_record, parts_file, progress
from .build import ScriptFailed, run_script

# Seconds kept back from the time a build has, for Python to start and the answer to be written.
MARGIN = 15
# The share of a build's time kept for the run that measures, exports and draws the parts.
MEASURING_SHARE = 0.4
# And at least this many seconds of it.
MEASURING_SECONDS = 30


def failed(folder, said):
    with open(os.path.join(folder, "answer.json"), "w", encoding="utf-8") as out:
        json.dump({"failed": said}, out)
    return 2


def script_run(request, folder, started, loaded):
    """Runs the script as the request says and hands its parts on; or answers why it failed."""
    script, file, name = request["script"], request.get("file"), request.get("name")
    source = request.get("source")
    arguments = request.get("arguments", [])
    # The holes bd_warehouse's hole classes make, which a callout reads the thread of.
    bom_record.start()
    try:
        run = run_script(script, file, arguments, name, source=source)
        valid = {part: shape.is_valid for part, shape in run.parts}
        if not run.skipped and not all(valid.values()):
            # A part shown broken: the script runs again with each cut
            # checked, so a cut that broke it is skipped and named. What it
            # prints again is kept back, as it was said the first time.
            progress.step("Running the script again with each cut checked, as a part it showed is not a valid solid.")
            again = run_script(script, file, arguments, name, thorough=True, quiet=True, source=source)
            if again.skipped:
                run = again
    except ScriptFailed as failure:
        return failed(folder, str(failure))
    # The holes of the run kept, before other positions make theirs.
    holes = bom_record.holes_made()
    built = time.time()
    progress.step(f"Ran the script: {len(run.parts)} {'part' if len(run.parts) == 1 else 'parts'} shown.")
    positions = request.get("positions") or []
    others, unchecked, slowest = [], [], built - loaded
    if run.parts and len(positions) > 1:
        # Each other position runs the script again with its own arguments.
        # One that would not finish before the measuring run's share of the
        # time is not started, and is named with those after it.
        seconds = request.get("seconds")
        deadline = loaded + seconds - MARGIN - max(MEASURING_SECONDS, seconds * MEASURING_SHARE) if seconds else None
        for index, given in enumerate(positions[1:], start=1):
            if deadline is not None and time.time() + slowest > deadline:
                unchecked = positions[index:]
                break
            began = time.time()
            try:
                others.append((given, run_script(script, file, given, name, source=source).parts))
            except ScriptFailed as failure:
                return failed(folder, f"At the position {' '.join(given) or 'with no arguments'}: {failure}")
            progress.step(f"Ran the script at position {index + 1} of {len(positions)}.")
            slowest = max(slowest, time.time() - began)
    times = {"import": round(loaded - started, 2), "build": round(built - loaded, 2), "total": round(time.time() - started, 2)}
    parts_file.write(folder, run, arguments, others, unchecked, round(slowest, 1), times, bool(positions))
    bom_record.write(folder, run.parts, holes)
    progress.step("Handed the parts on to be measured.")
    return 0
