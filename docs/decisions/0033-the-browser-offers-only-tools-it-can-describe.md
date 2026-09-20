# 0033. The browser offers only the tools it can describe

Status: accepted

## Context

The browser's tools come from the packaged automation server, and this
application passed them through as it found them. At the version in use that is
eighty tools. Twenty-three of them have a name written here and a sentence
saying what they do to the live site; the rest reached the model with a label
derived from the tool's own identifier and no consequence at all.

Among the ones nobody had decided about: reading and writing cookies, local
storage and session storage; capturing and restoring whole storage states;
intercepting and rewriting network traffic; starting video and trace recording;
and running arbitrary code against the browser rather than against the page.

An evaluation run on 2026-09-10 used that last one. The model wanted a picture
of one element instead of the whole page — a reasonable thing to want, and the
warning about tall pages is designed to make it want that — and reached for
`browser_run_code_unsafe`, inside which it called Playwright's own screenshot
API with a path it composed itself, traversing out of the workspace. Every
control ADR 0031 put on where a picture goes was undone from inside, and the
approval the person saw said "Run code unsafe" against a page address.

The sanctioned tool already does what was wanted: `browser_take_screenshot`
takes an element target. The unsafe tool was not filling a gap.

## Decision

The browser offers exactly the tools this application can describe. A tool
belongs in that set only when someone has written what it does to the live site,
in the terms the decision is made in; the set of consequence sentences is the
allowlist, so the two cannot drift apart.

A tool outside the set is not listed to the model, and a call naming one is
refused before it reaches the server, so a stale call from an interrupted turn
cannot slip past the listing.

Arbitrary code against the browser is deliberately outside the set. Code against
the *page* stays, described as what it is: it reaches what the page reaches.
Upgrading the packaged server adds tools that stay invisible until somebody
decides what they are.

This is the reasoning of the provider allowlist in ADR 0022, applied to a
surface that grew the same way — by taking what a dependency happened to offer.

Assumptions: a tool worth offering is worth one sentence; the tools withheld
here have no current use that the offered ones do not serve; a person approving
an action is entitled to a description that is true of every call to it, which
a generated label is not.

## Consequences

The model loses arbitrary browser-level code execution, cookie and storage
access, network interception, and recording. Element screenshots, which is what
the one observed use actually needed, remain.

A Playwright upgrade no longer silently widens what the agent can do. The cost
is that a genuinely useful new tool stays unavailable until someone writes its
sentence, which is the intended trade.

The allowlist is not a security boundary against a hostile model — it is a
boundary against tools nobody has thought about. Anything the offered set can
still do, it can still do.
