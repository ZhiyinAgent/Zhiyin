# Started by Zhiyin as Blender's --python script. It serves one conversation's
# scene over the two pipes named after "--pipes" until Zhiyin closes them.

import os
import sys

# The script runs where the app keeps it, which may not be writable.
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# A folder asked for as private, mode 0o700, as tempfile asks for its own, is
# made by Python with permissions that let in the person and leave out the
# container Blender runs in: Blender could not use the folder it just made. It
# is made as before Python 3.13 instead, taking the permissions of the folder
# it is in.
_make_folder = os.mkdir


def _make_reachable_folder(path, mode=0o777, *, dir_fd=None):
    _make_folder(path, 0o777 if mode == 0o700 else mode, dir_fd=dir_fd)


os.mkdir = _make_reachable_folder

from zhiyin_studio.main import serve  # noqa: E402

serve(sys.argv[sys.argv.index("--") + 1 :])
