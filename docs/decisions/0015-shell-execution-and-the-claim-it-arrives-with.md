# 0015. Shell execution, its teardown, and the claim it arrives with

Status: accepted

## Context

The owner asked for a shell tool. Two open tasks stood in front of it.
`teardown-test` required a chosen subprocess-ownership mechanism, validated with
real Windows process tests, before any tool that launches processes.
`permission-corpus` wanted an adversarial corpus before permission policy
widened. Neither was done. This decision records that the tool was built anyway,
what was done to satisfy the first gate, and what remains unsatisfied.

A shell tool is also the first action whose effect cannot be read off its
arguments. `read_text_file({"path":"notes.md"})` says what it will do.
`bash -c "make -j8 && ./deploy.sh"` does not, to the person who most needs to
know. Every other tool can describe itself; this one cannot.

## Decision

Zhiyin runs one bash command per action, in the workspace folder, always
requiring approval under the current policy.

**Teardown.** A command that starts a server, a watcher, or a build leaves
descendants, and signalling the shell alone orphans them. Stopping a command
means stopping the tree, through `taskkill /T`, which is the mechanism Windows
actually provides. A real test starts a detached grandchild through the shell,
records its operating-system process id, stops the command, and confirms the
grandchild is gone. This is what `teardown-test` asked for, for this one shape
of process tree. It is evidence, not proof: it says nothing about a process that
re-parents itself, is registered as a service, or is designed to outlive its
creator.

**The claim.** The model must supply, as a required argument, one plain sentence
saying what the command does — written for someone who does not read shell
syntax. That sentence travels as `claim` and never as `detail`. The distinction
is the whole point: `detail` is what the feature that owns the action knows to
be true, and for this tool it is the same every time — this runs here, it can
read, change or delete files, reach the network, and start programs, and it
cannot be undone. `claim` is what Zhiyin says this particular command is for,
unverified, shown as a claim and labelled as one. ADR 0012 forbids generated
explanation from replacing authoritative effect details; carrying them in one
field would have done exactly that. The command itself remains the only
authority on what will run.

The claim is also given to the auxiliary model that names actions, which
otherwise has nothing but an opaque command to write a title from.

**A shell that is absent is a capability that does not exist.** Bash is resolved
when the registry is built, and when nothing is found the tool is not advertised
to the model at all.

**A non-zero exit is a failure that keeps its evidence.** A tool result may now
carry an observation alongside its reason, so reporting honestly that a command
failed does not mean throwing away the output that says why.

Assumptions: the person approving has the judgement to read a command with its
claim beside it; Git for Windows is where bash comes from on this platform;
output is worth bounding rather than streaming, for now.

## Consequences

The agent can build, test, and use version control — the coding evaluation case
is not reachable without it. This is also, by a wide margin, the most dangerous
thing Zhiyin can do, and the honest summary is that its safety currently rests
on one mechanism: a person reads the command and decides.

What remains unsatisfied. `permission-corpus` is now overdue rather than merely
open: the corpus was wanted before policy widened, and policy has widened. Until
it exists there is no adversarial evidence that approval cannot be replayed,
confused by a claim that misdescribes its command, or worked around by a
command that rewrites what a later action will read. The current policy asks for
everything, which is the only reason this is tolerable; any move toward remembered
or scoped permissions must wait for that corpus.

`teardown-test` stays open. One passing case is not the contract it asks for,
and stdio MCP servers and spawned browsers still need their own evidence.

A claim is model-written text shown at a security boundary. It is labelled,
styled as subordinate to the command, and never merged into the authoritative
sentence — but a sufficiently plausible false claim beside a command a person
does not read carefully is a real attack, and nothing here prevents it.

Output is held in memory and bounded when reported, so a command that produces
gigabytes is stopped by its timeout rather than by backpressure. Interactive
commands are not supported: stdin is closed, so anything that prompts will hang
until its timeout.
