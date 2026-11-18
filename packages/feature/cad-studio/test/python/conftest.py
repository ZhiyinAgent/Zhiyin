"""
Tests of the CAD harness's code that needs no geometry kernel: the fit and
strength tables and the part-name patterns. The harness's folder is put first
on Python's path, as its start script does, so its modules import by name.
"""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "src" / "harness"))


@pytest.fixture(autouse=True)
def nothing_said_yet():
    """Each build starts with nothing said, and so does each test."""
    from zhiyin_cad import notes, patterns

    notes.forget()
    patterns.forget()
    yield
