---
status: open
effort: Medium
blocked-by:
---

# What a shell command does is established in code, not described by a model

## What

Classify a proposed shell command before anyone is asked to approve it:
which effects it has (reads, writes, deletes, reaches the network, elevates),
and which concrete paths or hosts it touches. Feed that into the approval
prompt, and into `inspectRunCommand` so an action carries a real label instead
of "Run a shell command".

It must fail closed. Shell is Turing-complete, and pipes, subshells,
substitutions and aliases make completeness impossible. An unrecognised
command is "unknown — assume it can do anything", never "probably fine". A
classifier that fails open is worse than none, because it manufactures
confidence a person will act on.

Cover both dialects the app actually meets: POSIX through Git Bash, and
PowerShell.

Use that classification to implement the permission-policy work that is not
present today: parsed command segments including pipes, redirection targets as
scope-checked writes, ambiguity that cannot become automatic, a hard-block tier
that wins over remembered rules, and denial for hard-blocked actions.

## Why

Nothing in the app knows what a shell command does. `inspectRunCommand` returns
the same action label for every command, and `GuardedPermissionEngine` decides
from a tool's declared access and scope — declarations about the tool, not
about the command it was handed. So the only account a person gets of a
proposed command is a sentence written by a language model.

Measured 2026-09-19 over 25 commands: a local 2B described
`sed -i.bak 's/judgementModel/reviewModel/g' $(git ls-files '*.ts')` — a
destructive in-place rewrite of every tracked TypeScript file — as "Measure
seam usage". The configured remote model described all 25 correctly, which is
what ADR 0047 relies on, but accuracy in a sample is not a guarantee. The app
is for non-technical people, for whom the raw command is opaque; the sentence
is the whole of their decision.

This is the project's own rule unapplied: code enforces invariants, models
provide quality. Whether a command destroys work is an invariant.

## Done when

A command's effects and targets come from code and appear in the approval
prompt, and a named test shows a destructive command labelled as destructive
whatever the auxiliary model says about it — including when that model
describes it as read-only.

Named permission tests also demonstrate hard-block precedence, separator and
pipe handling, ambiguous expansion, redirection scope, and a returned denial.

## Notes

- This also unblocks reconsidering a bundled local model (ADR 0047). With the
  facts established, writing the sentence stops being comprehension and becomes
  phrasing, which is what the small models could already do.
- A stratified corpus of 25 commands across families, composition operators and
  both dialects was built for the local-model comparison and is a reasonable
  starting test set; it is not in the repository, but its shape is described
  here: file operations, git, package managers, build and test, process and
  service, network, text processing, archive, system info — each at plain,
  piped, and redirected-or-chained complexity.
- Consider whether the permission engine should use the classification too. A
  read-only `ls` inside the workspace currently asks like everything else.
