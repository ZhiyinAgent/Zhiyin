"""
Names of parts written as patterns: a name between slashes, such as
/Pin_.*/, stands for every part whose whole name it matches, and the answer
says what each named. Each run starts with none said.
"""

import re

said = []


def forget():
    said.clear()


def expanded(asked, names, what):
    """The names asked, each pattern among them replaced by the parts it matches whole; or why not, as ValueError."""
    found = []
    for one in asked:
        if isinstance(one, str) and len(one) > 2 and one.startswith("/") and one.endswith("/"):
            try:
                pattern = re.compile(one[1:-1])
            except re.error as error:
                raise ValueError(f"{what} gives {one}, which is not a pattern: {error}") from None
            hit = [name for name in names if name and pattern.fullmatch(name)]
            if not hit:
                raise ValueError(f"{what} gives {one}, which matches no part's whole name; the parts are {', '.join(n for n in names if n)}")
            line = f"{one} named {len(hit)} part{'s' if len(hit) != 1 else ''}: {', '.join(hit[:60])}" + (
                f" and {len(hit) - 60} more." if len(hit) > 60 else "."
            )
            if line not in said:
                said.append(line)
            found += [name for name in hit if name not in found]
        elif one not in found:
            found.append(one)
    return found
