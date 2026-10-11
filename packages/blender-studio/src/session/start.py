# Started by Zhiyin as Blender's --python script. It serves one conversation's
# scene over the two pipes named after "--pipes" until Zhiyin closes them.

import os
import sys

# The script runs where the app keeps it, which may not be writable.
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from zhiyin_studio.main import serve  # noqa: E402

serve(sys.argv[sys.argv.index("--") + 1 :])
