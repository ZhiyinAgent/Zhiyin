"""
The views of a drawing of parts worked out side by side: each by a run of the
harness of its own, as many at once as there are cores to spare, so a drawing
takes about as long as its slowest view rather than all of them together. A
view not done when the time for views runs out is stopped and left out; a
run that ends without an answer is that view's failure, said as such.
"""

import json
import os
import shutil
import subprocess
import sys
import time

from .. import parts_file, progress

# The most views worked out at once: each run holds the parts and the
# kernel's work on them, about a gigabyte for an engine of seventy parts.
MOST_AT_ONCE = 6
RUN = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "run.py")


class LeftOut(Exception):
    """A view not done in the time the drawing had for its views."""


class ViewFailed(Exception):
    """A view's run that ended without a view: why, in words."""


def worked_out(parts, centre, specs, named, by, folder, gears=None, bearings=None):
    """
    Each spec's view by its place among `specs`, worked out apart: the view,
    or the exception that stopped it, ValueError for a request it refuses.
    `parts` are (name, shape) pairs; `by` is the time, as time.time() gives
    it, the views are due by, or None; `gears` the gears each part keeps, by
    its name, which a drawing draws as ISO 2203 does, and `bearings` the
    outline of each bought bearing, drawn as ISO 8826-1 does.
    """
    place = os.path.join(folder, "views")
    os.makedirs(place, exist_ok=True)
    try:
        # The parts as exact geometry, data that runs nothing, for each view's run to read.
        given = os.path.join(place, "parts.json")
        with open(given, "w", encoding="utf-8") as out:
            json.dump(
                {
                    "parts": parts_file.write_parts(place, "part", parts),
                    "centre": list(centre) if centre is not None else None,
                    "gears": gears or {},
                    "bearings": bearings or {},
                },
                out,
            )
        waiting = list(enumerate(specs))
        running = {}
        results = {}
        at_once = max(1, min(MOST_AT_ONCE, (os.cpu_count() or 2) - 1))
        while waiting or running:
            while waiting and len(running) < at_once:
                index, spec = waiting.pop(0)
                running[index] = _start(place, index, spec, given)
                progress.step(f"Drawing {named(spec)}.")
            for index, (process, own, output) in list(running.items()):
                if process.poll() is None:
                    continue
                del running[index]
                output.close()
                results[index] = _answer(own, process.returncode)
                if not isinstance(results[index], Exception):
                    view = results[index]
                    progress.step(f"Drew {named(specs[index])}: {len(view.lines)} lines and {len(view.arcs)} arcs.")
            if by is not None and time.time() > by:
                for index, (process, own, output) in running.items():
                    done = process.poll() is not None
                    if not done:
                        process.kill()
                    process.wait()
                    output.close()
                    results[index] = _answer(own, process.returncode) if done else LeftOut()
                for index, _ in waiting:
                    results[index] = LeftOut()
                running, waiting = {}, []
                break
            time.sleep(0.05)
        return results
    finally:
        shutil.rmtree(place, ignore_errors=True)


def _start(place, index, spec, given):
    own = os.path.join(place, str(index))
    os.makedirs(own, exist_ok=True)
    request = os.path.join(own, "request.json")
    with open(request, "w", encoding="utf-8") as out:
        json.dump({"view": spec, "parts": given, "output": own}, out)
    # Its output goes to a file of its own: a confined run may not open the
    # null device, and a pipe nobody reads would fill and stop it.
    output = open(os.path.join(own, "output.txt"), "w", encoding="utf-8")
    # Isolated, as the run that starts it is: nothing of the workspace on its path.
    process = subprocess.Popen(
        [sys.executable, "-I", "-X", "utf8", RUN, request],
        cwd=own,
        stdin=subprocess.PIPE,
        stdout=output,
        stderr=subprocess.STDOUT,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )
    process.stdin.close()
    return process, own, output


def _answer(own, code):
    from .views import View

    path = os.path.join(own, "view.json")
    if not os.path.exists(path):
        with open(os.path.join(own, "output.txt"), encoding="utf-8", errors="replace") as said:
            last = [line.strip() for line in said.read().splitlines() if line.strip()][-1:]
        return ViewFailed(f"its run ended with exit code {code} and no view" + (f": {last[0]}" if last else ""))
    # Read as plain data, as every file one run hands another is.
    with open(path, encoding="utf-8") as given:
        answer = json.load(given)
    if "refused" in answer:
        return ValueError(answer["refused"])
    if "failed" in answer:
        kind, said = answer["failed"]
        return ViewFailed(f"{kind}, {said}")
    return View.from_data(answer["view"])


def draw_one(request):
    """A run's one view, from the parts another run handed it: the view, or why it was not made."""
    from .draw import Solids

    with open(request["parts"], encoding="utf-8") as given:
        handed = json.load(given)
    parts = parts_file.read_parts(os.path.dirname(request["parts"]), handed["parts"])
    # A view of some of the parts, as a build's section may be, is centred on them.
    chosen = request["view"].get("parts")
    source = Solids(parts, chosen or [name for name, _ in parts], centre=None if chosen else handed["centre"], gears=handed.get("gears") or {}, bearing_outlines=handed.get("bearings") or {})
    try:
        answer = {"view": source.view(request["view"]).as_data()}
    except (ValueError, KeyError) as problem:
        answer = {"refused": str(problem).strip("'\"")}
    except Exception as problem:  # noqa: BLE001 - the kernel's own failures, said as the view's
        answer = {"failed": (type(problem).__name__, str(problem).strip() or "no reason given")}
    with open(os.path.join(request["output"], "view.json"), "w", encoding="utf-8") as out:
        json.dump(answer, out)
    return 0
