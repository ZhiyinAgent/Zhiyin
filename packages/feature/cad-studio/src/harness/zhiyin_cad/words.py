"""How the answers write a length, a point, a way, a figure and a list."""

# Below this a length is the kernel's noise, not a size.
NOISE = 1e-6


def mm(value):
    """A length in millimetres, to two places, and to three figures below one, so a small length never reads as 0."""
    value = float(value)
    if abs(value) < NOISE:
        return "0"
    if abs(value) < 1:
        return f"{value:.3g}"
    # Adding 0.0 turns a -0.0 into a plain 0.
    return f"{round(value, 2) + 0.0:g}"


def point(p):
    """A point, its three numbers each a length: (1, 2.5, 0)."""
    return f"({', '.join(mm(v) for v in p)})"


def way(vector):
    """A direction: an axis as +x or -z, any other as its three numbers."""
    for k, axis in enumerate("xyz"):
        if abs(abs(vector[k]) - 1) < 1e-9:
            return f"{'+' if vector[k] > 0 else '-'}{axis}"
    return point(vector)


def figures(value):
    """A figure to three significant digits, as a person reads it."""
    return f"{float(f'{float(value):.3g}'):g}"


def listed(words):
    """Words as a sentence lists them: "A", "A and B", "A, B and C"."""
    return words[0] if len(words) == 1 else f"{', '.join(words[:-1])} and {words[-1]}"
