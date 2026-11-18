"""
A baked liquid measured on its surface at frames across the bake: the volume, sampled on a grid as
points inside the liquid and outside every obstacle, since Mantaflow's surface reaches into the
obstacles it touches; what of it lies outside the container's outline; and how deep it stands in
the container at the end.
"""

import statistics

import bmesh
import bpy
import mathutils
import mathutils.bvhtree
import numpy

from .disk_files import folder_size
from .finding import scene
from .shown_mesh import held_by, is_inside, shells, shown_bmesh
from .timeline import seconds_of
from .wording import length, volume_text

# Frames measured across the bake, and the most points sampled on one.
MEASURED_FRAMES = 6
MOST_SAMPLES = 120000


def megabytes(folder):
    return f"{folder_size(folder) / 1e6:.3g} MB"


def world_bmesh(obj):
    # Each frame of the bake evaluated anew.
    bm = shown_bmesh(obj, depsgraph=bpy.context.evaluated_depsgraph_get())
    bm.normal_update()
    return bm


def solid(obj):
    """An obstacle's closed shells, which the liquid does not fill."""
    bm = world_bmesh(obj)
    try:
        return shells(bm)
    finally:
        bm.free()


def hull_tree(obj):
    """The container's convex outline: what lies within it is in the container."""
    bm = world_bmesh(obj)
    hull = bmesh.new()
    try:
        for v in bm.verts:
            hull.verts.new(v.co)
        bmesh.ops.convex_hull(hull, input=hull.verts[:])
        hull.normal_update()
        return mathutils.bvhtree.BVHTree.FromBMesh(hull) if hull.faces else None
    finally:
        bm.free()
        hull.free()


def is_own_box(domain, bm):
    """Whether the domain shows its own box: at a frame with no liquid left, Blender shows the domain's mesh."""
    own = [domain.matrix_world @ v.co for v in domain.data.vertices]
    return len(own) == len(bm.verts) and all((a - v.co).length < 1e-6 for a, v in zip(own, bm.verts))


def sampled(domain, obstacles, voxel):
    """The liquid as grid points inside its surface and outside every obstacle, and the grid's step."""
    bm = world_bmesh(domain)
    try:
        if not bm.faces or is_own_box(domain, bm):
            return [], voxel
        tree = mathutils.bvhtree.BVHTree.FromBMesh(bm)
        low = numpy.array([min(v.co[i] for v in bm.verts) for i in range(3)])
        high = numpy.array([max(v.co[i] for v in bm.verts) for i in range(3)])
    finally:
        bm.free()
    step = voxel / 2
    while numpy.prod(numpy.ceil((high - low) / step)) > MOST_SAMPLES:
        step *= 1.25
    solids = [shell for o in obstacles for shell in solid(o)]
    axes = [numpy.arange(low[i] + step / 2, high[i], step) for i in range(3)]
    found = []
    for x in axes[0]:
        for y in axes[1]:
            for z in axes[2]:
                point = mathutils.Vector((x, y, z))
                if is_inside(tree, point) and not held_by(solids, point):
                    found.append(point)
    return found, step


def frames_measured():
    room = scene()
    first, last = room.frame_start, room.frame_end
    count = min(MEASURED_FRAMES, last - first + 1)
    return sorted({round(first + (last - first) * i / max(count - 1, 1)) for i in range(count)})


def seconds_text(frame):
    return f"{seconds_of(frame):.3g} s"


def after_bake(domain, container, obstacles, voxel, shaped, pours):
    """The lines measuring the baked liquid: its volume over time, what lies outside the container and how deep it stands."""
    room = scene()
    volumes, points, steps = [], [], []
    for frame in frames_measured():
        room.frame_set(frame)
        points, grid = sampled(domain, obstacles, voxel)
        volumes.append((frame, len(points) * grid**3))
        if points:
            steps.append(grid)
    # A large liquid is sampled more coarsely; the coarsest grid any frame took is said.
    step = max(steps, default=voxel / 2)
    listed = ", ".join(f"{volume_text(v)} at {seconds_text(f)}" for f, v in volumes)
    first, last = volumes[0][1], volumes[-1][1]
    lines = []
    if pours:
        span = seconds_of(volumes[-1][0]) - seconds_of(volumes[0][0])
        rate = (last - first) / span if span > 0 else 0.0
        said = f"it grew by {volume_text(abs(rate))} a second" if rate >= 0 else f"it shrank by {volume_text(-rate)} a second"
        lines.append(f"Liquid volume, sampled every {length(step)}: {listed}; {said} while the sources poured.")
    else:
        modelled = sum(shaped)
        change = (last - first) / first if first > 0 else 0.0
        kept = (
            f"at the end {abs(change) * 100:.3g}% {'more' if change > 0 else 'less'} than at the start"
            if abs(change) >= 0.005
            else "the same at the end as at the start"
        )
        lines.append(
            f"Liquid volume, sampled every {length(step)}: {listed}; {kept}. The sources hold {volume_text(modelled)}"
            f" as modelled, {volume_text(first)} as the voxels first held them."
        )
    if not points:
        lines.append("No liquid is left at the end: all of it left the domain by its sides or top.")
        return lines
    if container is not None:
        lines += container_lines(container, points, grid)
    return lines


def column_tops(points, grid):
    """The top of the liquid standing in each column of the grid, from its lowest point up to the first gap."""
    columns = {}
    for p in points:
        columns.setdefault((round(p.x / grid), round(p.y / grid)), []).append(p.z)
    tops = []
    for heights in columns.values():
        heights.sort()
        top = heights[0]
        for z in heights[1:]:
            if z - top > 1.5 * grid:
                break
            top = z
        tops.append(top + grid / 2)
    return tops


def container_lines(container, points, grid):
    """What lies outside the container's outline, what is still falling into it, and how deep it stands in it."""
    outline = hull_tree(container)
    rim = max((container.matrix_world @ mathutils.Vector(c)).z for c in container.bound_box)
    held, falling, spilled = [], [], []
    for p in points:
        if outline is not None and is_inside(outline, p):
            held.append(p)
        elif p.z > rim and outline is not None and is_inside(outline, mathutils.Vector((p.x, p.y, rim - grid / 2))):
            falling.append(p)
        else:
            spilled.append(p)
    cell = grid**3
    total = len(points) * cell
    share = len(spilled) * cell / total
    note = ": it leaked or spilled" if share >= 0.05 else ""
    lines = [f"Outside {container.name} at the end: {volume_text(len(spilled) * cell)}, {share * 100:.3g}% of the liquid{note}."]
    if falling:
        lines.append(f"Above {container.name}, still falling in: {volume_text(len(falling) * cell)}.")
    if not held:
        lines.append(f"In {container.name} at the end: no liquid.")
        return lines
    tops = sorted(column_tops(held, grid))
    surface = statistics.median(tops)
    floor = min(p.z for p in held) - grid / 2
    low, high = tops[len(tops) // 10], tops[(len(tops) * 9) // 10]
    to_rim = f"{length(rim - surface)} below the rim" if surface < rim else f"{length(surface - rim)} above the rim"
    lines.append(
        f"In {container.name} at the end: the liquid stands {length(surface - floor)} deep, its surface at {length(surface)} high"
        f" ({length(low)} to {length(high)} across it), {to_rim}."
    )
    return lines
