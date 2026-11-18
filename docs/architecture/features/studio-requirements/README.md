# Studio requirements

## Purpose

The requirements file a design is measured against, in either studio: its
format, the kinds of requirement and their fields, sizes as ranges in
millimetres, and the verdicts an answer and the person's list of checks
give. The CAD studio measures it on exact solids and the 3D studio on
meshes, so one file means the same in both and a design keeps its checks
moving from one to the other. It is a pure package (ADR 0002): it reads text
it is handed and composes words, and does no I/O.

## Boundaries

- **Owns:** what a requirements file holds and why one is refused, the kinds
  and each one's fields, what a range means, how verdicts are worded, and
  what is kept of one check for the next.
- **Does not own:** finding and reading the file in the workspace, measuring
  anything, or where the kept checks are stored. Each studio does those: it
  says which kinds it measures, measures them in its own engine, and keeps
  each design's last check in its own folder.
- **Talks to other packages only through:** the interface below. It imports
  only the contract's types.

## Public interface

- `readRequirements(text, file, kinds, elsewhere?)` reads a file's text as
  its requirements, with what the design is when the file says, or answers
  why not, the reason starting with the file's name. Kinds in `elsewhere`
  are those another studio measures, read by their fields so one file
  serves a design in both studios. `requirementLimits` states the file's limits as a tool's description
  gives them; `largestFile` is the most bytes a file may hold.
- `requirementKinds` holds every kind a studio measures today: `size`,
  `fits`, `hole`, `clearance`, `separate`, `wall`, `overhang`, `draft`,
  `mass`, `insert`, `corner`, `ribs`, `bend`, `balance`, `undercut`, `void`,
  `smooth`, `stress` and `strain`, each with the fields it needs and may
  have, and the fields it needs together: a wall gives a least or a most
  thickness, a ratio or a band, a stress its load or torque and its
  material's figures, a smooth surface its curvature only at level G2. `kindsOf(names, own?)` is the set a studio
  measures: those it names, then kinds of its own, built with `fieldRules`.
- `sceneKinds` holds the kinds only the 3D studio measures, on a scene's
  meshes: `thickness`, `width`, `reach`, `rests_on`, `below`, `above`,
  `joined`, `inside`, `count`, `faces`, `in_view` and `separate_in_motion`.
  What `inside`'s `of` names may be one part, a pattern or a list, taken
  together, as walls and a floor. `separate_in_motion` holds its parts apart
  over the animation: its deepest overlap allowed in mm, its start and end in
  seconds, from 0 to 600 and the end after the start, and how many frames
  apart the frames measured are.
- `rangeMargin(measured, range, tolerance)` and `rangeWords(range)` are a
  range's margin and words.
- `checkedIn(value)` takes a harness's checked requirements, leaving out
  anything else. `verdictLines(verdicts, checked, says, last)` and
  `verdictDetail(...)` are the answer's lines and the person's list of
  checks; `keptOf(checked, says)` is what a studio keeps for the next check
  of the same design, and `lastOf(kept)` reads it back.

## Invariants

- **A review's brief judges by what was first written.** `reviewBrief`
  lists each requirement as first written in the conversation with its latest
  measure, or as removed since, then each one whose fields changed with what
  it reads now, then those added since with their measures.
- A file is `{ "requirements": [...] }` of 1 to 100 requirements, each with
  an id unique in the file, optional words (`says`) and a `check` of a kind
  the studio measures. A kind the studio does not measure, or no kind at
  all, is refused naming the kinds it does; a kind a studio defines of its
  own is read beside the shared ones, and one the studio names as another
  studio's is read too, held to its fields. The file may say what the
  design is in `object`, in words of at most 200 characters.
- A refusal names the requirement and the field, and says what the field
  takes: a field missing, a field the kind does not take (listing those it
  does), a value of the wrong form, or fields a kind needs together.
- A range is a number, which the measure must equal within the studio's
  precision, or `[least, most]`; its margin is the distance to the nearer
  end, below zero past it. A size of three ranges takes null for no limit
  along one.
- The answer says how many of the requirements checked hold and how many
  could not be checked; each holding with its measure and margin to spare,
  failing with its measure and how far past the limit, or not checked with
  why. A margin that moved since the last check of the same design says
  from what to what. A studio may have its answer count what holds without
  a line for each, and give those not checked for the same reason one line;
  the person's list still shows every requirement. A share, such as "% of
  the frame", is written against its number, as degrees are.
- A requirement that failed in the last check and is no longer in the file
  is named once, with how far past its limit it was, in the answer and
  under the person's list, so taking one out is never silent. The next
  check, kept without it, names it no more.
- A studio's heading and the check it compares with are its own: "Requirements
  in <file>" and "the last build" unless it gives others.
