# 0047. Auxiliary work stays on the selected model

Status: accepted

## Context

ADR 0046 split auxiliary work into two named seams so that presentation could
be served from somewhere other than judgement. The obvious candidate was a
small model bundled with the app: it would remove a per-action cost that
follows whatever model a person selects, work offline, and keep the contents of
a person's work off a provider.

That was measured rather than assumed, over 2026-09-19, on a Ryzen 7 7800X3D
with an RTX 4070 Ti SUPER and the 2-CU Radeon iGPU inside that CPU. MiniCPM5-1B
and MiniCPM5-2B in Q4_K_M through node-llama-cpp 3.21.1, thinking disabled,
output constrained by a grammar built from the app's own tool schema, prompts
built through the app's own `actionContextLines`. The discrete GPU was treated
as a ceiling that says nothing about a person's machine; the weak iGPU and the
CPU path are the numbers that matter, and on this hardware they are the same
speed.

**What the measurements said.** Per action, median: the 1B about 3.4 s, the 2B
about 6.5 s, and the configured remote model — GLM 5.3 Flash through Z.AI —
about 4.7 s. Portability is not the obstacle: node-llama-cpp ships
per-microarchitecture CPU backends down to an x64 baseline and dispatches at
runtime, so the CPU path runs on any x64 Windows machine with no GPU, no
drivers and no Vulkan, and the shippable backend is 47 MB.

Speed was never the deciding factor. Quality was. Across 25 shell commands
chosen to cover families, composition and both dialects, the 2B misdescribed
four and wrote nothing useful for five more. One of the four matters more than
the rest: `sed -i.bak 's/judgementModel/reviewModel/g' $(git ls-files '*.ts')`
— a destructive in-place rewrite of every tracked TypeScript file — was
presented as "Measure seam usage", "check how widely the guidance seam is used
before renaming it". The remote model described the same command correctly, as
it did all 25.

The failure has one shape: the small model restates the surrounding task rather
than reading the command. Where the two agree it looks competent; where they
diverge it confabulates. That is a comprehension failure, and no model of this
size does shell semantics reliably, so changing which small model is chosen
re-rolls the same dice.

Two supporting results are recorded because they close doors:

- Speculative decoding does not rescue the 2B. A 1B draft costs about 43% of
  the target per token where the technique wants a tenth, and on a weak GPU
  both models contend. Measured, the draft path was 52% slower and node-
  llama-cpp reported "the pushed tokens are incompatible with the grammar
  evaluation state, the grammar will be ignored" 57 times. Input-lookup
  prediction was 20% slower, because these titles paraphrase the input rather
  than copy it.
- Q8_0 does not rescue the 1B. On CPU it repeats the Q4 failures; on Vulkan it
  emits whitespace, which is a backend defect for that quantization rather than
  a quality result.

**Assumptions this decision depends on** (revisit it if any changes):

- A person selecting a model accepts that auxiliary requests follow it.
- Connectivity is available: every auxiliary request needs the network, so
  presentation copy and the plan degrade to fallbacks offline.
- The action copy shown at approval is written by a model, and nothing in the
  codebase independently establishes what a shell command does.

## Decision

Auxiliary work is served by the selected model. The app bundles no local model,
and both seams from ADR 0046 point at the same client. The seams stay separate
because they describe different kinds of work, not because a local model is
coming.

The measurements above are the record. This is not reopened by a new small
model appearing; it is reopened by removing the reason the small models failed.

That reason is the important half of this decision. `inspectRunCommand` labels
every shell command "Run a shell command", and the permission engine decides
from a tool's declared access and scope, never from the command itself. So
nothing in the app establishes whether a command reads, writes, deletes, or
reaches the network — the only account a person gets is prose written by a
model. The remote model is accurate in the sample measured, but accuracy is not
a guarantee, and a mislabelled destructive command is an approval given under a
false description.

Classifying shell commands in code is therefore the work this decision points
at, and it comes before any local model is reconsidered. With the facts of a
command established deterministically, writing the sentence around them stops
being comprehension and becomes phrasing — which is what a small model can do,
and the point at which this ADR is worth revisiting.

## Consequences

- Auxiliary cost and latency follow a person's model selection, and every
  auxiliary request needs connectivity. Both are accepted for now.
- The installer carries no model weights and no inference backend.
- The safety of an approval prompt for a shell command rests on the model's
  description of it. That is a known gap, recorded here rather than left
  implicit, and it is the gap the classifier work closes.
- The benchmark harness is not kept. Re-deriving it is a day's work, and the
  numbers above are what a future decision needs, not the scripts.
- Work already done for this investigation stays because it was worth doing on
  its own: the grammar-shaped tool schemas, the length limits the schemas now
  declare, and the corrected attribution prompt were all found by measuring a
  local model and all fixed defects in the remote path.
