"""
How the session's errors are said: a refusal, whose message is for the model, and an error
the work carries on past, written to the session's own log.
"""

import sys
import traceback


class Refused(Exception):
    """A request that cannot be done as asked. Its message is for the model."""


def keep_error(what, error):
    """Writes an error the work carries on past to the session's own log, where it can be found afterwards."""
    print(f"{what}:", file=sys.stderr)
    traceback.print_exception(error, file=sys.stderr)
    sys.stderr.flush()
