"""
The strength of the materials the requirements name, for the strength
helpers: each a common grade, named, with its minimum yield and tensile
strength from the standard that sets them and its moduli from the design
code that gives them. A material not here, or a grade other than the one
named, is given to a helper as numbers: yield_strength and modulus.

Plastics, wood, cast iron, brass and copper are not here: printed and
moulded plastics vary with how they are made by more than a safety factor
covers, cast iron is brittle and has no yield, and brass and copper vary
with their temper; give their figures from the supplier's datasheet.
"""

# name: grade, yield (MPa), tensile (MPa), Young's modulus E (MPa), shear modulus G (MPa), sources.
MATERIALS = {
    "steel": {
        "grade": "S235JR, up to 16 mm thick",
        "yield": 235.0,
        "tensile": 360.0,
        "E": 210_000.0,
        "G": 81_000.0,
        "source": "EN 10025-2 (minimum yield and tensile strength); EN 1993-1-1 (E, G)",
    },
    "stainless steel": {
        "grade": "1.4301 (304), cold-rolled strip",
        "yield": 230.0,
        "tensile": 540.0,
        "E": 200_000.0,
        "G": 77_000.0,
        "source": "EN 10088-2 (minimum 0.2% proof and tensile strength); EN 1993-1-4 (E, G)",
    },
    "aluminium": {
        "grade": "6061-T6 sheet",
        "yield": 240.0,
        "tensile": 290.0,
        "E": 69_000.0,
        "G": 26_000.0,
        "source": "ASTM B209 (minimum yield and tensile strength); ASM handbook (E, G)",
    },
    "titanium": {
        "grade": "Ti-6Al-4V, grade 5",
        "yield": 828.0,
        "tensile": 895.0,
        "E": 114_000.0,
        "G": 44_000.0,
        "source": "ASTM B348 (minimum yield and tensile strength); ASM handbook (E, G)",
    },
}


class NoFigures(ValueError):
    """A material with no strength figures here, and none given."""


def of(material, yield_strength=None, modulus=None, shear_modulus=None):
    """
    A material's figures, as a dict of grade, yield, tensile, E, G and
    where they come from: those of the material named, each replaced by one
    given; or, for a material not here, those given, yield_strength and
    modulus at least.
    """
    known = MATERIALS.get(material)
    if known is None and (yield_strength is None or modulus is None):
        raise NoFigures(
            f"there are no strength figures for {material!r} here: give yield_strength= and modulus= in MPa from its datasheet, "
            f"or a material of {', '.join(MATERIALS)}"
        )
    found = dict(known) if known else {"grade": str(material), "tensile": None, "G": None, "source": "the figures given"}
    if yield_strength is not None:
        found["yield"] = float(yield_strength)
        found["grade"] = f"{found['grade']}, yield {yield_strength:g} MPa as given" if known else found["grade"]
    if modulus is not None:
        found["E"] = float(modulus)
    if shear_modulus is not None:
        found["G"] = float(shear_modulus)
    if found.get("G") is None:
        # An isotropic material's G from E and a Poisson's ratio of 0.3.
        found["G"] = found["E"] / 2.6
    return found
