"""
How thick an object's material is, measured on its evaluated shape in the world as the spec
measures it: straight in from points spread over its surface by area to the far side, and the
narrowest way across. A material that light goes into, as one with subsurface scattering or a
tint, is said against these.
"""

import numpy

from .spec_shapes import Shape

# Thickness is said to a tenth of a millimetre: points sampled on a faceted surface vary below that.
TENTH_MM = 4
# The share of the surface, by its points, a thinnest or thickest part must cover to count, so
# one point at a sharp corner does not decide it.
EDGE_SHARE = 2


class Thickness:
    """An object's thinnest and thickest parts in metres, and whether its shape is closed; None for each it has not."""

    def __init__(self, obj):
        shape = Shape(obj)
        try:
            self.closed = shape.closed and not shape.empty
            found = shape.sections() if not shape.empty else None
        finally:
            shape.free()
        thin = found["thin"] if found is not None else numpy.zeros(0)
        self.thinnest = round(float(numpy.percentile(thin, EDGE_SHARE)) / 1000, TENTH_MM) if len(thin) else None
        self.thickest = round(float(numpy.percentile(thin, 100 - EDGE_SHARE)) / 1000, TENTH_MM) if len(thin) else None
