"""
One run of a build. A build is two: the first runs the model's script and
hands on the parts it built (see script_run); the second, this harness alone,
reads those parts as data, measures and checks them, works out explode,
draws them, writes the exports and the picture, and writes the answer as
`answer.json`. The model's code never runs where the parts are measured. A
drawing of a Blender scene is the second alone, from the lines Blender found
of it. A part that cannot be measured or drawn is said, and the rest still
answered.
"""

import json
import os
import time
import traceback

from . import cut_check, parts_file, patterns, progress

KINDS = ("step", "stl", "3mf", "glb", "png", "motion", "bom", "helpers")
# Seconds kept back from the time a build has, which its steps count from when build123d is loaded, for Python to start and the answer to be written.
MARGIN = 15
# The most a build spends finding what nothing holds, so the rest of it keeps its time.
LOOSE_SECONDS = 60
# Seconds a drawing keeps after its views, to lay them out, dimension them and write the sheet.
LAYOUT_SECONDS = 40
# Seconds a build keeps after its sections, to draw its picture and write its answer.
PICTURE_SECONDS = 30
# The kinds of file written for printing.
PRINTED = ("stl", "3mf")
# The most a build spends finding how many objects a part written for printing prints as.
OBJECTS_SECONDS = 20


def answer_to(folder, answer):
    with open(os.path.join(folder, "answer.json"), "w", encoding="utf-8") as out:
        json.dump(answer, out)


def _exploded(parts, asked, deadline):
    """
    The parts moved apart as `asked` says, with what was worked out: those it
    names taken out, or all but those it keeps in, or, naming neither, all
    but the largest. Raises ValueError for a name or pattern that matches no
    part.
    """
    from . import explode

    names = [name for name, _ in parts]
    staying = set(patterns.expanded(asked["stay"], names, "explode.stay")) if asked.get("stay") else set()
    if asked.get("parts"):
        moving = set(patterns.expanded(asked["parts"], names, "explode.parts")) - staying
        staying |= set(names) - moving
    elif staying:
        moving = set(names) - staying
    else:
        largest = max(parts, key=lambda part: _volume(part[1]))[0]
        staying, moving = {largest}, set(names) - {largest}
    worked = explode.worked_out(parts, moving, staying, asked.get("spread", explode.SPREAD), deadline)
    told = {key: worked[key] for key in ("order", "kept", "staying", "crowded")}
    return explode.placed(parts, worked["offsets"]), worked, told


def _volume(shape):
    try:
        return shape.volume
    except Exception:  # noqa: BLE001 - a shape with no volume is the smallest
        return 0.0


def drawing(source, spec, folder, started, seconds=None, skipped=(), exploded=None, due_from=None, earlier=0.0):
    """A drawing of what `source` makes, the parts or a scene, or why it cannot be drawn as asked."""
    from .drafting.draw import DrawingRefused, draw

    by = (due_from or started) + seconds - MARGIN - LAYOUT_SECONDS if seconds else None
    try:
        report = draw(source(), spec, folder, by)
    except DrawingRefused as refused:
        reasons = "\n".join(f"- {reason}" for reason in refused.args[0])
        answer_to(folder, {"failed": f"The drawing could not be made as asked:\n{reasons}", **({"outOfTime": True} if refused.out_of_time else {})})
        return 2
    except Exception as problem:  # noqa: BLE001 - the kernel's own errors, said as the drawing's
        said = str(problem).strip() or type(problem).__name__
        answer_to(folder, {"failed": f"The drawing could not be made as asked: {said}."})
        return 2
    # With the time of the run that ran the script, for a drawing of parts.
    report["seconds"] = {"total": round(earlier + time.time() - started, 2)}
    report["picture"] = bool(spec.get("picture"))
    if exploded is not None:
        report["exploded"] = exploded
    if skipped:
        report["skipped"] = list(skipped)
    if patterns.said:
        report["patterns"] = list(patterns.said)
    answer_to(folder, {"drawing": report})
    return 0


def main(request_path, started=None):
    """Runs the request; `started` is when Python started, so the time it took to load is counted too."""
    # build123d is loaded with the harness's own modules, before this: the times its steps are due by count from here.
    loaded = time.time()
    started = started or loaded
    with open(request_path, encoding="utf-8") as given:
        request = json.load(given)
    folder = request["output"]
    progress.begin(folder, started)
    patterns.forget()
    if request.get("view") is not None:
        # One view of a drawing, worked out beside the others.
        from .drafting.apart import draw_one

        return draw_one(request)
    if request.get("api") is not None:
        # What the library installed accepts, read from it: each name asked, in order.
        from .api import look_up

        asked = request["api"] if isinstance(request["api"], list) else [request["api"]]
        later = request.get("later") or {}
        answer_to(folder, {"api": "\n\n".join(look_up(name, later) for name in asked)})
        return 0
    if request.get("reference"):
        # The installed library's reference, read whole for the catalog's pages.
        from .reference import write

        write(folder)
        return 0
    if request.get("lines"):
        # A drawing of a Blender scene, from the lines Blender found of it.
        from .drafting.scene_views import Scene

        with open(request["lines"], encoding="utf-8") as given:
            lines = json.load(given)
        progress.step("Read the lines Blender found.")
        return drawing(lambda: Scene(lines), request["drawing"], folder, started)
    if request.get("phase") == "script":
        # The first run of a build: the model's script, and nothing else.
        from .script_run import script_run

        return script_run(request, folder, started, loaded)
    # The parts the script's run built, read as data, never run.
    try:
        handed = parts_file.read(request["parts"])
    except (OSError, parts_file.Unreadable) as problem:
        answer_to(folder, {"failed": f"The parts the script built could not be read: {problem}."})
        return 3
    run = handed["run"]
    # The standard parts shown and the holes bd_warehouse made, for a parts list and a hole's callout.
    from . import bom_record

    try:
        bom_record.load(os.path.dirname(request["parts"]), [name for name, _ in run.parts])
    except (OSError, bom_record.Unreadable) as problem:
        answer_to(folder, {"failed": f"The parts the script built could not be read: {problem}."})
        return 3
    imported, before = handed["seconds"]["import"], handed["seconds"]["total"]
    valid = {name: shape.is_valid for name, shape in run.parts}
    parts, helped = run.parts, run.helped
    # What the helpers did, and the cuts skipped, said once, from the run kept.
    skipped = cut_check.said(run.skipped, parts)
    # The times of both runs: the script's, then this one's so far.
    built = before + (time.time() - started)
    progress.step(f"Ran the script: {len(parts)} {'part' if len(parts) == 1 else 'parts'} shown.")
    if not parts:
        # A script that works something out and prints it needs no part; a
        # drawing, an export or a check of positions does.
        if request.get("drawing") or request.get("exports") or request.get("positions"):
            said = "".join(f"\n- {one}" for one in helped)
            answer_to(
                folder,
                {"failed": 'The script showed no part. Pass each part to show(part, name="…").' + (f"\nWhat the helpers did:{said}" if said else "")},
            )
            return 2
        seconds = {"import": round(imported, 2), "build": handed["seconds"]["build"], "total": round(built, 2)}
        answer_to(folder, {"parts": [], "overlaps": [], "exports": [], "seconds": seconds, **({"helped": helped} if helped else {})})
        return 0
    if request.get("drawing"):
        from .drafting.draw import Solids

        try:
            chosen = patterns.expanded(request["drawing"].get("parts") or [name for name, _ in parts], [name for name, _ in parts], "the drawing's parts")
        except ValueError as problem:
            answer_to(folder, {"failed": f"The drawing could not be made as asked:\n- {problem}"})
            return 2
        # How each part is made, as a build of the script finds it: shown so,
        # by a draft requirement or cast(), or written for printing by an
        # earlier build of it; a parts list gives the title block's material
        # only to parts made a known way.
        from . import making

        names = [name for name, _ in parts]
        printed = set(request["drawing"].get("printed") or []) & set(names)
        ways = making.chosen(parts, run.making, printed, request.get("requirements"), run.features)
        made_as = {name: way["method"] for name, way in ways.items() if way["method"]}
        told = None
        if request["drawing"].get("explode") is not None:
            due = loaded + request["seconds"] - MARGIN - LAYOUT_SECONDS if request.get("seconds") else None
            try:
                parts, _, told = _exploded(parts, request["drawing"]["explode"], due)
            except ValueError as problem:
                answer_to(folder, {"failed": f"The drawing could not be made as asked:\n- {problem}"})
                return 2
            progress.step("Worked out how the parts come apart.")
        return drawing(lambda: Solids(parts, chosen, made_as=made_as), request["drawing"], folder, started, request.get("seconds"), skipped, told, loaded, before)

    from . import export, measure, motion, render

    # The time a build's sections are due by, keeping room for the picture and the answer.
    by = loaded + request["seconds"] - MARGIN - PICTURE_SECONDS if request.get("seconds") else None
    names = [name for name, _ in parts]
    # Each part's material, worked out once: its measurements and requirements are of it.
    made = {name: measure.material(shape) for name, shape in parts}
    measured = [measure.measured(name, shape, valid.get(name), made[name], run.surfaces.get(name)) for name, shape in parts]
    overlapping = measure.overlaps(parts)
    seconds = {"import": round(imported, 2), "build": handed["seconds"]["build"]}
    answer = {
        "parts": measured,
        "overlaps": overlapping,
        "loose": measure.loose(parts, seconds=LOOSE_SECONDS, printed=_printed(request, names)),
        **({"helped": helped} if helped else {}),
        **({"skipped": skipped} if skipped else {}),
        **({"empty": empty} if (empty := cut_check.empty_said(run.empty)) else {}),
        "exports": [],
        "seconds": seconds,
    }
    progress.step("Measured the parts and checked them for overlaps and for pieces touching nothing.")
    # The parts as the picture, the preview and the exports marked exploded show them.
    shown, worked = parts, None
    if request.get("explode") is not None:
        try:
            shown, worked, answer["exploded"] = _exploded(parts, request["explode"], by)
        except ValueError as problem:
            answer_to(folder, {"failed": f"{problem}."})
            return 2
        progress.step("Worked out how the parts come apart.")
    # How many separate objects each part written for printing prints as, worked out once.
    printing = {}
    for index, wanted in enumerate(request.get("exports", [])):
        try:
            chosen = patterns.expanded(wanted.get("parts") or names, names, f"exports[{index}].parts")
        except ValueError as problem:
            answer_to(folder, {"failed": f"{problem}."})
            return 2
        wanted["parts"] = chosen
        unknown = [name for name in chosen if name not in names]
        if unknown:
            answer_to(
                folder,
                {"failed": f"An export names {', '.join(unknown)}, which the script did not show. It showed {', '.join(names)}."},
            )
            return 2
        if wanted["kind"] not in KINDS:
            raise ValueError(f"No export of kind {wanted['kind']}.")
        path = os.path.join(folder, wanted["file"])
        if wanted["kind"] == "helpers":
            # Show and the helpers as one file, for the script to run beside it anywhere; it holds no part.
            from . import standalone

            answer["exports"].append({"file": wanted["file"], "bytes": standalone.write(path), "parts": []})
            continue
        selected =[(n, s) for n, s in (shown if wanted.get("exploded") else parts) if n in chosen]
        if wanted["kind"] == "motion" and worked is not None:
            # The assembly sequence: every part out, then each going in in turn.
            from . import explode

            positions, at_each, built = explode.sequence([(n, s) for n, s in parts if n in chosen], worked)
            told = {**motion.write(path, positions, at_each, base=built, straight=True), "sequence": True}
            answer["exports"].append({"file": wanted["file"], "bytes": os.path.getsize(path), "parts": chosen, "motion": told})
            continue
        if wanted["kind"] == "motion":
            # Written once every position is checked, from the parts there;
            # in its place among the exports, which the answer keeps.
            answer["exports"].append({"file": wanted["file"], "bytes": 0, "parts": chosen})
            continue
        if wanted["kind"] == "bom":
            # A parts list of the parts named, with the files of this call that hold each.
            from . import bom

            try:
                told = bom.write(path, selected, wanted.get("materials"), bom.files_of(request.get("exports", []), names))
            except ValueError as problem:
                answer["exports"].append({"file": wanted["file"], "bytes": 0, "parts": chosen, "failed": str(problem)})
                continue
            answer["exports"].append({"file": wanted["file"], "bytes": os.path.getsize(path), "parts": chosen, "bom": told})
            progress.step("Wrote the parts list.")
            continue
        if wanted["kind"] == "png":
            # The views the answer shows, of the parts named, with the cuts asked for.
            try:
                render.sheet(selected, path, _section_panels(selected, request.get("sections"), by, folder)[0])
            except Exception as problem:  # noqa: BLE001 - the build stands without this picture
                answer["exports"].append(
                    {"file": wanted["file"], "bytes": 0, "parts": chosen, "failed": f"its picture could not be drawn: {_failure(problem)}"}
                )
                continue
            size, mesh = os.path.getsize(path), None
        else:
            # Each file on its own: one that cannot be written costs only itself.
            try:
                size, mesh = export.write(wanted["kind"], selected, path, wanted.get("detail"), run.surfaces.get, run.wire)
            except Exception as problem:  # noqa: BLE001 - the build stands without this file
                if os.path.exists(path):
                    os.remove(path)
                answer["exports"].append({"file": wanted["file"], "bytes": 0, "parts": chosen, "failed": _failure(problem)})
                continue
        # A file for printing says each part in it that prints as several objects.
        apart = {}
        if wanted["kind"] in PRINTED:
            for name, shape in selected:
                if name not in printing:
                    printing[name] = measure.objects(shape, OBJECTS_SECONDS) if len(shape.solids()) > 1 else 1
                if printing[name] and printing[name] > 1:
                    apart[name] = {"solids": len(shape.solids()), "objects": printing[name]}
        answer["exports"].append(
            {"file": wanted["file"], "bytes": size, "parts": chosen, **({"mesh": mesh} if mesh else {}), **({"objects": apart} if apart else {})}
        )
        progress.step(f"Wrote the {wanted['kind'].upper()} file.")
    if request.get("preview"):
        # The person's view of the parts; the build stands without it.
        try:
            export.preview(shown, os.path.join(folder, request["preview"]), run.wire)
            answer["preview"] = request["preview"]
        except Exception:
            answer["previewFailed"] = traceback.format_exc(limit=3)
    if request.get("picture"):
        more, notes = _section_panels(shown, request.get("sections"), by, folder)
        if notes:
            answer["sectionNotes"] = notes
        try:
            undrawn = render.sheet(shown, os.path.join(folder, request["picture"]), more)
            answer["picture"] = request["picture"]
            progress.step("Drew the picture.")
            if more:
                answer["sections"] = len(more)
            if undrawn:
                answer["undrawn"] = [{"name": name, "why": why} for name, why in undrawn]
        except render.NothingDrawn as nothing:
            answer["pictureFailed"] = str(nothing)
        except Exception as problem:  # noqa: BLE001 - the measurements stand without the picture
            answer["pictureFailed"] = str(problem).strip() or type(problem).__name__
    asked = request.get("requirements") or []
    # The parts at each other position, kept only for clearances asked for.
    elsewhere = []
    keep_positions = any(one.get("check") == "clearance" for one in asked)
    positions = request.get("positions")
    if handed["positioned"] and positions:
        # The first position is the build itself; the script ran again at
        # each other, in the run before this one, and each is checked here
        # for overlaps alone. Those it had no time left to start are named,
        # for another call.
        answer["positions"] = [{"arguments": handed["arguments"], "overlaps": answer["overlaps"]}]
        moving = [wanted for wanted in request.get("exports", []) if wanted["kind"] == "motion"]
        placed = [motion.corners(parts)] if moving else []
        for index, (arguments, moved) in enumerate(handed["others"], start=1):
            answer["positions"].append({"arguments": arguments, "overlaps": measure.overlaps(moved)})
            if keep_positions:
                elsewhere.append((" ".join(arguments) or "with no arguments", moved))
            if moving:
                placed.append(motion.corners(moved))
            progress.step(f"Checked position {index + 1} of {len(positions)}.")
        if handed["unchecked"]:
            answer["unchecked"] = handed["unchecked"]
        answer["seconds"]["position"] = handed["slowest"]
        for wanted in moving:
            chosen = set(wanted.get("parts") or names)
            told = motion.write(
                os.path.join(folder, wanted["file"]),
                positions,
                [{name: corners for name, corners in at.items() if name in chosen} for at in placed],
            )
            entry = next(one for one in answer["exports"] if one["file"] == wanted["file"])
            entry.update({"bytes": os.path.getsize(os.path.join(folder, wanted["file"])), "motion": told})
        if request.get("steps") and handed["others"]:
            # A sweep: how near the moving parts come over every position, the steps between those listed among them.
            from . import sweep

            answer.setdefault("mechanism", []).append(sweep.said([(handed["arguments"], parts), *handed["others"]], request["steps"], by))
            progress.step("Found how near the moving parts come over the sweep.")
    if request.get("sweep"):
        # Parts that move as one piece, moved from this one build.
        from . import rigid_sweep

        answer.setdefault("mechanism", []).append(rigid_sweep.said(parts, request["sweep"], by))
        progress.step("Swept the moving parts through their move.")
    # How the gears shown mesh, as built.
    from . import gears

    meshed = gears.meshes(bom_record.kept_gears())
    if meshed:
        answer.setdefault("mechanism", []).extend(meshed)
    if asked:
        from . import requirements

        named = {name: (shape, run.surfaces.get(name) or {}) for name, shape in parts}
        answer["requirements"] = requirements.checked([(name, made[name][0]) for name in names], asked, answer["overlaps"], elsewhere, named)
        progress.step("Checked the requirements.")
    # Each part checked for the way it is made, where the build says or shows it.
    from . import making

    ways = making.chosen(parts, run.making, _printed(request, names), asked, run.features)
    found, unchecked = making.checked([(name, made[name][0]) for name in names], ways, run.features, by)
    if found:
        answer["making"] = found
    if unchecked:
        answer["makingUnchecked"] = unchecked
    progress.step("Checked each part for the way it is made.")
    answer["seconds"]["total"] = round(before + time.time() - started, 2)
    if patterns.said:
        answer["patterns"] = list(patterns.said)
    answer_to(folder, answer)
    return 0


def _printed(request, names):
    """
    The parts meant to print: those a file for printing holds, and those an
    overhang requirement checks. A name that matches nothing is left to the
    export or the requirement to refuse.
    """
    asked = [wanted.get("parts") or names for wanted in request.get("exports", []) if wanted.get("kind") in PRINTED]
    asked += [[one["part"]] for one in request.get("requirements") or [] if one.get("check") == "overhang" and isinstance(one.get("part"), str)]
    found = set()
    for given in asked:
        try:
            found.update(patterns.expanded(given, names, "the parts to print"))
        except ValueError:
            continue
    return found & set(names)


def _failure(problem):
    """Why a file was not written, in words: a part that could not be meshed is named with why."""
    return str(problem).strip() or type(problem).__name__


def _section_panels(parts, asked, by=None, folder=None):
    """The cuts asked for, drawn of these parts, with what could not be drawn; none when none were asked for."""
    if not asked:
        return [], []
    from . import sections

    try:
        return sections.panels(parts, asked, by, folder)
    except Exception as problem:  # noqa: BLE001 - the views stand without the sections
        return [], [f"The sections could not be drawn: {str(problem).strip() or type(problem).__name__}."]
