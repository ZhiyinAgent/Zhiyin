"""
Runs the script a call gives, with `show` to name the parts it built. What
the script raises, and where in its own code and the workspace files it
imports, is what the model is told. A script may show nothing, to work
something out and print it.
"""

import builtins
import contextlib
import io
import linecache
import os
import sys
import traceback
import warnings


class ScriptFailed(Exception):
    """The script itself failed, or showed nothing: the model can fix this."""


def shape_of(value):
    """A part as build123d gives it: a builder's part, or a shape itself."""
    import build123d as bd

    if isinstance(value, bd.BuildPart):
        if value.part is None:
            raise ScriptFailed("show() was given a BuildPart that built nothing: make a shape inside its with block first.")
        value = value.part
    if isinstance(value, (bd.BuildSketch, bd.BuildLine)):
        raise ScriptFailed("show() takes 3D parts; a sketch or a line has no solid. Extrude it first.")
    if not isinstance(value, bd.Shape):
        raise ScriptFailed(f"show() takes build123d parts, not {type(value).__name__}.")
    if not value.solids():
        raise ScriptFailed(
            f"show() takes 3D parts, and this {type(value).__name__} has no solid. Extrude or revolve it first."
        )
    # Each face of the solids, once however many share it: shapes are equal when they are the same face.
    in_solids = {face for solid in value.solids() for face in solid.faces()}
    if any(face not in in_solids for face in value.faces()):
        raise ScriptFailed(
            f"This {type(value).__name__} holds a face that belongs to no solid, which would be measured and "
            "written as part of it. Show its solids alone, or extrude the face."
        )
    return value


class Run:
    """
    One run of the script, kept or dropped whole: the parts it showed, in
    order, each with its name, and what was said and marked while it ran:
    what the helpers did, the cuts skipped, each part's named surfaces, the
    faces marked to mesh coarser for viewing, the joins and cuts that add
    or take nothing, the solids lost from a builder, the way each part is
    made where the script said, and what the helpers made.
    """

    def __init__(self, parts, helped, skipped, surfaces, wire, empty=(), making=None, features=()):
        self.parts, self.helped, self.skipped, self.surfaces, self.wire = parts, helped, skipped, surfaces, wire
        self.empty = list(empty)
        self.making = dict(making or {})
        self.features = list(features)


# The harness's own folder and the CAD environment's: their modules are loaded once for every run.
_kept = [os.path.normcase(os.path.abspath(folder)) for folder in (os.path.dirname(os.path.dirname(__file__)), sys.prefix, sys.base_prefix)]


def _forget_modules(folders):
    """
    Lets the workspace's own modules run afresh at the next import, as a
    script expects each time it runs: Python runs a module once and hands
    back the one it kept after.
    """
    for name, module in list(sys.modules.items()):
        where = getattr(module, "__file__", None)
        if not where:
            continue
        where = os.path.normcase(os.path.abspath(where))
        if any(where.startswith(folder + os.sep) for folder in _kept):
            continue
        if any(where.startswith(folder + os.sep) for folder in folders):
            del sys.modules[name]


def run_script(script, as_file, arguments, name=None, thorough=False, quiet=False, source=None):
    """
    Runs the script as the file it came from, or as code, and returns its
    Run. An error names the script as the model knows it: its workspace
    path, or "the script" for code. A quiet run keeps what the script prints
    to itself, as a run of it again would say it twice. `source`, when
    given, is a copy of the workspace holding exactly the files the approval
    saw: the script's neighbours import from it, so nothing else can.
    """
    from . import meshing, surfaces

    shown = []
    # The groups of surfaces the script named for each part shown, by its place in `shown`.
    named_surfaces = {}
    # The way each part shown is made, where the script said, by its place in `shown`.
    ways = {}
    surfaces.forget()
    meshing.forget()

    def show(*parts, name=None, names=None, surfaces=None, making=None):
        """
        Shows parts to measure, draw and export: show(part, name="Bracket").
        surfaces={"machined": faces, ...} names groups of the part's faces,
        which the 3D studio gives materials of their own. making="printed",
        "moulded" (injection-moulded or cast, pulled along +Z), "milled" (the
        tool along Z) or "sheet" says how the parts are made, which the
        build checks them for.
        """
        if making is not None and making not in made_by.METHODS:
            raise ScriptFailed(f"show() was given making={making!r}; it is one of {', '.join(made_by.METHODS)}.")
        given = names if names is not None else ([name] * len(parts) if name is not None else [None] * len(parts))
        if len(given) != len(parts):
            raise ScriptFailed("show() was given a different number of names than parts.")
        if surfaces is not None and (len(parts) != 1 or isinstance(parts[0], (list, tuple))):
            raise ScriptFailed("surfaces name faces of one part: show that part on its own to name them.")
        if surfaces is not None and not isinstance(surfaces, dict):
            raise ScriptFailed('surfaces is a dict of groups and their faces, such as {"machined": part.faces().filter_by(Axis.Z)}.')
        def checked(item, label, number=None, count=1):
            """The part as shown, or a refusal that says which part and where the script showed it."""
            try:
                return shape_of(item)
            except ScriptFailed as refused:
                if count > 1:
                    which = f"part {number} of the {count} shown" + (f" as “{label}”" if label is not None else "")
                else:
                    which = f"the part shown as “{label}”" if label is not None else "the part shown"
                raise ScriptFailed(f"At {shown_at()}, {which}: {refused}") from None

        before = len(shown)
        for part, label in zip(parts, given):
            if part is None:
                # What a helper gives where it could not build what was asked, having said why: the script goes on.
                notes.say(
                    f"show() at {shown_at()} was given None" + (f" for “{label}”" if label is not None else "")
                    + ", so nothing is shown there; a helper gives None where it could not build what was asked, and says why."
                )
                continue
            if isinstance(part, (list, tuple)):
                # One name for a list names each of its parts, numbered.
                items = list(part)
                for number, item in enumerate(items, start=1):
                    own = f"{label} {number}" if label is not None and len(items) > 1 else label
                    shown.append((own, checked(item, label, number, len(items))))
            else:
                shown.append((label, checked(part, label)))
                if surfaces is not None:
                    named_surfaces[len(shown) - 1] = surfaces
            if making is not None:
                for index in range(before, len(shown)):
                    ways[index] = making

    def show_object(part, name=None, **_):
        show(part, name=name)

    path = as_file or script
    sys.argv = [path, *arguments]
    # A workspace file's neighbours import as they would beside it, and code
    # imports the files at the workspace's top, where it runs.
    beside = os.path.dirname(as_file) if as_file else os.getcwd()
    shown_as = name or "the script"
    # The workspace's top folder: code runs there, and a file's workspace path
    # ends its path on disk.
    workspace = os.path.normcase(os.path.abspath(os.getcwd()))
    if as_file and name and os.path.normcase(os.path.abspath(as_file)).endswith(os.path.normcase(os.path.normpath(name))):
        workspace = os.path.normcase(os.path.abspath(as_file))[: -len(os.path.normpath(name))].rstrip("\\/")
    if source is not None and as_file and name:
        # The copy stands for the workspace: its files import, and are named as the workspace's.
        workspace = os.path.normcase(os.path.abspath(source))
        beside = os.path.join(source, os.path.dirname(os.path.normpath(name)))
    sys.path.insert(0, beside)
    # A module the script imports from the workspace may show parts too, and
    # use the helpers, which a name of the script's own replaces.
    # Each check that watches the libraries' operations, which it names to the interception as it loads.
    from . import bom_record, builder_check, cut_check, fillet_check, helpers, interception, kept_check, notes  # noqa: F401
    from . import making as made_by

    def as_known(filename):
        """A file of the script's own as the model knows it; nothing for any other."""
        if filename == shown_as:
            return shown_as
        where = os.path.normcase(os.path.abspath(filename))
        return os.path.relpath(filename, workspace).replace("\\", "/") if where.startswith(workspace + os.sep) else None

    def shown_at():
        """The line of the script's own files that called show(), as the model knows it."""
        for frame in reversed(traceback.extract_stack()[:-2]):
            named = as_known(frame.filename)
            if named is not None:
                return f"line {frame.lineno} of the script" if named == shown_as else f"{named}:{frame.lineno}"
        return "the script"

    _forget_modules({workspace, os.path.normcase(os.path.abspath(beside)), os.path.normcase(os.path.abspath(os.path.dirname(path)))})
    notes.forget()
    made_by.forget()
    cut_check.forget()
    cut_check.start(as_known, thorough)
    builder_check.start(as_known)
    interception.hold()
    builtins.show, builtins.show_object = show, show_object
    for helper, function in helpers.GIVEN.items():
        setattr(builtins, helper, function)
    try:
        with open(script, encoding="utf-8") as source:
            text = source.read()
        # Its lines are found under that name, so an error still quotes them.
        linecache.cache[shown_as] = (len(text), None, text.splitlines(True), shown_as)
        code = kept_check.compiled(text, shown_as)
        namespace = {"__name__": "__main__", "__file__": path, "show": show, "show_object": show_object, kept_check.WATCH: kept_check.watch(shown_as)}
        # What the library says is deprecated is said wherever the script's
        # own files call it, not in __main__ alone, so the answer can give the
        # form that replaced it.
        with warnings.catch_warnings(), contextlib.redirect_stdout(io.StringIO()) if quiet else contextlib.nullcontext():
            warnings.simplefilter("default", DeprecationWarning)
            exec(code, namespace)
    except ScriptFailed:
        raise
    except SystemExit as stop:
        if stop.code not in (None, 0):
            raise ScriptFailed(f"The script stopped with exit code {stop.code}.") from None
    except BaseException as error:
        # The lines of the script and of the workspace files it imports, the
        # last first in Python's order; nothing of build123d's or Zhiyin's.
        frames = []
        for frame in traceback.extract_tb(error.__traceback__):
            if frame.filename == shown_as:
                frames.append(frame)
                continue
            where = os.path.normcase(os.path.abspath(frame.filename))
            if where.startswith(workspace + os.sep):
                frame.filename = os.path.relpath(frame.filename, workspace).replace("\\", "/")
                frames.append(frame)
        where = "".join(traceback.format_list(frames))
        said = "".join(traceback.format_exception_only(type(error), error)).strip()
        raise ScriptFailed(f"The script failed:\n{where}{said}") from None
    finally:
        interception.release()
        builder_check.stop()
        del builtins.show, builtins.show_object
        for helper in helpers.GIVEN:
            delattr(builtins, helper)
    builder_check.lost([shape for _, shape in shown])
    kept_check.unused(namespace, shown_as)
    named = []
    taken = set()
    groups_of = {}

    def refuse(said):
        raise ScriptFailed(said)

    making_of = {}
    for index, (label, shape) in enumerate(shown, start=1):
        label = str(label).strip() if label is not None and str(label).strip() else f"Part {index}"
        if label in taken:
            raise ScriptFailed(f"Two parts are named “{label}”. Give each its own name.")
        taken.add(label)
        named.append((label, shape))
        if index - 1 in ways:
            making_of[label] = ways[index - 1]
        groups = surfaces.groups(shape, named_surfaces.get(index - 1), lambda said, label=label: refuse(f"{label}: {said}"))
        if groups:
            groups_of[label] = groups
    return Run(
        named,
        list(notes.said),
        list(cut_check.skipped),
        groups_of,
        meshing.marked(),
        [dict(one) for one in cut_check.empty.values()],
        making_of,
        [dict(one) for one in made_by.features],
    )
