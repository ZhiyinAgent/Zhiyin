"""
Where a ready rig's joints go on a body, measured from its sections: the columns of its legs from the
ground up to where they join the body, the narrowest sections of a leg, an arm and the neck, where the
arms leave the chest, and the body's top, front and back. Each joint says what it was fitted to; a joint
no section shows is placed by the metarig's own proportions, and says so.
"""

import mathutils
import numpy

from .wording import length

# Shares of the body's height the level cuts are taken at.
LEVELS = 160
# How much narrower than the band's ends a section must be to count as a narrowing.
NARROWER = 0.95
# How far above the crotch a person's hip joints are, as a share of their height.
HIP_ABOVE_CROTCH = 0.06
# How far up from where a leg joins the body toward the top of the back its upper joint sits.
LEG_JOINT_UP = 0.35


class Joint:
    def __init__(self, point, how):
        self.point = mathutils.Vector([float(c) for c in point])
        self.how = how


class Found:
    """The joints fitted, by key, and what could not be found."""

    def __init__(self):
        self.joints = {}
        self.missing = []

    def put(self, key, point, how):
        self.joints[key] = Joint(point, how)


def nearest(islands, point, axes=(0, 1)):
    if not islands:
        return None
    return min(islands, key=lambda i: sum((i.centre[a] - point[a]) ** 2 for a in axes))


def leg_columns(body, count):
    """The islands of `count` legs where a level plane near the ground cuts them, and that height."""
    for share in (0.02, 0.035, 0.05, 0.08, 0.12):
        found = body.level(share * body.height)
        if len(found) == count:
            return found, share * body.height
    return None, None


def track(body, columns, start, stop):
    """Each leg column followed up level by level until it joins another or the body: its islands by height."""
    tracks = [[(start, c)] for c in columns]
    open_ = [True] * len(columns)
    for z in numpy.linspace(start, stop, LEVELS)[1:]:
        islands = body.level(z)
        picks = [nearest(islands, t[-1][1].centre) if open_[k] else None for k, t in enumerate(tracks)]
        for k, pick in enumerate(picks):
            if not open_[k] or pick is None:
                open_[k] = False
                continue
            shared = any(j != k and picks[j] is pick for j in range(len(picks)))
            widths = [i.wide for _, i in tracks[k]]
            if shared or pick.wide > 2.5 * float(numpy.median(widths)) or pick.deep > 4 * float(numpy.median([i.deep for _, i in tracks[k]])):
                open_[k] = False
                continue
            tracks[k].append((z, pick))
        if not any(open_):
            break
    return tracks


def at_height(column, z):
    return min(column, key=lambda entry: abs(entry[0] - z))[1]


def dip(entries, expected):
    """
    Of sections in order along a body or a limb, the narrowing nearest `expected`: a section narrower than
    its neighbours, and than the widest on each side of it by a twentieth or more, as a wrist is between the
    forearm and the hand. None where the band only tapers.
    """
    across = [i.across for _, i in entries]
    found = [
        k
        for k in range(1, len(across) - 1)
        if across[k] <= across[k - 1] and across[k] <= across[k + 1] and across[k] < NARROWER * max(across[:k]) and across[k] < NARROWER * max(across[k + 1 :])
    ]
    return entries[min(found, key=lambda k: abs(entries[k][0] - expected))] if found else None


def narrowest(column, low, high, expected=None):
    """The narrowing between two heights nearest the height expected (their middle by default); else None."""
    band = [(z, i) for z, i in column if low <= z <= high]
    return dip(band, (low + high) / 2 if expected is None else expected) if len(band) >= 5 else None


def fit_leg(found, column, chain, top, scale, name):
    """A leg's joints between its upper joint and its toe tip: the narrowest sections where it narrows, else by proportion."""
    keys = chain.keys
    meta_top = chain.meta[0].z
    found.put(keys[0], top[0], top[1])
    middle = list(range(1, len(keys) - 1))
    for rank, i in enumerate(sorted(middle, key=lambda k: chain.meta[k].z)):
        share = chain.meta[i].z / meta_top if meta_top > 1e-9 else 0.5
        z = top[0].z * share
        reach = 0.5 * share if rank == 0 else 0.25
        spot = narrowest(column, max(column[0][0], top[0].z * (share - reach)), top[0].z * (share + reach), z)
        if spot is not None:
            island = spot[1]
            point = (island.centre[0], island.centre[1], spot[0])
            how = f"the narrowest section of the {name} there, {length(island.across)} across"
        else:
            island = at_height(column, z)
            point = (island.centre[0], island.centre[1], z)
            how = f"by proportion, {share:.0%} of the way up to the {chain.roles[0]} as the metarig has it, on the middle of the {name}'s section: no narrowing there"
            found.missing.append(f"{chain.roles[i]} of the {name}")
        found.put(keys[i], point, how)
    foot = column[0][1]
    tip = chain.meta[-1]
    found.put(keys[-1], (foot.centre[0], foot.low[1], tip.z * scale), f"the front of the {name}'s foot at the ground")


def legs(body, rig, found):
    """The leg columns matched to the metarig's legs, followed up, each with its leg chain."""
    columns, start = leg_columns(body, len(rig.legs))
    if columns is None:
        found.missing.append(f"the {len(rig.legs)} legs: no level near the ground cuts the body into {len(rig.legs)} columns")
        return None
    chosen = {}
    free = list(columns)
    for chain in sorted(rig.legs, key=lambda c: (c.meta[-1].y, c.meta[-1].x)):
        meta_y = chain.meta[-1].y - (rig.front + rig.length / 2)
        target = (chain.meta[-1].x * body.width / max(rig.width, 1e-9), meta_y * body.length / max(rig.length, 1e-9))
        pick = min(free, key=lambda i: (i.centre[0] - target[0]) ** 2 + (i.centre[1] - target[1]) ** 2)
        free.remove(pick)
        chosen[chain] = pick
    chains = list(chosen)
    tracks = track(body, [chosen[c] for c in chains], start, 0.95 * body.height)
    return dict(zip(chains, tracks))


def arm(body, chain, found, half, low, name):
    """
    An arm, or a wing: the body's points out past the chest on its side, their middle line, and sections
    across it: where it leaves the chest, its narrowest sections, and its tip.
    """
    side = 1 if chain.meta[-1].x > 0 else -1
    pts = body.points
    out = pts[(side * pts[:, 0] > half * 1.1) & (pts[:, 2] > low)]
    if len(out) < 8:
        found.missing.append(f"the {name}: nothing reaches out past the chest on that side")
        return False
    middle = out.mean(axis=0)
    _, _, axes = numpy.linalg.svd(out - middle, full_matrices=False)
    way = axes[0] if axes[0][0] * side > 0 else -axes[0]
    reach = (out - middle) @ way
    tip_t = float(reach.max())
    root_t = float(reach.min())
    if abs(way[0]) > 0.2:
        root_t = max(root_t, (side * half - middle[0]) / way[0] if side * way[0] > 0 else root_t)
    span = tip_t - root_t
    sections = []
    for t in numpy.linspace(root_t, tip_t, 80)[1:-1]:
        centre = middle + way * t
        pick = nearest(body.cut(way, float(numpy.dot(centre, way))), centre, axes=(0, 1, 2))
        if pick is not None:
            sections.append((float(t), pick))
    shoulder = middle + way * root_t
    found.put(chain.keys[0], shoulder, f"where the {name} leaves the chest, on its middle line")
    found.put(chain.keys[-1], middle + way * tip_t, f"the end of the {name}, on its middle line")
    for i in range(1, len(chain.keys) - 1):
        share = chain.share(i)
        picked = [(t, s) for t, s in sections if root_t + span * (share - 0.2) <= t <= root_t + span * (share + 0.2)]
        spot = dip(picked, root_t + span * share) if len(picked) >= 5 else None
        if spot is not None:
            found.put(chain.keys[i], spot[1].centre, f"the narrowest section of the {name} there, {length(spot[1].across)} across")
        else:
            t = root_t + span * share
            near = min(sections, key=lambda e: abs(e[0] - t))[1].centre if sections else middle + way * t
            found.put(chain.keys[i], near, f"by proportion, {share:.0%} of the way from the {chain.roles[0]} to the tip as the metarig has it: no narrowing there")
            found.missing.append(f"{chain.roles[i]} of the {name}")
    return True


def central(islands):
    """The island the body's middle plane crosses, or the one nearest it."""
    crossing = [i for i in islands if i.spans(0, 0.0)]
    return max(crossing, key=lambda i: i.wide) if crossing else nearest(islands, (0.0, 0.0), axes=(0,))


def biped(body, rig):
    """A person's joints: legs from the ground to the crotch, the arms off the chest, the neck and the top of the head."""
    found = Found()
    height = body.height
    scale = height / rig.height
    tracked = legs(body, rig, found)
    crotch = None
    if tracked:
        crotch = min(t[-1][0] for t in tracked.values())
        for chain, column in tracked.items():
            name = f"{chain.side_word} leg"
            last = at_height(column, crotch - 0.03 * height)
            top = (mathutils.Vector((last.centre[0], last.centre[1], crotch + HIP_ABOVE_CROTCH * height)), f"{HIP_ABOVE_CROTCH:.0%} of the height above the crotch, which is {length(crotch)} up, over the middle of the {name}'s top section")
            fit_leg(found, column, chain, top, scale, name)
    floor = crotch if crotch is not None else 0.45 * height
    levels = [(z, central(body.level(z))) for z in numpy.linspace(floor + 0.02 * height, 0.995 * height, LEVELS)]
    levels = [(z, i) for z, i in levels if i is not None]
    armpit = None
    for k in range(8, len(levels)):
        before = float(numpy.median([i.wide for _, i in levels[max(0, k - 30) : k]]))
        if levels[k][1].wide > 1.35 * before and levels[k][0] > floor + 0.1 * height:
            armpit = k
            break
    chest = levels[armpit - 3][1] if armpit is not None and armpit >= 3 else None
    shoulders = []
    for chain in rig.arms:
        name = f"{chain.side_word} arm"
        if chest is None or not arm(body, chain, found, chest.wide / 2, floor, name):
            if chest is None:
                found.missing.append(f"the {name}: the body never widens above the waist as arms joining it do")
            continue
        shoulders.append(found.joints[chain.keys[0]].point.z)
    shoulder_z = float(numpy.mean(shoulders)) if shoulders else rig.meta(rig.spine["neck"]).z * scale
    top_island = central(body.level(0.99 * height))
    head_top = (top_island.centre[0] if top_island else 0.0, top_island.centre[1] if top_island else 0.0, height)
    found.put(rig.spine["head_top"], head_top, "the body's highest point")
    neck = [(z, i) for z, i in levels if shoulder_z < z < shoulder_z + 0.6 * (height - shoulder_z)]
    spot = narrowest(neck, shoulder_z, shoulder_z + 0.6 * (height - shoulder_z)) if neck else None
    if spot is not None:
        found.put(rig.spine["neck"], (spot[1].centre[0], spot[1].centre[1], spot[0]), f"the narrowest section between the shoulders and the top of the head, {length(spot[1].across)} across")
    else:
        z = rig.meta(rig.spine["neck"]).z * scale
        found.put(rig.spine["neck"], (0.0, 0.0, z), "by proportion of the height, as the metarig has it: no neck narrows between the shoulders and the head")
        found.missing.append("the neck")
    hips = [found.joints[c.keys[0]].point for c in rig.legs if c.keys[0] in found.joints]
    meta_hips = rig.meta(rig.spine["hips"])
    if hips:
        meta_joints = sum((c.meta[0] for c in rig.legs), mathutils.Vector()) / len(rig.legs)
        middle = sum(hips, mathutils.Vector()) / len(hips)
        point = middle + (meta_hips - meta_joints) * scale
        found.put(rig.spine["hips"], (0.0, point.y, point.z), "between the hip joints, as far below and behind them as the metarig has it")
    else:
        found.put(rig.spine["hips"], meta_hips * scale, "by proportion of the height, as the metarig has it")
    return found


def creature(body, rig):
    """An animal's joints: its legs from the ground up to the body, the spine over them, the head's front and the tail."""
    found = Found()
    scale = body.height / rig.height
    tracked = legs(body, rig, found) if rig.legs else None
    pts = body.points
    tops = {}
    if tracked:
        for chain, column in tracked.items():
            name = chain.leg_word
            z_top, island = column[-1]
            near = pts[numpy.abs(pts[:, 1] - island.centre[1]) < 0.08 * body.length]
            back = float(near[:, 2].max()) if len(near) else body.height
            z = z_top + LEG_JOINT_UP * (back - z_top)
            tops[chain] = mathutils.Vector((island.centre[0], island.centre[1], z))
            how = f"{LEG_JOINT_UP:.0%} of the way from where the {name} joins the body, {length(z_top)} up, to the top of the back over it"
            fit_leg(found, column, chain, (tops[chain], how), scale, name)
    high = min((t.z for t in tops.values()), default=0.3 * body.height)
    above = pts[pts[:, 2] > high]
    front = above[above[:, 1].argmin()] if len(above) else pts[pts[:, 1].argmin()]
    back = pts[pts[:, 1].argmax()]
    spine = rig.spine
    if "head_tip" in spine:
        found.put(spine["head_tip"], (0.0, front[1], front[2]), "the body's frontmost point" + (" above the legs" if tops else ""))
    if "tail_tip" in spine:
        found.put(spine["tail_tip"], (0.0, back[1], back[2]), "the body's rearmost point")
    pairs = {}
    for chain, top in tops.items():
        pairs.setdefault(chain.is_front, []).append((chain, top))
    for role, front_pair in (("hips", False), ("neck_base", True)):
        if role not in spine:
            continue
        pair = pairs.get(front_pair) or pairs.get(not front_pair)
        meta_point = rig.meta(spine[role])
        if pair:
            measured = sum((t for _, t in pair), mathutils.Vector()) / len(pair)
            meta = sum((c.meta[0] for c, _ in pair), mathutils.Vector()) / len(pair)
            point = measured + (meta_point - meta) * scale
            which = "the legs'" if len(pairs) == 1 else "the front legs'" if pair[0][0].is_front else "the hind legs'"
            found.put(spine[role], (0.0, point.y, point.z), f"over {which} upper joints, as far from them as the metarig has it")
        else:
            on = along(body, rig, meta_point)
            found.put(spine[role], on, "by proportion of the body's length, as the metarig has it, on the middle of its section")
            if rig.legs:
                found.missing.append(f"legs to place the {role.replace('_', ' ')} over")
    if "head_base" in spine and "head_tip" in spine and "neck_base" in spine:
        start, end = found.joints[spine["neck_base"]].point, found.joints[spine["head_tip"]].point
        column = []
        for y in numpy.linspace(start.y, end.y, 40)[4:-4]:
            pick = central([i for i in body.cut((0, 1, 0), float(y)) if i.high[2] > high])
            if pick is not None:
                column.append((float(y), pick))
        meta_start, meta_end, meta_here = (rig.meta(spine[k]) for k in ("neck_base", "head_tip", "head_base"))
        share = (meta_here - meta_start).length / max((meta_end - meta_start).length, 1e-9)
        spot = dip(column, start.y + (end.y - start.y) * share) if len(column) >= 5 else None
        if spot is not None:
            found.put(spine["head_base"], (0.0, spot[0], spot[1].centre[2]), f"the narrowest section between the chest and the head's front, {length(spot[1].across)} across")
        else:
            found.put(spine["head_base"], start.lerp(end, share), "by proportion between the neck and the head's front, as the metarig has it: no narrowing there")
            found.missing.append("where the head joins the neck")
    for role in ("hips", "neck_base"):
        if role in spine and spine[role] not in found.joints:
            found.put(spine[role], along(body, rig, rig.meta(spine[role])), "by proportion of the body's length, as the metarig has it, on the middle of its section")
    if rig.arms and "hips" in spine:
        # Wings reach out past the body as it is behind them, over the hips.
        trunk = central(body.cut((0, 1, 0), found.joints[spine["hips"]].point.y))
        for chain in rig.arms:
            if trunk is None or not arm(body, chain, found, trunk.wide / 2, high, chain.leg_word):
                if trunk is None:
                    found.missing.append(f"the {chain.leg_word}: the body has no section over the hips to measure past")
    return found


def along(body, rig, meta_point):
    """A metarig point placed by its share of the metarig's length, on the middle of the body's section there."""
    share = (meta_point.y - rig.front) / max(rig.length, 1e-9)
    y = float(body.points[:, 1].min()) + share * body.length
    pick = central(body.cut((0, 1, 0), y))
    z = pick.centre[2] if pick is not None else meta_point.z * body.height / rig.height
    return mathutils.Vector((0.0, y, z))
