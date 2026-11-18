"""
Tests of the 3D studio's session code that needs no Blender, run in plain
Python. The session's folder is put first on Python's path, as its start
script does. Blender's own modules are stood in for by empty ones that refuse
every name, so a module that only imports them loads, and a test that reaches
Blender fails saying so.
"""

import importlib.abc
import importlib.util
import sys
import types
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "src" / "session"))

BLENDER = {"bpy", "bmesh", "mathutils", "bpy_extras", "gpu", "gpu_extras", "bl_math", "idprop", "addon_utils", "aud"}


class _Blender(types.ModuleType):
    def __getattr__(self, name):
        if name.startswith("__"):
            raise AttributeError(name)
        raise AttributeError(f"{self.__name__}.{name} is Blender's, and these tests run without Blender")


class _BlenderModules(importlib.abc.MetaPathFinder, importlib.abc.Loader):
    def find_spec(self, name, path=None, target=None):
        if name.split(".")[0] in BLENDER:
            return importlib.util.spec_from_loader(name, self, is_package=True)
        return None

    def create_module(self, spec):
        return _Blender(spec.name)

    def exec_module(self, module):
        module.__path__ = []


sys.meta_path.insert(0, _BlenderModules())
