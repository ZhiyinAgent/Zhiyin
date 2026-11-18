"""
What an object's layout came to, in words a model can act on: its islands, stretch, texel
density, faces turned over, islands lying on one another or stacked on twins, how much of the
tile they fill and which reach outside it, and its seams with how much of them the camera sees.
"""

from .unwrap_measures import MEASURED, Covered, Laid, density, flipped, outside_tile, overlaps, stretch
from .unwrap_seams import layout_seams, seams_bmesh, seams_seen
from .wording import length, point_text


def _count(number, one, many=None):
    return f"{number} {one if number == 1 else many or one + 's'}"


def _degrees(value):
    """Degrees to two figures, a hundredth of a degree and less being none."""
    return "0" if value < 0.005 else f"{value:.2g}"


def layout_measures(obj, resolution):
    """The layout's measures, for the answer and for a bake's checks; None when it has no layout or faces."""
    laid = Laid(obj)
    if laid.empty:
        return None
    covered = Covered(laid, min(resolution, MEASURED))
    twins, loose, where = overlaps(laid, covered)
    mirrored = {i for one, two, mirror in twins if mirror for i in (one, two)}
    return {
        "laid": laid,
        "covered": covered,
        "twins": twins,
        "loose": loose,
        "loose_at": where,
        "flipped": flipped(laid, mirrored),
        "outside": outside_tile(laid),
    }


def _at(laid, triangle):
    return point_text(laid.corners[triangle].mean(axis=0))


def layout_lines(obj, resolution, sight):
    """The lines saying what an object's layout is now."""
    found = layout_measures(obj, resolution)
    if found is None:
        return [f"{obj.name}'s layout: none, or no faces in it."]
    laid, covered = found["laid"], found["covered"]
    said = [_count(laid.island_count, "island")]
    stretched = stretch(laid)
    if stretched:
        (angle_mean, angle_most), (area_mean, area_most) = stretched
        said.append(f"angles stretch {_degrees(angle_mean)}° on average, {_degrees(angle_most)}° at most")
        said.append(f"areas stretch {area_mean:.0%} on average, {area_most:.0%} at most")
    texels = density(laid, resolution)
    if texels:
        least, median, most = texels
        said.append(f"texel density {least:.3g} to {most:.3g} px/cm, median {median:.3g}, at {resolution} px")
    count, triangle, whole = found["flipped"]
    if whole:
        said.append("its whole layout turned over, so pictures show mirrored")
    elif count:
        said.append(f"{_count(count, 'face')} turned over, as at {_at(laid, triangle)}")
    else:
        said.append("no faces turned over")
    twins = found["twins"]
    mirror = sum(1 for _, _, m in twins if m)
    if mirror:
        said.append(f"{_count(mirror, 'pair')} of islands stacked as mirror twins, as a mirror step lays them")
    if len(twins) - mirror:
        said.append(f"{_count(len(twins) - mirror, 'pair')} of identical islands stacked, sharing their texels")
    if found["loose"]:
        share = found["loose"] / covered.size**2
        said.append(
            f"islands overlap on {share:.1%} of the tile, as at {_at(laid, found['loose_at'])}, so a bake writes those texels twice"
        )
    elif not twins:
        said.append("no islands overlap")
    fill = covered.filled / covered.size**2
    outside = found["outside"]
    said.append(f"fills {fill:.2f} of the tile, " + (f"{_count(outside, 'island')} reaching outside it" if outside else "none outside it"))
    bm = seams_bmesh(obj)
    try:
        layer = bm.loops.layers.uv.active
        edges = layout_seams(bm, layer) if layer is not None else []
        total, seen = seams_seen(obj, edges, sight)
    finally:
        bm.free()
    if edges:
        shown = f"{seen:.0%} of it in view of {sight.camera.name}" if seen is not None else "no camera to see it"
        said.append(f"{_count(len(edges), 'seam edge')} {length(total)} long, {shown}")
    else:
        said.append("no seams")
    return [f"{obj.name}'s layout: " + "; ".join(said) + "."]
