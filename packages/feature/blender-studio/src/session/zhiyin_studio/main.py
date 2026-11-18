"""The session: one command at a time from Zhiyin's pipe, one answer on the other.

A command that changes the scene is saved, then previewed. A command that
fails puts the saved file back, so a half-made change never stays.

A model's script never runs in the session. A Blender started for it alone,
sealed, opens the scene, runs the script, saves the scene and is ended; the
session, which holds the scene as it was, then loads the saved file and says
what the script left, checks it, measures it and draws it, so nothing the
script left in Python reaches those.
"""

import ast
import contextlib
import io
import json
import math
import msvcrt
import os
import traceback

import bpy
import mathutils
import numpy

from . import (
    baking,
    budget,
    change_checks,
    close_ups,
    decals,
    describe,
    drafting_lines,
    former_names,
    library,
    look,
    measuring,
    reference,
    reports,
    rigging,
    saved_unused,
    scattering,
    shaping,
    simulating,
    spec,
    unwrapping,
)
from .add_objects import add_objects
from .aiming import refocus_scene
from .animate import animate
from .arguments import need
from .camera import set_camera
from .command_terms import terms
from .disk_files import files_read, outside
from .drivers import unrun_drivers
from .edit_objects import edit_objects
from .errors import Refused, keep_error
from .export import export
from .finding import forget_patterns, is_helper, patterns_said, scene_objects
from .frame_sheet import frame_sheet
from .geometry import own_size, shown_as_evaluated, world_bounds
from .glass import light_through_sheets
from .graphics_card import DRAWING, end_on_card_drawing, left_out_text
from .keys import fcurves_of
from .lighting import set_lighting
from .material import set_material
from .motion_checks import lone_keys
from .overlaps import in_the_same_place
from .pictures import Device
from .placing import placed
from .preview import preview
from .render import render
from .render_video import render_video
from .scene_file import SceneFile, pack_pictures, settings
from .script_guard import guarded_operators
from .script_hints import node_input_form
from .settling import settle_objects
from .wood import lay_grain
from .wording import length, listed, point_text, size_text, stems

PRINTED_LIMIT = 20_000
SCRIPT = "script"


class ScriptFailed(Exception):
    """A script's own error, told by the script's lines."""


def script_failure(error, code):
    """
    The error, then the way to it through the script, each line as written.
    Zhiyin's own frames say nothing a script's author can use, and their paths
    name the folder Zhiyin is installed in.
    """
    lines = code.splitlines()

    def written(number):
        return lines[number - 1].strip() if number and 0 < number <= len(lines) else ""

    if isinstance(error, SyntaxError) and error.filename == SCRIPT:
        return f"SyntaxError: {error.msg}\n  line {error.lineno}: {written(error.lineno)}"
    said = [f"{type(error).__name__}: {error}"]
    for frame in traceback.extract_tb(error.__traceback__):
        if frame.filename == SCRIPT:
            where = "" if frame.name == "<module>" else f", in {frame.name}"
            said.append(f"  line {frame.lineno}{where}: {written(frame.lineno)}")
    return "\n".join(said)


def failing_line(error, code):
    """The script's own line its error was raised at, as written, or nothing."""
    frames = [frame for frame in traceback.extract_tb(error.__traceback__) if frame.filename == SCRIPT]
    lines = code.splitlines()
    number = frames[-1].lineno if frames else None
    return lines[number - 1] if number and 0 < number <= len(lines) else ""


# Blender's own words for a file it could not write.
NOT_WRITTEN = ("could not be saved", "Could not write", "for writing", "Unable to save", "Couldn't create directory")


def beyond_workspace(error, folder, elsewhere=None):
    """
    What a script's error leaves unsaid when Windows refused it a file:
    Blender reads and writes in the workspace and nowhere else. A folder
    outside it the person approved is written through the folder of its own
    the script was given.
    """
    if isinstance(error, PermissionError):
        path = os.path.abspath(str(error.filename)) if error.filename else ""
        if not path or not outside([path], folder):
            return ""
        for approved, staging in (elsewhere or {}).items():
            if not outside([path], approved):
                return (
                    f"\nBlender cannot write {approved} itself: write its files into OUTSIDE_FOLDERS[r'{approved}'],"
                    f" {staging}, and they are moved into {approved} when the script ends."
                )
        return (
            f"\n{path} is outside the workspace, and Blender may read and write only inside it."
            " Name a folder outside it in outside_folders to write files there."
        )
    if isinstance(error, RuntimeError) and any(words in str(error) for words in NOT_WRITTEN):
        return (
            "\nBlender may write only inside the workspace. A path with no drive letter that reaches"
            " Blender as it is starts at the root of the drive: begin it with // for the scene's folder."
        )
    return ""


# The names Blender takes a path by, as an attribute or as an argument.
PATH_NAMES = {"filepath", "filepath_raw", "directory", "base_path"}
IN_WORKSPACE = "__zhiyin_in_workspace"
ALL_IN_WORKSPACE = "__zhiyin_all_in_workspace"


def in_workspace(folder):
    """
    What turns a path a script hands to Blender into the place the script
    meant. Python's own file functions take a path without a drive from the
    working folder, which is the workspace. Blender takes it from the root of
    the Windows drive, makes the folders it names there and says nothing. A
    path that names its drive, or starts with Blender's own // for beside the
    scene file, is left as it is.
    """

    def one(path):
        if not isinstance(path, str) or not path or path.startswith("//"):
            return path
        drive, rest = os.path.splitdrive(path)
        if drive:
            return path
        whole = os.path.normpath(os.path.join(folder, rest.lstrip("/\\")))
        return whole + os.sep if rest[-1] in "/\\" else whole

    def every(given):
        return {name: one(value) if name in PATH_NAMES else value for name, value in dict(given).items()}

    return {IN_WORKSPACE: one, ALL_IN_WORKSPACE: every}


class WorkspacePaths(ast.NodeTransformer):
    """
    Puts in_workspace round each path a script gives Blender: a value assigned
    to an attribute of one of the names, an argument of one of the names, the
    first argument of bpy.data's loaders and writers and of save_render.
    Nothing else of the script changes, and every line keeps its number.
    """

    @staticmethod
    def through(name, value):
        call = ast.Call(func=ast.Name(id=name, ctx=ast.Load()), args=[value], keywords=[])
        return ast.copy_location(call, value)

    def visit_Assign(self, node):
        self.generic_visit(node)
        if any(isinstance(target, ast.Attribute) and target.attr in PATH_NAMES for target in node.targets):
            node.value = self.through(IN_WORKSPACE, node.value)
        return node

    def visit_Call(self, node):
        self.generic_visit(node)
        for keyword in node.keywords:
            if keyword.arg is None:
                keyword.value = self.through(ALL_IN_WORKSPACE, keyword.value)
            elif keyword.arg in PATH_NAMES:
                keyword.value = self.through(IN_WORKSPACE, keyword.value)
        func = node.func
        if isinstance(func, ast.Attribute) and node.args and not isinstance(node.args[0], ast.Starred):
            owner = func.value
            of_data = (
                isinstance(owner, ast.Attribute)
                and isinstance(owner.value, ast.Attribute)
                and owner.value.attr == "data"
                and isinstance(owner.value.value, ast.Name)
                and owner.value.value.id == "bpy"
            )
            if func.attr == "save_render" or (func.attr in ("load", "write") and of_data):
                node.args[0] = self.through(IN_WORKSPACE, node.args[0])
        return node


# How many objects a script's answer describes one by one, and how many
# names it counts; past either, the rest are counted together.
SAID_EACH = 12
# How many of the things one of those objects goes into are named.
INTO_EACH = 3


def standing():
    """Where every object of the scene stands, to tell afterwards what a script did to it."""
    bpy.context.view_layer.update()
    return {
        o.name: (
            o.type,
            tuple(round(v, 5) for row in o.matrix_world for v in row),
            tuple(round(v, 5) for v in o.dimensions),
            o.parent.name if o.parent else None,
            o.hide_render,
        )
        for o in scene_objects()
        if not is_helper(o)
    }


def counted(names):
    """Many objects by the name they share, each with how high its objects reach."""
    grouped = stems(names)

    def one(stem, group):
        bounds = world_bounds([bpy.data.objects[n] for n in group])
        heights = f", from {length(bounds[0].z)} to {length(bounds[1].z)} high" if bounds else ""
        return (f"{stem} ×{len(group)}" if len(group) > 1 else group[0]) + heights

    said = [one(stem, group) for stem, group in list(grouped.items())[:SAID_EACH]]
    more = len(grouped) - SAID_EACH
    return "; ".join(said + ([f"and {more} more names"] if more > 0 else []))


def _matrix(stood):
    values = stood[1]
    return mathutils.Matrix([values[0:4], values[4:8], values[8:12], values[12:16]])


def _turn(matrix):
    """A turn in degrees, as turned_text gives one, to a hundredth."""
    return tuple(round(math.degrees(a), 2) + 0.0 for a in matrix.decompose()[1].to_euler())


def was_text(obj, was, now):
    """
    How an object a script changed was before it, in what changed: where it
    was, its size, its turn, what it was attached to and whether it was
    hidden. Its size before is its size now in the proportion its box
    changed, so both are measured alike.
    """
    before, after = _matrix(was), _matrix(now)
    said = []
    if (before.translation - after.translation).length > 1e-6:
        said.append(f"at {point_text(before.translation)}")
    if was[2] != now[2]:
        size = own_size(obj)
        if size is not None:
            said.append(size_text([size[i] * was[2][i] / now[2][i] if now[2][i] > 1e-12 else was[2][i] for i in range(3)]))
    if _turn(before) != _turn(after):
        said.append("turned (" + ", ".join(f"{a:g}°" for a in _turn(before)) + ")")
    if was[3] != now[3]:
        said.append(f"attached to {was[3]}" if was[3] else "attached to nothing")
    if was[4] != now[4]:
        said.append("hidden" if was[4] else "shown")
    return f"; before, {', '.join(said)}" if said else ""


def changes_counted(names, before, after):
    """How many objects a script changed moved, were resized, turned, attached or hidden, and by how much they moved."""
    shifts = [
        _matrix(after[n]).translation - _matrix(before[n]).translation
        for n in names
        if (_matrix(after[n]).translation - _matrix(before[n]).translation).length > 1e-6
    ]
    said = []
    if shifts:
        same = all((s - shifts[0]).length <= 1e-6 for s in shifts)
        how = f"by {point_text(shifts[0])}" if same else f"by up to {length(max(s.length for s in shifts))}"
        said.append(f"{'each' if len(shifts) == len(names) else len(shifts)} moved {how}")
    for count, what in (
        (sum(1 for n in names if before[n][2] != after[n][2]), "resized"),
        (sum(1 for n in names if _turn(_matrix(before[n])) != _turn(_matrix(after[n]))), "turned"),
        (sum(1 for n in names if before[n][3] != after[n][3]), "attached otherwise"),
        (sum(1 for n in names if before[n][4] != after[n][4]), "hidden or shown"),
    ):
        if count:
            said.append(f"{'each' if count == len(names) else count} {what}")
    return f"; {', '.join(said)}" if said else ""


def left_by(before, former):
    """
    What a script added, renamed, moved or resized, and removed, said as the
    other tools say their own work: each object's size, where its bottom and
    top are and what it goes into, so a part left floating or sunk shows
    before a picture is made, and of one it changed how it was before. Past
    SAID_EACH they are counted by name, with how many moved and by how much,
    and the answer says which tool tells the rest: measuring what each of
    hundreds goes into takes seconds, and a furnished room has hundreds of
    parts that rightly go into one another.
    """
    after = standing()
    pairs = former_names.paired(before, after, former)
    # Each object that was there, as it stood before, under its name now and
    # attached to what it was attached to under that one's name now.
    now_named = {w: n for n, w in pairs.items()}
    was = {n: (*before[w][:3], now_named.get(before[w][3], before[w][3]), *before[w][4:]) for n, w in pairs.items()}
    lines = []
    counted_some = False
    added = [n for n in after if n not in pairs]
    if len(added) > SAID_EACH:
        counted_some = True
        lines.append(f"Added {len(added)} objects: {counted(added)}.")
    else:
        lines += [f"Added {placed(bpy.data.objects[n], INTO_EACH)}." for n in added]
    renamed = [f"{w} to {n}" for n, w in pairs.items() if n != w]
    if renamed:
        lines.append(f"Renamed {listed(renamed, SAID_EACH)}.")
    changed = [n for n in pairs if after[n] != was[n]]
    if len(changed) > SAID_EACH:
        counted_some = True
        lines.append(f"Changed {len(changed)} objects: {counted(changed)}{changes_counted(changed, was, after)}.")
    else:
        lines += [
            f"Changed {placed(bpy.data.objects[n], INTO_EACH)}{was_text(bpy.data.objects[n], was[n], after[n])}."
            for n in changed
        ]
    kept = set(pairs.values())
    removed = [w for w in before if w not in kept]
    if removed:
        more = len(removed) - SAID_EACH
        lines.append("Removed " + listed(removed[:SAID_EACH] + ([f"{more} more"] if more > 0 else [])) + ".")
    if counted_some:
        lines.append("blender_describe_scene with objects says of any of them where it is and what it goes into.")
    return lines


# Kept on a picture a script set pixels of and kept nowhere, for the session that loads it to say so.
UNKEPT_PIXELS = "_zhiyin_pixels_unkept"


def unkept_pictures():
    """
    The pictures a script set pixels of and kept nowhere: the scene file
    keeps each without them, and the session that loads it after the script
    never sees them, so each is marked for it.
    """
    said = []
    for image in bpy.data.images:
        if image.source not in ("GENERATED", "FILE", "TILED") or not image.is_dirty or image.packed_file is not None:
            continue
        image[UNKEPT_PIXELS] = True
        kept = "blank" if image.source == "GENERATED" else "as its file has it"
        said.append(
            f"The picture {image.name} holds pixels the script set that nothing keeps: it is neither packed nor saved,"
            f" so the scene file keeps it {kept}. Pack it with image.pack() or save it with image.save()."
        )
    return said


def taken_unkept():
    """The names of the pictures the script's Blender marked as holding pixels nothing keeps, and the marks taken off."""
    names = set()
    for image in bpy.data.images:
        if image.get(UNKEPT_PIXELS) is not None:
            names.add(image.name)
            del image[UNKEPT_PIXELS]
    return names


def run_script(args):
    """Runs a model's script in the sealed Blender, and says what it printed and what its zhiyin calls did."""
    code = args.get("code")
    need(isinstance(code, str) and code.strip(), "code is required.")
    printed = io.StringIO()
    # In the workspace, so the paths the model knows open as they are.
    folder = args.get("folder")
    # Each approved folder outside the workspace, and where the script writes its files.
    elsewhere = {one["folder"]: one["staging"] for one in args.get("outside") or []}
    started_in = os.getcwd()
    reports.start()
    try:
        if folder:
            os.chdir(folder)
        with contextlib.redirect_stdout(printed), contextlib.redirect_stderr(printed):
            tree = ast.fix_missing_locations(WorkspacePaths().visit(ast.parse(code, SCRIPT, "exec")))
            names = {
                "bpy": bpy,
                "zhiyin": library.namespace(),
                "fcurves_of": fcurves_of,
                "__name__": "__zhiyin_script__",
                "OUTSIDE_FOLDERS": elsewhere,
                **in_workspace(os.getcwd()),
            }
            with guarded_operators():
                exec(compile(tree, SCRIPT, "exec"), names)
    except Exception as error:
        # Blender's own numpy can come without its random numbers, which no
        # script expects and the error alone does not explain.
        if (
            isinstance(error, (AttributeError, ImportError))
            and "numpy.random" in str(error)
            and not hasattr(numpy.random, "default_rng")
        ):
            raise Refused(
                "This Blender's numpy comes without numpy.random. Python's own random module is here,"
                " and the rest of numpy works."
            ) from error
        raise ScriptFailed(
            script_failure(error, code)
            + beyond_workspace(error, os.getcwd(), elsewhere)
            + node_input_form(error, failing_line(error, code))
            + library_said(reports.reported(), "Before it failed, and undone with it:")
        ) from error
    finally:
        os.chdir(started_in)
    text = printed.getvalue().strip()
    done = library_said(reports.reported(), "What its zhiyin calls did:").strip()
    said = text if len(text) <= PRINTED_LIMIT else "…" + text[-PRINTED_LIMIT:]
    return "\n".join(([said] if said else []) + ([done] if done else []))


def told_after_script(ran, before, former):
    """
    A script's answer, made in the session once it has loaded what the
    script saved: what the script printed and its calls did, as the sealed
    Blender said, then what it added, renamed, changed and removed, measured
    here. `former` names what each object was called before the script.
    """
    try:
        left = left_by(before, former)
    except Exception as error:
        # The script ran; what it did stays, and is only not told.
        keep_error("What a script left in the scene could not be told", error)
        left = ["What the script left in the scene could not be told."]
    if not ran and not left:
        return "The script ran and printed nothing."
    return "\n".join(([ran] if ran else []) + left)


# The most lines of what library calls did one answer lists; the rest are counted.
LIBRARY_LINES = 60


def library_said(lines, heading):
    """What a script's zhiyin calls did, under `heading`, the latest when there are many."""
    if not lines:
        return ""
    shown = lines if len(lines) <= LIBRARY_LINES else lines[-LIBRARY_LINES:]
    more = len(lines) - len(shown)
    return "\n" + "\n".join(
        [heading] + ([f"({more} earlier calls not listed.)"] if more else []) + [f"- {line}" for line in shown]
    )


CHANGES = {
    "add": add_objects,
    "edit": edit_objects,
    "shape": shaping.shape_objects,
    "material": set_material,
    "camera": set_camera,
    "lighting": set_lighting,
    "animate": animate,
    "settle": settle_objects,
    "scatter": scattering.scatter_objects,
    "unwrap": unwrapping.unwrap,
    "bake": baking.bake,
    "decal": decals.add_decal,
    "rig": rigging.rig,
    "simulate": simulating.simulate,
}

# A script's three steps: the session makes sure a scene is open, as its file
# now is; the sealed Blender runs the script and saves when it changed anything;
# the session loads what it saved and answers for it as for a change. The sealed
# Blender answers the script alone, and the session never runs one.
BEFORE_SCRIPT = "before_script"
RUN_SCRIPT = "script"
AFTER_SCRIPT = "after_script"
SCRIPT_STEPS = {BEFORE_SCRIPT: "reads", RUN_SCRIPT: "changes", AFTER_SCRIPT: "changes"}

# After these, see-through shapes with surfaces in the same place are said.
SCENE_READ = {"open", "render", "describe", AFTER_SCRIPT, *CHANGES}
# After these, drivers that do not run are said: a script or an animation
# may have made them, and an opened file or a description reads them.
DRIVEN = {"open", "describe", AFTER_SCRIPT, "animate"}
# After an animation, values keyed only once are said.
KEYED = {"animate"}
# After these, the scene is measured against the spec Zhiyin sends.
SPEC_READ = {"open", "describe", AFTER_SCRIPT, *CHANGES}
# Pictures and videos of the motion, close-ups, and the lines of a drawing, which leave
# the scene as it was.
SHOWS = {
    "frames": frame_sheet,
    "closeups": close_ups.close_ups,
    "look": look.look,
    "video": render_video,
    "lines": drafting_lines.scene_lines,
    "measure": measuring.measure,
}


# The commands answered besides the changes and the views.
OTHERS = ("open", "render", "export", "describe", "api", "reference", "preview")


def kind_of(op):
    """
    What a command does to the scene, said in its answer: a change, a render included, which keeps
    its settings in the scene; a picture, video, drawing or measure, which leaves it as it was but
    may have moved its time or settings when it failed part way; or a read.
    """
    if op in CHANGES or op == "render":
        return "changes"
    if op in SCRIPT_STEPS:
        return SCRIPT_STEPS[op]
    return "shows" if op in SHOWS else "reads"


def described():
    """Every command the session answers, said as it starts: what it does to the scene, and the terms of its inputs."""
    said = terms()
    # A script's answer, made here, describes objects one by one up to these.
    said[RUN_SCRIPT]["numbers"].update(said_each=SAID_EACH, into_each=INTO_EACH)
    return {op: {"kind": kind_of(op), **said.get(op, {})} for op in (*CHANGES, *SCRIPT_STEPS, *SHOWS, *OTHERS)}


def checks_before(op):
    """The scene before a change its checks compare with; a check never costs the change it would have checked."""
    try:
        return change_checks.before(op)
    except Exception as error:
        keep_error("The scene could not be read before a change for its checks", error)
        return None


def checks_after(was, op, args, former=None, unkept=()):
    """
    The checks' words on what a change did, or nothing. After a script, `former` names what each
    object was called before it, and `unkept` the pictures it set pixels of and kept nowhere.
    """
    if was is None:
        return ""
    try:
        return change_checks.checked(was, op, args, former, unkept)
    except Exception as error:
        keep_error("A change's checks could not be made", error)
        return "The checks after this change could not be made."


def failure(error):
    if isinstance(error, (Refused, ScriptFailed)):
        return str(error)
    lines = traceback.format_exception(error)
    return (f"{type(error).__name__}: {error}\n" + "".join(lines[-4:])).strip()


class Session:
    def __init__(self, sealed=False, processor=False):
        self.file = SceneFile()
        self.device = Device(card_draws=not processor)
        # A sealed Blender runs one script and answers nothing else.
        self.sealed = sealed

    def run_sealed(self, request):
        """
        The script, run in the scene file it names, which is saved after it when the script changed
        anything a save writes. `changed` says whether it was: a scene left as it was is not loaded
        again by the session, which still holds it with its shapes evaluated.
        """
        op = request.get("op")
        args = request.get("args") or {}
        budget.start(request.get("seconds"))
        notes = []
        try:
            if op != RUN_SCRIPT:
                raise Refused(f"This Blender runs one script and nothing else; {op} is the session's.")
            self.file.open(args.get("scene"), False)
            there, held = former_names.found(), saved_unused.held()
            opened = self.file.written()
            text = run_script(args)
            notes += unkept_pictures()
            # What the script made and nothing uses yet is kept for the next call, as one Blender would hold it.
            saved_unused.mark_made(held)
            # A picture whose file changed is packed again, which the save brings to the session.
            pack_pictures()
            changed = self.file.written() != opened
            if changed:
                # The session loads what is saved, and tells by these marks which object was which.
                former_names.mark(there)
                self.file.save()
        except Exception as error:
            # Nothing is saved, and this Blender is ended after its answer.
            return {
                "ok": False,
                "error": failure(error),
                "refused": isinstance(error, Refused),
                "notes": notes,
                "file": self.file.name,
                "changed": False,
                "kind": kind_of(op),
            }
        return {"ok": True, "text": text, "notes": notes, "file": self.file.name, "changed": changed, "kind": kind_of(op)}

    def handle(self, request):
        if self.sealed:
            return self.run_sealed(request)
        op = request.get("op")
        args = request.get("args") or {}
        # Every check of the command takes its share of the time it may run.
        budget.start(request.get("seconds"))
        notes = []
        # What this command's pictures leave out is said with its answer.
        DRAWING.left_out.clear()
        # After a script the file on disk is what the script saved, and the
        # scene held here is the one before it, which the answer compares with.
        moved = None if op == AFTER_SCRIPT else self.file.follow_disk()
        if moved:
            notes.append(moved)
        changed = False
        forget_patterns()
        try:
            if op == "open":
                created = self.file.open(args.get("path"), bool(args.get("create")))
                # Opened as Blender opens a file: what scripts made and no one used goes, and the
                # file is saved without it, so a script's own Blender does not find it there.
                if saved_unused.forget_made():
                    self.file.save()
                text = f"{'Created' if created else 'Opened'} {self.file.name}."
                # The person's own scene may use files kept elsewhere; it is
                # said, so nothing is read from outside without a word.
                elsewhere = outside(files_read(), args["workspace"]) if args.get("workspace") else []
                if elsewhere:
                    text += f" It reads files outside the workspace: {', '.join(elsewhere)}."
                if not created:
                    text += change_checks.units_text() + "\n" + describe.describe_scene({}, self.file)
                changed = True
            elif op in CHANGES:
                self.file.require()
                was = checks_before(op)
                text = CHANGES[op](args, self.file)
                found = checks_after(was, op, args)
                if found:
                    text += "\n" + found
                self.file.save()
                changed = True
            elif op == BEFORE_SCRIPT:
                self.file.require()
                text = ""
            elif op == AFTER_SCRIPT and not args.get("changed"):
                # The script's Blender saved nothing, so the scene held here is the file as it is,
                # unless the script wrote the file itself.
                self.file.require()
                moved = self.file.follow_disk()
                if moved:
                    notes.append(moved)
                text = args.get("ran") or "The script ran and printed nothing."
            elif op == AFTER_SCRIPT:
                self.file.require()
                before, was = standing(), checks_before(RUN_SCRIPT)
                self.file.reload()
                former, unkept = former_names.taken_marks(), taken_unkept()
                text = told_after_script(args.get("ran") or "", before, former)
                # A script may have changed any material, size or camera.
                lay_grain()
                sheets = light_through_sheets()
                if sheets:
                    text += "\n" + sheets
                refocus_scene()
                found = checks_after(was, RUN_SCRIPT, args, former, unkept)
                if found:
                    text += "\n" + found
                self.file.save()
                changed = True
            elif op == RUN_SCRIPT:
                raise Refused("A script runs in a Blender of its own, never in the session that checks it.")
            elif op == "render":
                self.file.require()
                text = render(args, self.file, self.device)
                self.file.save()
            elif op in SHOWS:
                self.file.require()
                text = SHOWS[op](args, self.file, self.device)
            elif op == "export":
                self.file.require()
                text = export(args, self.file)
            elif op == "describe":
                self.file.require()
                text = describe.describe_scene(args, self.file)
            elif op == "api":
                text = describe.api(args, self.file)
            elif op == "reference":
                text = json.dumps(reference.build())
            elif op == "preview":
                text = ""
            else:
                raise Refused(f"Unknown command {op}.")
        except Exception as error:
            left_out = left_out_text()
            if left_out:
                notes.append(left_out)
            # What follow_disk said stays with the answer, and a file loaded
            # again from disk is shown again however the command ended.
            answer = {
                "ok": False,
                "error": failure(error),
                "refused": isinstance(error, Refused),
                "notes": notes,
                "file": self.file.name,
                "changed": bool(moved),
                "kind": kind_of(op),
            }
            # A command that does more than read is undone by loading the
            # scene again. "reloaded" says whether the scene was put back, and
            # is left out when there was nothing to put back to: no scene, or
            # a file the command removed, which the next command says is gone.
            if answer["kind"] != "reads" and self.file.path and os.path.exists(self.file.path):
                try:
                    self.file.reload()
                    answer["reloaded"] = True
                except Exception as unloaded:
                    answer["reloaded"] = False
                    keep_error("The scene could not be put back after a change that failed", unloaded)
            return answer
        if op in SCENE_READ and self.file.path:
            try:
                notes += in_the_same_place()
            except Exception as error:
                # A note never costs the answer it would have come with.
                keep_error("Shapes in the same place could not be looked for", error)
        if op in DRIVEN and self.file.path:
            try:
                notes += unrun_drivers()
            except Exception as error:
                keep_error("Drivers that do not run could not be looked for", error)
        # A value keyed once holds at every time, which an animation's answer says.
        if op in KEYED and self.file.path:
            try:
                notes += lone_keys()
            except Exception as error:
                keep_error("Values keyed once could not be looked for", error)
        # The scene measured against its spec, once the change is saved.
        if op in SPEC_READ and self.file.path and args.get("spec"):
            spec.measure(args["spec"], self.device)
        left_out = left_out_text()
        if left_out:
            notes.append(left_out)
        # What each pattern named, ahead of what was done with it.
        named = patterns_said()
        if named:
            text = f"{named}\n{text}" if text else named
        answer = {
            "ok": True,
            "text": text,
            "notes": notes,
            "file": self.file.name,
            "changed": bool(changed or moved),
            "kind": kind_of(op),
        }
        view = request.get("preview")
        if view and (changed or op == "preview" or moved):
            try:
                with shown_as_evaluated():
                    answer["preview"] = preview(view, view["path"], self.device)
            except Exception as error:
                answer["previewError"] = failure(error)
        return answer


def serve(arguments):
    reads, writes = (int(v) for v in arguments[arguments.index("--pipes") + 1].split(","))
    commands = os.fdopen(msvcrt.open_osfhandle(reads, os.O_RDONLY), "r", encoding="utf-8")
    answers = os.fdopen(msvcrt.open_osfhandle(writes, os.O_WRONLY), "w", encoding="utf-8")
    settings()
    if "--no-graphics-card" in arguments:
        end_on_card_drawing()
    DRAWING.on_processor = "--processor" in arguments
    session = Session(sealed="--sealed" in arguments, processor=DRAWING.on_processor)
    if "--warm" in arguments:
        # The first EEVEE picture, and the first quick one, compile their
        # shaders; doing it now keeps the first preview as quick as the rest.
        # Said first: a Blender that ends while drawing them may be on a
        # computer whose graphics card cannot draw.
        answers.write(json.dumps({"warming": True}) + "\n")
        answers.flush()
        warm = arguments[arguments.index("--warm") + 1]
        try:
            preview({"width": 64, "height": 64}, warm, session.device)
            preview({"width": 64, "height": 64, "quick": True}, warm, session.device)
            os.remove(warm)
            drew = session.device.eevee
        except Exception as error:
            # Only a head start: a preview that cannot be made says so when one is asked for.
            keep_error("The first previews could not be made ahead of time", error)
            drew = False
        if "--probe" in arguments:
            # Started only to find out whether this computer's graphics card
            # draws: it says so, and ends.
            answers.write(json.dumps({"drew": drew}) + "\n")
            answers.flush()
            return
    ready = {
        "ready": True,
        "version": bpy.app.version_string,
        "device": session.device.said(),
        "eevee": session.device.eevee,
        "commands": described(),
    }
    answers.write(json.dumps(ready) + "\n")
    answers.flush()
    for line in commands:
        request = json.loads(line)
        answer = session.handle(request)
        answer["id"] = request.get("id")
        answers.write(json.dumps(answer) + "\n")
        answers.flush()
