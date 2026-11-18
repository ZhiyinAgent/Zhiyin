"""
How noisy a Cycles picture is, from two more at half its size with other seeds: what differs
between them is noise; fireflies, lone bright samples in one seed's light only, before any
denoising and, when a call sets a clamp, without it too; and what the denoiser smoothed away, the
fine detail both noisy pictures agree on that the denoised ones no longer hold.
"""

import math
import os
import shutil
import tempfile

import bpy
import numpy

from .finding import scene
from .pictures import write_picture
from .render_checks import load, luminance, names_over, owners_of
from .render_passes import COMBINED, NOISY, passes_now

# Noise past this share of the brightness shows as grain.
NOISE_LIMIT = 0.02
# A pixel this many times brighter than the pixels round it, in one seed's picture only, is a firefly.
FIREFLY = 8
SEEDS = (101, 202)
# Fine detail: gradients across a surface at least this share of its brightness, as their mean square.
FINE = 0.03**2
# A surface whose denoised pictures keep less than this share of its fine detail is said to be smeared.
KEPT_DETAIL = 0.6
# How many surfaces are named.
NAMED = 3


def fireflies(one, other):
    """Pixels far brighter than those round them in one picture, and not in the other."""
    padded = numpy.pad(one, 1, mode="edge")
    around = numpy.median(
        numpy.stack([padded[y : y + one.shape[0], x : x + one.shape[1]] for y in range(3) for x in range(3) if (y, x) != (1, 1)]),
        axis=0,
    )
    return int(((one > FIREFLY * numpy.maximum(around, 0.01)) & (other < one / 2)).sum())


def owner_at(owner, shape):
    """The drawing that tells which object is where, at a picture's size."""
    height, width = owner.shape
    ys = (numpy.arange(shape[0]) * height / shape[0]).astype(int)
    xs = (numpy.arange(shape[1]) * width / shape[1]).astype(int)
    return owner[ys][:, xs]


def detail(picture):
    """The square of each pixel's change to the next across and down."""
    across = numpy.diff(picture, axis=1)[:-1, :]
    down = numpy.diff(picture, axis=0)[:, :-1]
    return across**2 + down**2


def smeared(noisy, denoised, owner, objects):
    """
    The surfaces whose fine detail the denoiser smoothed away, with the share
    it kept, most lost first; and how many surfaces had fine detail to judge.
    The detail both noisy pictures share is that of their mean less that of
    their half difference, which is noise alone; the denoised pictures' is
    measured the same way.
    """
    if owner is None:
        return [], 0
    a, b = noisy
    c, d = denoised
    own = owner_at(owner, a.shape)
    true = detail((a + b) / 2) - detail((a - b) / 2)
    kept = detail((c + d) / 2) - detail((c - d) / 2)
    found, judged = [], 0
    for number in numpy.unique(own):
        if number == 0 or number > len(objects):
            continue
        # Inside the surface only: its edges are not its detail.
        inside = (own[:-1, :-1] == number) & (own[:-1, 1:] == number) & (own[1:, :-1] == number)
        if inside.sum() < 16:
            continue
        bright = max(float(((a + b) / 2)[:-1, :-1][inside].mean()), 1e-4)
        signal = float(true[inside].mean())
        if signal / bright**2 < FINE:
            continue
        judged += 1
        share = max(0.0, float(kept[inside].mean()) / signal)
        if share < KEPT_DETAIL:
            found.append((objects[number - 1].name, share))
    return sorted(found, key=lambda item: item[1]), judged


def drawn(folder, name, denoising):
    """One noise picture: its display brightness, and the light under it before and after denoising."""
    path = os.path.join(folder, f"{name}.png")
    write_picture(path, "PNG")
    shown = luminance(load(path)[..., :3])
    passes = passes_now(folder, name)
    denoised = passes.get(COMBINED)
    noisy = passes.get(NOISY) if denoising else denoised
    light = lambda rgba: luminance(rgba[..., :3]) if rgba is not None else None
    return shown, light(noisy), light(denoised)


def noise_text(found, samples, clamp_asked=False):
    """
    The picture's noise as a share of the brightness and where it is most,
    its fireflies, and, denoised, what the denoiser smoothed away. Drawn
    raw, without the post, which would add its own grain.
    """
    s = scene()
    owner, objects = owners_of(found)
    folder = tempfile.mkdtemp(prefix="zhiyin-noise-")
    layer = bpy.context.view_layer.cycles
    denoising = s.cycles.use_denoising
    kept = (s.cycles.seed, s.cycles.use_animated_seed, s.render.resolution_percentage, s.render.use_compositing)
    stored = layer.denoising_store_passes if layer is not None else None
    clamps = (s.cycles.sample_clamp_direct, s.cycles.sample_clamp_indirect)
    unclamped = None
    try:
        s.cycles.use_animated_seed = False
        s.render.resolution_percentage = 50
        s.render.use_compositing = False
        if layer is not None:
            layer.denoising_store_passes = denoising
        pictures = []
        for seed in SEEDS:
            s.cycles.seed = seed
            pictures.append(drawn(folder, str(seed), denoising))
        if clamp_asked and any(clamps):
            s.cycles.seed = SEEDS[0]
            s.cycles.sample_clamp_direct = s.cycles.sample_clamp_indirect = 0
            unclamped = drawn(folder, "unclamped", denoising)[1]
    finally:
        s.cycles.seed, s.cycles.use_animated_seed, s.render.resolution_percentage, s.render.use_compositing = kept
        s.cycles.sample_clamp_direct, s.cycles.sample_clamp_indirect = clamps
        if layer is not None:
            layer.denoising_store_passes = stored
        shutil.rmtree(folder, ignore_errors=True)
    (first, a, c), (second, b, d) = pictures
    bright = numpy.maximum((first + second) / 2, 0.02)
    difference = numpy.abs(first - second) / math.sqrt(2) / bright
    level = float(numpy.sqrt(numpy.mean(difference**2)))
    line = f"Noise, from two pictures at half size with other seeds and {samples} samples: {level * 100:.2g}% of the brightness"
    if level > NOISE_LIMIT:
        where = names_over(difference > NOISE_LIMIT * 2, owner, objects)
        line += f", over the {NOISE_LIMIT * 100:g}% past which it shows as grain" + (f", most on {', '.join(where)}" if where else "")
        line += "; more samples lower it"
    noisy = (a, b) if a is not None and b is not None else (first, second)
    counted = fireflies(*noisy) + fireflies(*reversed(noisy))
    line += f"; {counted} {'firefly' if counted == 1 else 'fireflies'} in the light before {'denoising' if denoising else 'the tone'}"
    if unclamped is not None:
        before = fireflies(unclamped, noisy[1])
        after = fireflies(*noisy)
        line += f", and in the first seed's picture {after} with the clamp against {before} without it"
    elif counted:
        indirect = s.cycles.sample_clamp_indirect
        line += (
            ", lone bright samples that more samples or a clamp on indirect light remove: sampling clamp indirect "
            + (f"is {indirect:g}; a lower one removes more, and dims caustics and sparkle with them" if indirect > 0 else "is off; 10 removes most")
        )
    line += "."
    if denoising and a is not None and c is not None:
        lost, judged = smeared((a, b), (c, d), owner, objects)
        if lost:
            best = s.cycles.denoising_quality == "HIGH" and s.cycles.denoising_prefilter == "ACCURATE"
            line += (
                " The denoiser smoothed away fine detail both noisy pictures share: "
                + ", ".join(f"{name} keeps {share:.0%} of it" for name, share in lost[:NAMED])
                + ". "
                + ("More samples" if best else "Denoise best keeps more, and more samples")
                + " leave it less to guess; glass and fine textures lose most."
            )
        elif judged:
            line += f" The denoiser kept the fine detail of the {judged} {'surface' if judged == 1 else 'surfaces'} that have it."
    return line
