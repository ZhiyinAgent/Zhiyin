"""
Cycles's sampling as a render sets it and keeps it in the scene: the noise a pixel stops at, the
samples every pixel takes first, a time limit, the seed, the sampling pattern, the denoiser and the
clamps on bright samples; and what a picture spent: the sample it reached, read from Blender's
render statistics as it draws, what stopped it there, and how much of the picture took every sample.
"""

import re

import bpy

from .arguments import need, number, whole
from .finding import scene

# The tools' names for Cycles's sampling patterns.
PATTERNS = {"automatic": "AUTOMATIC", "tabulated_sobol": "TABULATED_SOBOL", "blue_noise": "BLUE_NOISE"}
# The tools' names for the denoiser's settings: OpenImageDenoise's quality and prefilter.
DENOISE = {"fast": ("FAST", "FAST"), "best": ("HIGH", "ACCURATE")}
DENOISE_WORDS = {"HIGH": "high", "BALANCED": "balanced", "FAST": "fast"}
PREFILTER_WORDS = {"ACCURATE": "an accurate prefilter", "FAST": "a fast prefilter", "NONE": "no prefilter"}
PASSES_WORDS = {"RGB_ALBEDO_NORMAL": "colour, albedo and normals", "RGB_ALBEDO": "colour and albedo", "RGB": "colour alone"}
# A picture that ran this share of its time limit or more was stopped by it.
RAN_OUT = 0.9
# A pixel that took this share of its samples or more took them all.
ALL_TAKEN = 0.999


def set_sampling(spec, engine, gpu=False):
    """Sets the sampling a call gives on the scene, where it stays for later pictures."""
    if spec is None:
        return
    need(engine == "cycles", "sampling is Cycles's: EEVEE draws a fixed number of samples, which samples sets.")
    need(isinstance(spec, dict), "sampling gives noise_threshold, min_samples, time_limit, seed, pattern, denoise or clamp.")
    cycles = scene().cycles
    if spec.get("denoise") is not None:
        need(spec["denoise"] in ("off", *DENOISE), f"denoise is off, {' or '.join(DENOISE)}.")
        cycles.use_denoising = spec["denoise"] != "off"
        if spec["denoise"] != "off":
            cycles.denoiser = "OPENIMAGEDENOISE"
            cycles.denoising_quality, cycles.denoising_prefilter = DENOISE[spec["denoise"]]
            cycles.denoising_input_passes = "RGB_ALBEDO_NORMAL"
            cycles.denoising_use_gpu = gpu
    if spec.get("clamp") is not None:
        clamp = spec["clamp"]
        need(isinstance(clamp, dict), "clamp gives direct and indirect, the brightest a sample may be; 0 clamps none.")
        if clamp.get("direct") is not None:
            cycles.sample_clamp_direct = number(clamp["direct"], "clamp direct", minimum=0, maximum=1e6)
        if clamp.get("indirect") is not None:
            cycles.sample_clamp_indirect = number(clamp["indirect"], "clamp indirect", minimum=0, maximum=1e6)
    if spec.get("noise_threshold") is not None:
        threshold = number(spec["noise_threshold"], "noise_threshold", minimum=0, maximum=1)
        cycles.use_adaptive_sampling = threshold > 0
        if threshold > 0:
            cycles.adaptive_threshold = threshold
    if spec.get("min_samples") is not None:
        cycles.adaptive_min_samples = whole(spec["min_samples"], "min_samples", minimum=0, maximum=16384)
    if spec.get("time_limit") is not None:
        cycles.time_limit = number(spec["time_limit"], "time_limit", minimum=0, maximum=86400)
    if spec.get("seed") is not None:
        cycles.seed = whole(spec["seed"], "seed", minimum=0, maximum=2**31 - 1)
        cycles.use_animated_seed = False
    if spec.get("pattern") is not None:
        need(spec["pattern"] in PATTERNS, f"pattern is one of {', '.join(PATTERNS)}.")
        cycles.sampling_pattern = PATTERNS[spec["pattern"]]


class SampleWatch:
    """The furthest sample a render reports while it draws, of how many, from Blender's own render statistics."""

    def __init__(self):
        self.reached = 0
        self.of = 0

    def __call__(self, *stats):
        for line in stats:
            for done, total in re.findall(r"Sample (\d+)/(\d+)", str(line or "")):
                if int(done) >= self.reached:
                    self.reached, self.of = int(done), int(total)

    def __enter__(self):
        bpy.app.handlers.render_stats.append(self)
        return self

    def __exit__(self, *_):
        if self in bpy.app.handlers.render_stats:
            bpy.app.handlers.render_stats.remove(self)


def denoise_text():
    """How a Cycles picture is denoised, and what its bright samples are clamped to, as a part of a sentence."""
    cycles = scene().cycles
    if cycles.use_denoising:
        said = (
            f"denoised by {'OpenImageDenoise' if cycles.denoiser == 'OPENIMAGEDENOISE' else cycles.denoiser.title()}"
            f" at {DENOISE_WORDS.get(cycles.denoising_quality, cycles.denoising_quality.lower())} quality"
            f" with {PREFILTER_WORDS.get(cycles.denoising_prefilter, cycles.denoising_prefilter.lower())}"
            f" from {PASSES_WORDS.get(cycles.denoising_input_passes, cycles.denoising_input_passes.lower())}"
        )
    else:
        said = "not denoised"
    clamps = [
        f"{name} light at {value:g}" for name, value in (("direct", cycles.sample_clamp_direct), ("indirect", cycles.sample_clamp_indirect)) if value > 0
    ]
    return said + (f"; samples clamped, {' and '.join(clamps)}" if clamps else "; no samples clamped")


def limit_text(counts, names_over):
    """
    How much of a picture took every sample, from the share of them each
    pixel took, with the objects most of it is on; nothing when every pixel
    is asked to take them all.
    """
    cycles = scene().cycles
    if counts is None or not cycles.use_adaptive_sampling:
        return ""
    all_taken = counts >= ALL_TAKEN
    share = float(all_taken.mean())
    where = names_over(all_taken) if share > 0 else []
    percent = f"{share * 100:.0f}" if share >= 0.1 else f"{share * 100:.2g}"
    return (
        f" {percent}% of its pixels took all {cycles.samples} samples, still over the noise threshold"
        + (f", most on {', '.join(where)}" if where else "")
        + ("; more samples or a higher threshold let them finish" if share >= 0.05 else "")
        + "."
    )


def sampling_text(watch, seconds, at_limit=""):
    """
    The sampling a Cycles picture was drawn with and what it spent, as a
    line; then how it was denoised and clamped, and `at_limit`, how much of it
    took every sample.
    """
    cycles = scene().cycles
    told = denoise_text()
    denoised = at_limit + f" It was {told}."
    pattern = next((k for k, v in PATTERNS.items() if v == cycles.sampling_pattern), cycles.sampling_pattern.lower())
    said = f"Sampling: up to {cycles.samples} samples"
    if cycles.use_adaptive_sampling:
        least = f"at least {cycles.adaptive_min_samples}" if cycles.adaptive_min_samples else "as few as Cycles chooses"
        said += f", each pixel stopping once its noise is under {cycles.adaptive_threshold:g}, after {least}"
    else:
        said += ", every pixel taking them all"
    said += f"; seed {cycles.seed}{' changing each frame' if cycles.use_animated_seed else ''}, the {pattern.replace('_', ' ')} pattern"
    if cycles.time_limit > 0:
        said += f", at most {cycles.time_limit:g} s"
    total = watch.of or cycles.samples
    reached = watch.reached
    if not reached:
        return said + "." + denoised
    if reached >= total:
        spent = f"it took all {total} in {seconds:.1f} s"
    elif cycles.time_limit > 0 and seconds >= cycles.time_limit * RAN_OUT:
        spent = f"the {cycles.time_limit:g} s time limit stopped it at sample {reached} of {total}"
    elif cycles.use_adaptive_sampling:
        spent = f"every pixel was under the noise threshold by sample {reached} of {total}, in {seconds:.1f} s"
    else:
        spent = f"it stopped at sample {reached} of {total}, in {seconds:.1f} s"
    return f"{said}: {spent}." + denoised
