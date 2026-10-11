"""The session: one command at a time from Zhiyin's pipe, one answer on the other.

A command that changes the scene is saved, then previewed. A command that
fails puts the saved file back, so a half-made change never stays.
"""

import ast
import contextlib
import io
import json
import msvcrt
import os
import re
import traceback

import bpy
import numpy

from . import describe, looks, objects, output, shaping
from .common import (
    Refused,
    files_read,
    in_the_same_place,
    is_helper,
    keep_error,
    length,
    need,
    outside,
    refocus,
    scene_objects,
    world_bounds,
)
from .scene_file import SceneFile, settings

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


# Blender's own words for a file it could not write.
NOT_WRITTEN = ("could not be saved", "Could not write", "for writing", "Unable to save", "Couldn't create directory")


def beyond_workspace(error, folder):
    """
    What a script's error leaves unsaid when Windows refused it a write:
    Blender may write in the workspace and nowhere else.
    """
    if isinstance(error, PermissionError):
        path = os.path.abspath(str(error.filename)) if error.filename else ""
        if path and outside([path], folder):
            return f"\n{path} is outside the workspace, and Blender may write only inside it."
        return ""
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
    stems = {}
    for name in names:
        stems.setdefault(re.sub(r"[\s._-]*\d+$", "", name) or name, []).append(name)

    def one(stem, group):
        bounds = world_bounds([bpy.data.objects[n] for n in group])
        heights = f", from {length(bounds[0].z)} to {length(bounds[1].z)} high" if bounds else ""
        return (f"{stem} ×{len(group)}" if len(group) > 1 else group[0]) + heights

    said = [one(stem, group) for stem, group in list(stems.items())[:SAID_EACH]]
    more = len(stems) - SAID_EACH
    return "; ".join(said + ([f"and {more} more names"] if more > 0 else []))


def left_by(before):
    """
    What a script added, moved or resized, and removed, said as the other
    tools say their own work: each object's size, where its bottom and top
    are and what it goes into, so a part left floating or sunk shows before a
    picture is made. Past a dozen they are counted by name, and the answer
    says which tool tells the rest: measuring what each of hundreds goes into
    takes seconds, and a furnished room has hundreds of parts that rightly go
    into one another.
    """
    after = standing()
    lines = []
    counted_some = False
    for verb, names in (
        ("Added", [n for n in after if n not in before]),
        ("Changed", [n for n in after if n in before and after[n] != before[n]]),
    ):
        if len(names) > SAID_EACH:
            counted_some = True
            lines.append(f"{verb} {len(names)} objects: {counted(names)}.")
        else:
            lines += [f"{verb} {objects.placed(bpy.data.objects[n], INTO_EACH)}." for n in names]
    removed = [n for n in before if n not in after]
    if removed:
        more = len(removed) - SAID_EACH
        lines.append("Removed " + output.listed(removed[:SAID_EACH] + ([f"{more} more"] if more > 0 else [])) + ".")
    if counted_some:
        lines.append("blender_describe_scene with objects says of any of them where it is and what it goes into.")
    return lines


def run_script(args, scene_file):
    code = args.get("code")
    need(isinstance(code, str) and code.strip(), "code is required.")
    before = standing()
    printed = io.StringIO()
    # In the workspace, so the paths the model knows open as they are.
    folder = args.get("folder")
    started_in = os.getcwd()
    try:
        if folder:
            os.chdir(folder)
        with contextlib.redirect_stdout(printed), contextlib.redirect_stderr(printed):
            tree = ast.fix_missing_locations(WorkspacePaths().visit(ast.parse(code, SCRIPT, "exec")))
            names = {"bpy": bpy, "__name__": "__zhiyin_script__", **in_workspace(os.getcwd())}
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
        raise ScriptFailed(script_failure(error, code) + beyond_workspace(error, os.getcwd())) from error
    finally:
        os.chdir(started_in)
    text = printed.getvalue().strip()
    try:
        left = left_by(before)
    except Exception as error:
        # The script ran; what it did stays, and is only not told.
        keep_error("What a script left in the scene could not be told", error)
        left = ["What the script left in the scene could not be told."]
    if not text and not left:
        return "The script ran and printed nothing."
    said = text if len(text) <= PRINTED_LIMIT else "…" + text[-PRINTED_LIMIT:]
    return "\n".join(([said] if said else []) + left)


CHANGES = {
    "add": objects.add_objects,
    "edit": objects.edit_objects,
    "shape": shaping.shape_objects,
    "material": looks.set_material,
    "camera": looks.set_camera,
    "lighting": looks.set_lighting,
    "script": run_script,
}


# After these, see-through shapes with surfaces in the same place are said.
SCENE_READ = {"open", "render", "describe", *CHANGES}


def failure(error):
    if isinstance(error, (Refused, ScriptFailed)):
        return str(error)
    lines = traceback.format_exception(error)
    return (f"{type(error).__name__}: {error}\n" + "".join(lines[-4:])).strip()


class Session:
    def __init__(self):
        self.file = SceneFile()
        self.device = output.Device()

    def handle(self, request):
        op = request.get("op")
        args = request.get("args") or {}
        notes = []
        moved = self.file.follow_disk()
        if moved:
            notes.append(moved)
        changed = False
        try:
            if op == "open":
                created = self.file.open(args.get("path"), bool(args.get("create")))
                text = f"{'Created' if created else 'Opened'} {self.file.name}."
                # The person's own scene may use files kept elsewhere; it is
                # said, so nothing is read from outside without a word.
                elsewhere = outside(files_read(), args["workspace"]) if args.get("workspace") else []
                if elsewhere:
                    text += f" It reads files outside the workspace: {', '.join(elsewhere)}."
                if not created:
                    text += "\n" + describe.describe_scene({}, self.file)
                changed = True
            elif op in CHANGES:
                self.file.require()
                text = CHANGES[op](args, self.file)
                # Whatever made or changed it, a sheet of glass lets light through.
                looks.lay_grain()
                sheets = looks.light_through_sheets()
                if sheets:
                    text += "\n" + sheets
                # A camera focused on an object stays on it when either moves.
                if bpy.context.scene.camera is not None:
                    refocus(bpy.context.scene.camera)
                self.file.save()
                changed = True
            elif op == "render":
                self.file.require()
                text = output.render(args, self.file, self.device)
                self.file.save()
            elif op == "export":
                self.file.require()
                text = output.export(args, self.file)
            elif op == "describe":
                self.file.require()
                text = describe.describe_scene(args, self.file)
            elif op == "api":
                text = describe.api(args, self.file)
            elif op == "preview":
                text = ""
            else:
                raise Refused(f"Unknown command {op}.")
        except Exception as error:
            reloaded = False
            # A render keeps its settings in the scene, so it is undone as a change is.
            if (op in CHANGES or op == "render") and self.file.path and os.path.exists(self.file.path):
                try:
                    self.file.reload()
                    reloaded = True
                except Exception as unloaded:
                    # The answer says the scene was not put back.
                    keep_error("The scene could not be put back after a change that failed", unloaded)
            return {"ok": False, "error": failure(error), "refused": isinstance(error, Refused), "reloaded": reloaded, "notes": notes, "file": self.file.name}
        if op in SCENE_READ and self.file.path:
            try:
                notes += in_the_same_place()
            except Exception as error:
                # A note never costs the answer it would have come with.
                keep_error("Shapes in the same place could not be looked for", error)
        answer = {"ok": True, "text": text, "notes": notes, "file": self.file.name, "changed": bool(changed or moved)}
        view = request.get("preview")
        if view and (changed or op == "preview" or moved):
            try:
                answer["preview"] = output.preview(view, view["path"], self.device)
            except Exception as error:
                answer["previewError"] = failure(error)
        return answer


def serve(arguments):
    reads, writes = (int(v) for v in arguments[arguments.index("--pipes") + 1].split(","))
    commands = os.fdopen(msvcrt.open_osfhandle(reads, os.O_RDONLY), "r", encoding="utf-8")
    answers = os.fdopen(msvcrt.open_osfhandle(writes, os.O_WRONLY), "w", encoding="utf-8")
    settings()
    session = Session()
    if "--warm" in arguments:
        # The first EEVEE picture, and the first quick one, compile their
        # shaders; doing it now keeps the first preview as quick as the rest.
        warm = arguments[arguments.index("--warm") + 1]
        try:
            output.preview({"width": 64, "height": 64}, warm, session.device)
            output.preview({"width": 64, "height": 64, "quick": True}, warm, session.device)
            os.remove(warm)
        except Exception as error:
            # Only a head start: a preview that cannot be made says so when one is asked for.
            keep_error("The first previews could not be made ahead of time", error)
    ready = {"ready": True, "version": bpy.app.version_string, "device": session.device.said(), "eevee": session.device.eevee}
    answers.write(json.dumps(ready) + "\n")
    answers.flush()
    for line in commands:
        request = json.loads(line)
        answer = session.handle(request)
        answer["id"] = request.get("id")
        answers.write(json.dumps(answer) + "\n")
        answers.flush()
