# 0024. Studio work is checked against version-exact knowledge and reviewed before a turn ends

Status: accepted

## Decision

### Version-exact knowledge

- **The reference is made on the person's computer, from the programs Zhiyin
  installed there.** The first time a studio's reference is needed after its
  program is installed or updated, Zhiyin reads the program's API by
  introspection, Blender's from that Blender and build123d's and
  bd_warehouse's from the CAD environment, and keeps it as catalog pages for
  that version (ADR 0017). Nothing of the programs' own text ships in
  Zhiyin's installer. A page names the version it was read from.
- **How-to knowledge is Zhiyin's own writing.** Techniques, stages and checks
  are skills and pages written for Zhiyin, not copies of the programs'
  manuals.
- **Long reference text leaves the tool definitions.** What a tool's
  description holds only for reference becomes a catalog page, so the
  definition says what the tool does, its inputs and its limits.
- **A known API change answers the error it causes.** Each studio keeps a
  table of changes between the versions models were trained on and the one
  Zhiyin runs: the error's pattern, the old form, the new one, and the
  entries to read. A failed script whose error matches is answered with the
  fix and the entries.
- **The coverage map is data, not a check.** The inventory of a program's
  features the plan was made from is kept outside the repository, and nothing
  in the gate compares it with the catalog.

### An unchecked change is named

- **A turn about to end with a change nothing checked is told so, once.** A
  file a turn changed is checked by a later call that runs, compiles,
  previews or measures the work, by a reading call that names it, or by its
  own answer when that shows the lines written. A tool says which of these it
  does in its own code. A turn that would end with a change nothing checked
  gets one `verify` notice naming the files, saying its answer is already
  shown and that it may end there if they need no check.

### Review by a specialist that did not build the work

- **Studio work with a spec is reviewed by a specialist that did not build
  it.** The 3D & Rendering plugin defines two read specialists, a scene
  reviewer and a part reviewer. When a turn that changed a scene or a part
  with a spec is about to end, Zhiyin starts the studio's reviewer on it,
  never the model, and never on a turn that changed nothing with a spec.
- **One reviewer run per studio a round.** Every piece of a studio's work
  that changed is reviewed in one run: each piece's brief under its name, the
  views of each in turn, one report. A CAD design built against several
  requirements files is one piece, each file's requirements listed.
- **The reviewer is handed what the studio measured, never the
  conversation.** Each studio writes the brief: the spec as first written in
  the conversation, each requirement removed or changed since, each one's
  latest measure, and the work as it stands (the scene described and its
  meshes counted, or the last build's answer). It comes with fresh views: the
  open scene from four sides in each of three shadings, or the part's drawing
  from four sides. The newest pictures the person attached come first, as the
  reference to compare with, under addresses its tools can open. The reviewer
  is promised views only when it is sent some: a scene that is not the open
  one is judged from its measures, and the task says so.
- **It reports each requirement as holds, fails or can't tell, with its
  evidence, then at most three fixes, and ends with a verdict line**,
  `Verdict: holds` or `Verdict: fix`. Its report reaches the model fenced as
  another model's words, in a notice that says which review of two it is. The
  person sees the run on the conversation.
- **The reviewer reasons at the least its model allows.**
- **At most two reviews a turn, the second only after a review that asked
  for fixes**: a report without `Verdict: holds`, or a run that did not
  report. Changed work after a review that found nothing to fix is not
  reviewed again, and the model is told so. The second notice asks the answer
  to name what still fails or could not be checked. A review cut off, as by
  the app closing, leaves its work to the next turn.
- **The person can turn reviews off** in Settings; they are on until then. A
  review's cost counts toward the conversation, as every specialist's does.
- **The reviewer runs on the conversation's model unless the person chose
  another for reviews** in Settings: any model on a provider Zhiyin reaches,
  chosen as the conversation's is, which leaves the conversation's model as it
  is. A review on it is sent the pictures that model can see, and is held to
  the conversation's budget in that model's window. When the chosen model
  cannot be reached, as when its provider has no key, the work is not
  reviewed and the person is told why, once there was work to review; it
  never falls back to the conversation's model unannounced.
- **On a model that cannot see pictures**, the reviewer is sent none, judges
  from the measures alone and says so, naming the setting where a model that
  sees pictures can be chosen.

## Why

Models write the Blender and build123d of their training, and the commonest
failures are API changes, such as a geometry-nodes input read by its old
index. A reference read from the installed program is exact for that version,
and an error answered with its fix saves the rounds a model spends guessing.
Blender's API text is GPL and its manual CC-BY-SA; Zhiyin is Apache-2.0.
Building the reference from the person's own program ships none of it, and
stays exact when the program is updated.

A model grades its own work kindly. In a car run it reported "7 of 7 hold"
after deleting the requirement that failed. The studios' checks measure sizes,
gaps and overlaps, but not whether a render reads as a car. A reviewer that
did not build the work, given the spec as first written, judges what the
builder no longer looks at. It is told nothing of the builder's reasoning, so
it cannot inherit it. Zhiyin starts it rather than the model, because the
model that would skip a check is the one that would skip asking for a review.

The verify notice covers work no studio measures. It judges nothing: it names
a change that nothing looked at again, which the turn's own record shows.

Reviews cost. On the first watched run (a print-in-place box on DeepSeek V4.1
Flash, at high reasoning, 2026-11-08), with three rounds and a reviewer per
requirements file and per scene, reviews took 126 requests, 85 model-minutes
and $0.46 against the main work's 142 requests, 40 minutes and $0.36, and the
main model waited about 50 of 100 minutes for rounds to finish. A part
reviewer wrote about 10,000 output tokens a request; two ran eleven minutes
each and ended without a report. The part review found a catch that would
have jammed in print, which the builder fixed, but the third round found
nothing new, and scene reviewers promised views that never came spent their
rounds looking for picture files. The reviewer judges measures and views
against a brief someone else wrote; the builder does the deliberating. A
second round checks that the fixes the first asked for were made; past it,
saying what still fails is worth more to the person than another try.

## Rejected

- Shipping generated reference in the installer: a licence review for the
  GPL text and a larger installer, and stale the day the program updates.
- Fetching documentation from the web when asked: online, slower, and not
  pinned to the version installed.
- A test comparing the inventory with the catalog: it would fail the gate on
  work planned, not on work broken.
- Verify notices alone: no extra cost, but the self-grading stays.
- The model deciding when to review: it is the one grading kindly.
- Handing the reviewer the builder's conversation: it would review the
  builder's account of the work, not the work.
- Reviewing after every change: the cost of a review per step, for work not
  yet meant to be finished.
- A review limit per conversation: a later turn's work is new work.
- Three review rounds a turn: the third cost a round's wait and found nothing.
  One round only: the second checks that the fixes were made.
- Parsing the report's prose for failures: a verdict line the reviewer is
  asked to write is easier to trust, and a missing one counts as a fix.

## Assumptions

- Introspection of Blender 5.2 and of the CAD environment yields signatures
  and docstrings enough to answer most API questions.
- The table of API changes stays short enough to keep by hand, and grows from
  errors seen in runs.
- The conversation's model, in a fresh context, judges well enough when it did
  not build the work. A model of another lab may share fewer blind spots,
  which is why one can be chosen.
- The views and the studio's measures carry what a reviewer needs; the
  reviewer can look closer with the studio's reading tools.
- The spec as first written is the one the person agreed to. A requirement
  the person themselves later removed is still listed, as removed, and the
  reviewer judges whether that matters.
- Picture tokens are the bulk of a review's cost, and two reviews per turn
  keep it bounded.
- A reviewer at the least reasoning still finds faults like the jamming catch.
  The next watched runs check this; if it misses them, reasoning goes back to
  the conversation's.
- A reviewer follows the instruction to end with a verdict line; one that does
  not is reviewed again as one asking for fixes, so the cost of a missing line
  is a round, never a skipped check.
