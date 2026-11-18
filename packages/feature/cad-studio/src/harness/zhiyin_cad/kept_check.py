"""
Shapes a script makes outside any builder and keeps nowhere. build123d's
operators and methods give a new shape and leave the one they work on as it
was, so a line such as `part.rotate(Axis.Z, 90)` or `part - hole`, its result
not assigned, changes nothing, without an error; a method that moves the
shape itself, as `move`, gives back that same shape and is not one, whether
the shape is a name or read through one, as `body.part.move(…)`. A part
assigned to a name the script never reads again, as a `BuildPart` block
whose part is never shown, is lost the same way; a `BuildPart` block inside
another's joins its part to that one's, unless it is private, and is used. The build's answer names
each, where in the script it is, and its size and place.

Only the script's own lines are looked at, never a module it imports.
"""

import ast
import sys

import build123d as bd

from . import cut_check

# The name the script's watched lines call, kept out of the script's own names.
WATCH = "__zhiyin_discarded__"
# How much of a line is quoted in the answer.
QUOTED = 60


class _Watched(ast.NodeTransformer):
    """Hands each line that is an expression alone, an operation or a call, to the watch."""

    def visit_Expr(self, node):
        value = node.value
        if not isinstance(value, (ast.BinOp, ast.Call)):
            return node
        receiver = _dotted(value.func.value) if isinstance(value, ast.Call) and isinstance(value.func, ast.Attribute) else None
        watched = ast.Call(
            func=ast.Name(id=WATCH, ctx=ast.Load()),
            args=[value, ast.Constant(node.lineno), ast.Constant(receiver)],
            keywords=[],
        )
        node.value = ast.copy_location(watched, value)
        ast.fix_missing_locations(node)
        return node


def _dotted(node):
    """A name, or attributes read through one, as `body.part`, as its words; or None."""
    names = []
    while isinstance(node, ast.Attribute):
        names.append(node.attr)
        node = node.value
    if not isinstance(node, ast.Name):
        return None
    return (node.id, *reversed(names))


def _held(frame, dotted):
    """What a dotted receiver holds in the frame the line ran in, or None."""
    name, *attributes = dotted
    held = frame.f_locals.get(name, frame.f_globals.get(name))
    for attribute in attributes:
        try:
            held = getattr(held, attribute)
        except Exception:  # noqa: BLE001 - a receiver that cannot be read again holds nothing the check can compare
            return None
    return held


_text = {}


def compiled(text, filename):
    """The script's code, each line that is an expression alone watched; it raises as compile() does."""
    tree = ast.parse(text, filename)
    _text[filename] = (text, tree)
    return compile(_Watched().visit(tree), filename, "exec")


def _quoted(filename, line):
    text = _text.get(filename, ("", None))[0].splitlines()
    said = text[line - 1].strip() if 0 < line <= len(text) else ""
    return said if len(said) <= QUOTED else said[: QUOTED - 1] + "…"


def _where(filename, line):
    """A line of the script's own files as the model knows it, as the other checks name one."""
    return f"line {line} of the script" if filename == "the script" else f"{filename}:{line}"


def _note(where, said):
    key = (where, "kept")
    if key not in cut_check.empty:
        cut_check.empty[key] = {"where": where, "what": "lost", "shape": said, "times": 0}
    cut_check.empty[key]["times"] += 1


def watch(filename):
    """The watch the script's code calls, for a script compiled as `filename`, named as the model knows it."""

    def discarded(value, line, receiver=None):
        if not isinstance(value, bd.Shape) or value._wrapped is None or not value.solids():
            return value
        # In a builder's block, what its objects and operations give is taken in by it.
        if bd.Builder._get_context(None, False) is not None:
            return value
        if receiver is not None:
            if _held(sys._getframe(1), receiver) is value:
                # A method that moved the shape itself.
                return value
        _note(
            _where(filename, line),
            f"“{_quoted(filename, line)}” gives a new shape, {cut_check._plain_box(value)}, which nothing keeps: "
            "build123d's operators and methods return their result and leave the shape they work on as it was. "
            "Assign it, as part = part.rotate(…), or take the line out.",
        )
        return value

    return discarded


def _part(value):
    """The solid shape a name holds, a builder's part included, or nothing; a builder whose part went into the builder around it holds none."""
    if isinstance(value, bd.BuildPart):
        if value.builder_parent is not None and value.mode != bd.Mode.PRIVATE:
            return None
        value = value.part
    if isinstance(value, bd.Shape) and value._wrapped is not None and value.solids():
        return value
    return None


def unused(namespace, filename):
    """Notes each name at the script's top that holds a solid and that the script never reads."""
    text, tree = _text.pop(filename, ("", None))
    if tree is None:
        return
    read = {node.id for node in ast.walk(tree) if isinstance(node, ast.Name) and not isinstance(node.ctx, ast.Store)}
    read |= {name for node in ast.walk(tree) if isinstance(node, (ast.Global, ast.Nonlocal)) for name in node.names}
    made = {}

    def bound(target, line):
        if isinstance(target, ast.Name):
            made[target.id] = line
        elif isinstance(target, (ast.Tuple, ast.List)):
            for one in target.elts:
                bound(one, line)

    def walk(statements):
        for node in statements:
            if isinstance(node, ast.Assign):
                for target in node.targets:
                    bound(target, node.lineno)
            elif isinstance(node, (ast.AnnAssign, ast.AugAssign)):
                bound(node.target, node.lineno)
            elif isinstance(node, ast.With):
                for item in node.items:
                    if item.optional_vars is not None:
                        bound(item.optional_vars, node.lineno)
            for field in ("body", "orelse", "finalbody"):
                if isinstance(node, (ast.If, ast.With, ast.For, ast.While, ast.Try)) and getattr(node, field, None):
                    walk(getattr(node, field))

    walk(tree.body)
    # A line another check already named, as a solid lost from a builder, is not named twice.
    named = {where for where, _ in cut_check.empty}
    for name, line in made.items():
        if name in read or name.startswith("_") or _where(filename, line) in named:
            continue
        part = _part(namespace.get(name))
        if part is None:
            continue
        _note(
            _where(filename, line),
            f"{name}, {cut_check._plain_box(part)}, is neither shown nor used after: show({name}, name=\"…\") to build it, or take it out.",
        )
