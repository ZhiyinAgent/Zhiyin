# Picture comparison

## Purpose

How two pictures' pixels differ, and the sheet that shows it. The pixels come
already drawn; this brings the two to one size, measures what differs, and
draws and encodes the sheet, on a thread of its own so a comparison never
holds up the core. It is a platform package because the comparing thread runs
it and nothing else, which a feature's files cannot offer (ADR 0002).

## Boundaries

- **Owns:** resampling a drawn part to the size compared at; the measurement
  (SSIM of lightness, OKLab distance, the areas that differ, each picture's
  average light, colour and chroma, a move or a zoom); the comparison sheet
  and its PNG
  encoding; and the threads comparisons run on.
- **Does not own:** reading or decoding a picture or a PDF, which happens in
  the contained drawing process (ADR 0019); what a call may compare, or how
  a comparison is said to the model, which are the `compare_pictures` tool's;
  starting a thread, which the composition root does.
- **Talks to other features only through:** the interface below. It imports
  nothing from the workspace but the contract.

## Public interface

- `PixelComparer`: `compare(first, second, size, signal?)` takes two
  `DrawnPart`s (pixels and the part of them compared) and the `ComparedSize`,
  and answers a `Comparison` (what differs, with the sheet as a PNG),
  `"cancelled"` or `"failed"`.
- `comparedHere` compares in the calling thread, for tests and tools run on
  their own.
- `new ComparisonThreads({ start, idleMs? })` compares on threads `start`
  makes, and `serveComparisons(port)` is what such a thread runs. A
  `ComparisonThread` is a Node worker as the comparer speaks to it.
- The types `Pixels`, `Difference`, `Averages` and `Rect`. `Averages` are
  plain averages over the whole compared picture, which say how far the
  light and the colour moved and not which edit moved them.

## Invariants

- A comparison on a thread answers as one in the calling thread does, the
  sheet included, and one thread answers comparison after comparison. The
  pixels handed in are left as they were.
- A comparison that is stopped ends its thread and is answered as cancelled;
  any other comparison that thread held goes to a new one and is answered.
- A thread that falls over answers its comparisons as failed. An answer from
  a thread that cannot be read ends that thread, and its comparisons are
  answered as failed. When no thread can start, a comparison is answered as
  failed.
- A thread with nothing to compare for a while ends; a minute unless told.

## Testing notes

- The threads that stop, fall over or answer what cannot be read are real
  Node workers.
- What a comparison finds is tested through the `compare_pictures` tool, on
  pictures with known changes, in the tools feature.
