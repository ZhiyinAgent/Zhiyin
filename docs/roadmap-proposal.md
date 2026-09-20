# Product roadmap

Direction agreed with the owner, 2026-09-05. Milestones remain proposals;
completion requires the evidence below.

## Product

Zhiyin is a general-purpose desktop agent for nontechnical people. A person
describes an outcome, supplies relevant context, reviews consequential actions,
and receives a usable result. Technical users can inspect the evidence behind
the conversation. Open source is the destination.

The product should organize itself around work and results. Skills, connections,
and specialists belong in a manageable capability library. Onboarding asks what
the person plans to use Zhiyin for and suggests defaults without restricting
future work. Interests are preferences, not permission to access accounts or
send private data.

The earlier proposal to choose one product category is replaced by this explicit
general-purpose direction. Representative workflows still provide a practical
way to measure quality; they do not define the limits of the product.

## Interaction model

- Start with a request and optional files or a chosen folder. Simple questions
  should not require a plan, a workspace, or configuration of agent internals.
- Offer relevant capabilities when they help. Explain what connecting an account
  enables and what information an action will send.
- Show progress through meaningful outcomes. Keep raw execution details
  inspectable, with observed results separate from model assessments.
- Present deliverables where they can be reviewed, edited, exported, and reused.
- Make interruption, retries, partial success, and recovery understandable.
  Stopping a remote request does not guarantee that its effect was cancelled.

## Milestones

The next implementation milestone follows the [product-evaluation
protocol](product-evaluation.md). Begin with one complete artifact flow using
supplied inputs. Its creation, export, failure recovery, and authority belong in
that increment; they cannot wait for a later controlled-actions milestone.
Expand across the evaluation cases before declaring the broad alpha done.

Review on 2026-09-05 found the remaining directions useful, but several original
tasks described already implemented work. Their scopes now cover only residual
gaps. The [task index](../tasks/README.md) records priority separately from hard
dependencies. Authentication, browser execution, and delegation are not blanket
prerequisites for local artifact work.

| Stage | Outcome and exit evidence | Effort |
| --- | --- | --- |
| Dependable foundation | Cancellation, persistence, startup, workspace selection, approval binding, and truthful tool failures pass regressions plus installed-app recovery scenarios. Current changes address these mechanisms; complete application-level validation remains. | High |
| Useful general-purpose alpha | Representative writing, research, planning, data, and coding tasks produce reviewable artifacts. Nontechnical participants complete them without developer intervention. Track useful results, corrections, cost, and failure recovery against human-authored expectations. | High |
| Capability packages | Versioned manifests bundle instructions, tools, and optional specialists. Show provenance, required access, compatibility, and update history. Installation, disabling, rollback, and removal are tested. Authentication is separate from enabling a package. | High |
| Broader controlled actions | Extend the first artifact flow's authorization and recovery to existing-file edits and service effects. Add conflict detection, scoped authority, and checkpoints where possible. Partial and uncertain outcomes remain inspectable. | Complex |
| Sustained work | Context management, budgets, resumable work, and real specialist execution improve held-out outcomes against a single-agent baseline. Child operations inherit authority and terminate with their owner. | Complex |
| Open-source release | Choose a license, publish contributor and security policies, automate checks, verify clean Windows installation and upgrades, document data retention, and exercise release/update recovery. Packaging alone is insufficient release evidence. | High |

## Current implementation and limits

The implementation adds interest-based onboarding over the four shipped plugin
verticals, runtime skill loading, and a plugin directory in which every skill,
specialist, and connector belongs to a package a person can switch on, edit, or
replace. It also adds explicit folder selection and a redesigned workspace,
together with serialized stores, bounded execution evidence, approval route
checks, startup recovery, IPC validation, and cancellation regressions.

Models can now pause for one to three structured clarifying questions without
turning the answer into permission, and can produce durable multi-question
quizzes with single or multiple selections and deterministic scoring. Both use
exact core-owned request ids, survive as conversation records after submission,
and remain unfinished if the task is interrupted before an answer arrives.

It now also writes and runs commands. A file write, a multi-file edit, and a
bash command run as reviewed actions whose permission request states what will
change; the task records what it produced, that record survives a restart, and a
produced file can be read in the app and copied out. Editing tolerates Windows
line endings, byte-order marks, and re-indentation, and a proposal that cannot
be applied fails before anyone is asked to approve it, correcting itself without
reaching the transcript. ADRs 0013, 0014, and 0015 record the shapes. This is
the mechanism for the first artifact flow, not evidence that the flow is good:
the evaluation fixtures exist, but none has been reviewed and run in the
installed app.

It now browses. The browser is the application's own — headless Edge or Chrome,
started when someone asks for it, held inside a container that outlives no
crash, and shown beside the conversation so a person watches the session the
agent drives. A workspace preview serves static files over an authenticated
loopback endpoint, so building a page and looking at it does not require anyone
to start a server or invent a file address. Reasoning is visible and controlled
per conversation, a turn's tool-round budget renews or pauses with a report
rather than dying, conversations rewind in place, and the model and its
upstreams are chosen in settings. ADRs 0020 through 0031 record these shapes.

Pictures the agent produces are kept with the conversation, bounded like file
recovery, and fitted to the resolution a model actually reads; the model never
names a place on disk, and what the browser writes goes to one directory in
application data. ADR 0031 records why.

Subprocess ownership is structural now, not a promise: a Windows Job Object
whose handle loss terminates everything inside it, proved against real
processes in the normal gate including abrupt death of the owner, and in a
packaged build. Shell commands run inside it.

It now delegates. A specialist runs as a concurrent child of the turn that
started it, sharing that task's renewable budget and permission policy, and
outliving the turn when it has to — its handoff reaches whichever turn is live
to read it, or wakes one. ADRs 0043 and 0044 record the shape. That delegation
executes is not evidence that it helps: no held-out comparison against the
single-agent path has been run.

Bundled instructions still do not supply missing tools. A plugin package is
installed, updated, rolled back, and removed from a local folder a person
chooses; packages are not signed, and there is no marketplace. Interactive MCP
OAuth and project-suggested plugin import remain unfinished. Streamable HTTP
MCP connections support separately stored bearer credentials. File changes can
be rewound with bounded, durable preimages;
arbitrary shell and remote service effects remain outside that recovery
mechanism. Retained execution evidence has visible limits, common credential
redaction, exclusions, and independent deletion, but arbitrary document content
can still contain sensitive data.

Three evaluation cases with answers established before the run passed in the
installed app on 2026-09-10. Failure scenarios inside those cases and validation
by nontechnical participants remain the independent evidence required before
calling the broad alpha complete.

Keep the orchestrator focused on turn sequencing as the product expands.
Application management, onboarding policy, and evidence/context assembly are
candidates for separation when their interfaces can be exercised independently.
Do not replace one broad class with abstractions that merely move its code.

Open work is tracked as individual tasks. Architecture decisions record accepted
boundaries; this roadmap records sequencing and the evidence required to proceed.

Release work has two parts: licensing, contribution guidance, and gate automation
can begin now; installer and upgrade qualification follow usable product flows.
Advanced autonomy is not a prerequisite for publishing an honest, limited alpha.
