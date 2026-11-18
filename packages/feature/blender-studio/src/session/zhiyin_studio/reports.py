"""What a script's zhiyin calls did, one measured line each, kept for the script's answer."""

# What each call of this script did, in the order they ran.
_reports = []


def report(line):
    """Keeps one line of what a call did, for the script's answer."""
    _reports.append(line)


def start():
    """A script starts with nothing done."""
    _reports.clear()


def reported():
    """What this script's calls did, a line each."""
    return list(_reports)
