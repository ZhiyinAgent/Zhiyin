"""
Where a part that is not a valid solid goes wrong: the faces and edges the
kernel's checks reject, and the faces that cross each other, each with its
kind, where it lies and how large it is, so the step that made it is found
without taking the script apart. And whether the kernel's own repair makes
it valid.
"""

import build123d as bd

# The most faults told.
MOST = 6


def _kind(shape):
    name = type(shape).__name__.lower()
    if name == "face":
        geometry = str(shape.geom_type).rpartition(".")[2].lower()
        return f"{geometry if geometry in ('plane', 'cylinder', 'cone', 'sphere', 'torus') else 'freeform'} face"
    return name


def _told(shape, what):
    box = shape.bounding_box()
    middle = box.center()
    return {
        "kind": _kind(shape),
        "what": what,
        "at": [round(middle.X, 3), round(middle.Y, 3), round(middle.Z, 3)],
        "size": [round(v, 3) for v in (box.size.X, box.size.Y, box.size.Z)],
    }


def _checked(shape):
    """Faces and edges the kernel's validity check rejects."""
    from OCP.BRepCheck import BRepCheck_Analyzer

    analyzer = BRepCheck_Analyzer(shape.wrapped)
    found = []
    for subshapes, what in ((shape.faces(), "its outline or its surface is broken"), (shape.edges(), "it does not lie on its faces")):
        for sub in subshapes:
            if not analyzer.IsValid(sub.wrapped):
                found.append(_told(sub, what))
            if len(found) >= MOST:
                return found
    return found


def _crossing(shape):
    """Faces of the part that cross each other, as a boolean leaves them when it meets faces that only graze."""
    from OCP.BRepAlgoAPI import BRepAlgoAPI_Check

    check = BRepAlgoAPI_Check(shape.wrapped, True, True)
    if check.IsValid():
        return []
    found, seen = [], set()
    for result in check.Result():
        status = str(result.GetCheckStatus()).rpartition(".")[2].replace("BOPAlgo_", "")
        what = CHECKS.get(status, "the kernel's check finds it faulty")
        for faulty in list(result.GetFaultyShapes1()) + list(result.GetFaultyShapes2()):
            told = _told(bd.Shape.cast(faulty), what)
            key = (told["kind"], tuple(told["at"]))
            if key in seen:
                continue
            seen.add(key)
            found.append(told)
            if len(found) >= MOST:
                return found
    return found


# What the kernel's checks of a shape's faces find, in words.
CHECKS = {
    "SelfIntersect": "it crosses another face or edge of the part",
    "TooSmallEdge": "it is too short for the kernel to hold",
    "NonRecoverableFace": "the kernel cannot rebuild it",
    "IncompatibilityOfVertex": "its corners do not meet",
    "IncompatibilityOfEdge": "its edges do not meet",
    "IncompatibilityOfFace": "its faces do not meet",
    "GeomAbs_C0": "its surface has a crease the kernel cannot work on",
    "InvalidCurveOnSurface": "it does not lie on its faces",
}


def faults(shape):
    """What is wrong with a part that is not valid, where, and whether shape.fix() mends it."""
    told = _checked(shape)
    if len(told) < MOST:
        try:
            told += _crossing(shape)[: MOST - len(told)]
        except Exception:  # noqa: BLE001 - the check itself can fail on a broken shape
            pass
    try:
        mended = shape.fix().is_valid
    except Exception:  # noqa: BLE001
        mended = False
    return {"places": told, "fixed": bool(mended)}
