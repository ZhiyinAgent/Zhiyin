"""
A mesh as the sculpt functions work on it: its points in the world, each with where it stood
before the change, its normal then and how much a mask holds it; where it stood before it was first
sculpted, kept on the mesh, so a symmetrize can pair it with its mirror; and what a change did,
measured: the points it moved and the most, the volume before and after, and any new self-crossings.
"""

import bmesh
import numpy
from mathutils.bvhtree import BVHTree

from .arguments import need
from .errors import Refused
from .reports import report
from .shown_mesh import shown_bmesh
from .wording import length, point_text, volume_text

# Where each point stood before the mesh was first sculpted, in the object's own space.
REST = "zhiyin_sculpt_rest"
# Where each point stood before this change, in the world; its normal then; how much a mask holds it.
BEFORE, NORMAL, HELD = "zhiyin_sculpt_before", "zhiyin_sculpt_normal", "zhiyin_sculpt_held"
# Less than a thousandth of a millimetre is arithmetic, not a move.
MOVED = 1e-6


def mask_weights(obj, mask):
    """How much the vertex group `mask` holds each point, 0 where it holds none; refused when it is not there."""
    if mask is None:
        return None
    need(isinstance(mask, str) and mask, "mask must name a vertex group.")
    group = obj.vertex_groups.get(mask)
    if group is None:
        groups = [g.name for g in obj.vertex_groups]
        raise Refused(
            f"{obj.name} has no vertex group “{mask}” to mask with; make one with zhiyin.sculpt_mask."
            + (f" It has: {', '.join(groups)}." if groups else " It has none.")
        )
    weights = numpy.zeros(len(obj.data.vertices))
    for v in obj.data.vertices:
        for g in v.groups:
            if g.group == group.index:
                weights[v.index] = g.weight
    return weights


class Sculpted:
    """
    An object's mesh opened in the world for a change: its rest layer made when the mesh has none,
    the mask's weights on its points, and its points as they stand kept as before the change.
    """

    def __init__(self, obj, mask=None):
        self.obj = obj
        self.mask = mask
        self.matrix = obj.matrix_world.copy()
        need(abs(self.matrix.to_3x3().determinant()) > 1e-12, f"{obj.name} is scaled to nothing in some direction.")
        need(obj.data.vertices, f"{obj.name} has no points to sculpt.")
        weights = mask_weights(obj, mask)
        bm = shown_bmesh(obj, steps=False, world=False)
        layers = bm.verts.layers
        rest = layers.float_vector.get(REST)
        fresh = rest is None
        if fresh:
            rest = layers.float_vector.new(REST)
        layers.float_vector.new(BEFORE)
        layers.float_vector.new(NORMAL)
        layers.float.new(HELD)
        # Layers are added before any element is taken: adding one ends earlier references.
        held = layers.float[HELD]
        rest = layers.float_vector[REST]
        for v in bm.verts:
            if fresh:
                v[rest] = v.co
            v[held] = weights[v.index] if weights is not None else 0.0
        bm.transform(self.matrix)
        if self.matrix.to_3x3().determinant() < 0:
            bmesh.ops.reverse_faces(bm, faces=list(bm.faces))
        self.bm = bm
        self.refresh()
        self.closed = all(len(e.link_faces) == 2 for e in bm.edges) and len(bm.faces) > 0
        self.volume = bm.calc_volume(signed=True) if self.closed else None
        self.faces = len(bm.faces)
        self.mark_before()
        self.crossings = crossing_pairs(bm)

    def layer(self, name):
        layers = self.bm.verts.layers
        return layers.float[name] if name == HELD else layers.float_vector[name]

    def refresh(self):
        """Indices and lookup tables made current, and normals, after the mesh changed."""
        bm = self.bm
        bm.verts.index_update()
        bm.edges.index_update()
        bm.faces.index_update()
        bm.verts.ensure_lookup_table()
        bm.edges.ensure_lookup_table()
        bm.faces.ensure_lookup_table()
        bm.normal_update()

    def mark_before(self):
        """Keeps each point's place and normal as they are, as where the change starts from."""
        before, normal = self.layer(BEFORE), self.layer(NORMAL)
        for v in self.bm.verts:
            v[before] = v.co
            v[normal] = v.normal

    def positions(self):
        return numpy.array([v.co[:] for v in self.bm.verts], dtype=numpy.float64).reshape(-1, 3)

    def befores(self):
        before = self.layer(BEFORE)
        return numpy.array([v[before][:] for v in self.bm.verts], dtype=numpy.float64).reshape(-1, 3)

    def normals(self):
        normal = self.layer(NORMAL)
        found = numpy.array([v[normal][:] for v in self.bm.verts], dtype=numpy.float64).reshape(-1, 3)
        sizes = numpy.linalg.norm(found, axis=1)
        sizes[sizes == 0] = 1
        return found / sizes[:, None]

    def held(self):
        """How free each point is to move: 1 less the mask's weight on it."""
        held = self.layer(HELD)
        return 1.0 - numpy.clip(numpy.array([v[held] for v in self.bm.verts], dtype=numpy.float64), 0, 1)

    def masked(self):
        held = self.layer(HELD)
        return numpy.array([v[held] > 0 for v in self.bm.verts], dtype=bool)

    def place(self, positions):
        """Moves every point to the given places, in the world."""
        for v, at in zip(self.bm.verts, positions):
            v.co = at
        self.bm.normal_update()

    def place_some(self, indices, positions):
        """Moves the points given to the given places, in the world."""
        verts = self.bm.verts
        for i, at in zip(indices, positions):
            verts[int(i)].co = at
        self.bm.normal_update()

    def rebase(self):
        """The volume and crossings a change is measured against, taken again after points were added."""
        self.volume = self.bm.calc_volume(signed=True) if self.closed else None
        self.crossings = crossing_pairs(self.bm)

    def pairs(self):
        """Each edge's two points, by index."""
        return numpy.array([(e.verts[0].index, e.verts[1].index) for e in self.bm.edges], dtype=numpy.int64).reshape(-1, 2)

    def open_points(self):
        """Whether each point is on an open edge, the rim of a sheet."""
        found = numpy.zeros(len(self.bm.verts), dtype=bool)
        for e in self.bm.edges:
            if len(e.link_faces) < 2:
                found[e.verts[0].index] = found[e.verts[1].index] = True
        return found

    def neighbour_mean(self, positions):
        """The mean place of each point's neighbours, by the edges it shares; its own place when it has none."""
        pairs = self.pairs()
        sums = numpy.zeros_like(positions)
        counts = numpy.zeros(len(positions))
        if len(pairs):
            numpy.add.at(sums, pairs[:, 0], positions[pairs[:, 1]])
            numpy.add.at(sums, pairs[:, 1], positions[pairs[:, 0]])
            numpy.add.at(counts, pairs[:, 0], 1)
            numpy.add.at(counts, pairs[:, 1], 1)
        alone = counts == 0
        counts[alone] = 1
        mean = sums / counts[:, None]
        mean[alone] = positions[alone]
        return mean

    def write(self):
        """Puts the mesh back into the object, in its own space, without the change's own layers."""
        bm = self.bm
        layers = bm.verts.layers
        for name in (BEFORE, NORMAL):
            layers.float_vector.remove(layers.float_vector[name])
        layers.float.remove(layers.float[HELD])
        if self.matrix.to_3x3().determinant() < 0:
            bmesh.ops.reverse_faces(bm, faces=list(bm.faces))
        bm.transform(self.matrix.inverted())
        bm.to_mesh(self.obj.data)
        self.obj.data.update()

    def free(self):
        self.bm.free()

    def outcome(self):
        """What the change did, measured against where each point stood before it."""
        self.refresh()
        return Outcome(self)


def crossing_pairs(bm):
    """The pairs of faces that pass through one another, not counting faces that meet at a point."""
    if not bm.faces:
        return []
    bm.faces.ensure_lookup_table()
    tree = BVHTree.FromBMesh(bm)
    faces = bm.faces

    def places(face):
        return {tuple(round(c, 6) for c in v.co) for v in face.verts}

    return [(a, b) for a, b in tree.overlap(tree) if a < b and not places(faces[a]) & places(faces[b])]


class Outcome:
    """The points a change moved, the most and where, the volume after and the self-crossings it made."""

    def __init__(self, shape):
        now, before = shape.positions(), shape.befores()
        moves = numpy.linalg.norm(now - before, axis=1)
        self.moved = numpy.nonzero(moves > MOVED)[0]
        self.most = float(moves.max()) if len(moves) else 0.0
        self.at = now[int(numpy.argmax(moves))] if len(moves) else None
        bm = shape.bm
        self.volume_before = shape.volume
        self.volume = bm.calc_volume(signed=True) if shape.closed else None
        self.faces = len(bm.faces)
        crossings = crossing_pairs(bm)
        self.new_crossings = max(0, len(crossings) - len(shape.crossings))
        moved = set(int(i) for i in self.moved)
        near = [
            bm.faces[i].calc_center_median()
            for pair in crossings
            for i in pair
            if any(v.index in moved for v in bm.faces[i].verts)
        ]
        self.crossings_at = sum(near[1:], near[0]) / len(near) if near else None

    def words(self):
        """The points moved and the most."""
        count = len(self.moved)
        if not count:
            return "no point moved"
        return f"{count} point{'s' if count != 1 else ''} moved, the most {length(self.most)} at {point_text(self.at)}"

    def volume_words(self):
        if self.volume is None:
            return "an open surface, so no volume"
        return volume_change(abs(self.volume_before), abs(self.volume))

    def crossing_words(self):
        if not self.new_crossings:
            return "no new self-crossings"
        where = f", around {point_text(self.crossings_at)}" if self.crossings_at is not None else ""
        many = self.new_crossings
        return f"{many} new pair{'s' if many != 1 else ''} of crossing faces{where}: the surface passes through itself"


def volume_change(before, after):
    """A volume before and after and the change, to a tenth of a percent, or two figures when it is less."""
    change = (after - before) / before * 100 if before else 0.0
    said = f"{change:+.1f}" if abs(change) >= 0.1 or change == 0 else f"{change:+.2g}"
    return f"volume {volume_text(before)} → {volume_text(after)} ({said}%)"


def finish(shape, heading, extra=()):
    """Writes the change back and reports it: its heading, what moved, then each extra part, volume and crossings."""
    found = shape.outcome()
    shape.write()
    parts = [found.words(), *extra, found.volume_words(), found.crossing_words()]
    report(f"{heading}: {'; '.join(parts)}.")
    return found
