"""
What a CAD script is given beside build123d, as a module it names:

    from build123d import *
    from zhiyin_cad_helpers import *

so the file says where show and the helpers come from. A build gives them
without the import too.

Beside Zhiyin's harness, and in every build, the helpers are the harness's
own, which tell the build what they did. A copy a build writes beside a
script, with an export named zhiyin_cad_helpers.py, holds the source of each
module the helpers need, so that one file is all a script needs beside
build123d and bd_warehouse to run anywhere. Run so, the helpers build the
same shapes and print what they did that differs from what was asked, as a
smaller radius; show prints each part's name and size, as nothing there
measures or draws it. A cut a build skips because it would break the part is
made as written.
"""

import builtins
import sys

# The harness's modules the helpers need, by name, as source: held by a copy
# written beside a script, and nothing beside the harness, which has them.
_SOURCES = None
# The package the copy's modules load under, apart from the harness's own.
_PACKAGE = "_zhiyin_cad_helpers"


def _copied():
    """The helpers built from the modules this copy holds, each loaded from its source."""
    import importlib.abc
    import importlib.util

    class Copies(importlib.abc.MetaPathFinder, importlib.abc.Loader):
        def find_spec(self, name, path=None, target=None):
            if name == _PACKAGE:
                return importlib.util.spec_from_loader(name, self, is_package=True)
            if name.startswith(_PACKAGE + ".") and name[len(_PACKAGE) + 1 :] in _SOURCES:
                return importlib.util.spec_from_loader(name, self)
            return None

        def create_module(self, spec):
            return None

        def exec_module(self, module):
            if module.__name__ == _PACKAGE:
                return
            own = module.__name__[len(_PACKAGE) + 1 :]
            exec(compile(_SOURCES[own], f"zhiyin_cad_helpers.py ({own})", "exec"), module.__dict__)

    if not any(isinstance(finder, Copies) for finder in sys.meta_path):
        sys.meta_path.append(Copies())
    return importlib.import_module(f"{_PACKAGE}.helpers").GIVEN


def _given():
    """The harness's helpers where it is on Python's path, as in every build; else this copy's."""
    try:
        from zhiyin_cad.helpers import GIVEN
    except ImportError:
        if _SOURCES is None:
            raise
        return _copied()
    return GIVEN


GIVEN = _given()
globals().update(GIVEN)
# What `import *` gives: show and every helper the build gives.
__all__ = ["show", "show_object"]
__all__ += list(GIVEN)


def show(*parts, **given):
    """Shows parts to measure, draw and export: show(part, name="Bracket"), as the build's own show."""
    shown = getattr(builtins, "show", None)
    if shown is not None:
        return shown(*parts, **given)
    for part in parts:
        for one in part if isinstance(part, (list, tuple)) else [part]:
            shape = getattr(one, "part", one)
            size = shape.bounding_box().size if hasattr(shape, "bounding_box") else None
            said = f"{size.X:g} x {size.Y:g} x {size.Z:g} mm" if size is not None else type(one).__name__
            print(f"show: {given.get('name') or 'a part'}, {said}")
    return None


def show_object(part, name=None, **_):
    """CadQuery's name for show."""
    return show(part, name=name)
