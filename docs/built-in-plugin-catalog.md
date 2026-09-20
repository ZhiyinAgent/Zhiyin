# The built-in plugin catalog

The four verticals Zhiyin ships, and why each holds what it holds. The catalog
itself — every skill's instructions, every specialist, every connector — lives
with the plugins feature as ordinary Agent Plugins packages, and a named test
holds the shipped directory to this list. This document records the intent;
the packages are the content.

Decided by the owner on 2026-09-17, replacing an earlier placeholder set in
full, including the vertical names. Implemented the same day (ADR 0045).

Vocabulary: **Skills** (instructions loaded into context on demand),
**Specialists** (delegatable roles with a bounded task and a structured
handoff), **Connectors** (tool connections, whether to a remote MCP server or
to something the application itself provides).

## Full-Stack Software Engineering

Skills: `frontend-design-systems`, `backend-api-patterns`,
`system-architecture`, `database-architecture-and-design`,
`test-driven-development`.

Specialists: `code-reviewer`, `interactive-debugger`, `refactoring-architect`,
`qa-e2e-verifier`.

Connectors: GitHub (remote, needs the person's own token), the application's
browser, and local Git.

The browser and Git belong here rather than to the application at large. The
browser is a testing instrument — driving a page, reading its console — and Git
is only ever software work. A conversation that needs either can activate this
plugin, so scoping them costs nothing but keeps every other conversation's tool
list honest. This supersedes ADR 0042's statement that application tools belong
to no plugin; the always-available workspace tools (files, shell) stay outside
plugins.

## Technical & Academic Publishing

Skills: `latex-typst-authoring`, `whitepaper-structure`, `diagram-engineering`,
`bibliography-hygiene`.

Specialists: `peer-review-critic`, `citation-auditor`.

Connectors: the document compiler (Typst and Tectonic, installed on request),
and alphaXiv for research discovery and full text.

Rendering a compiled PDF for review needed nothing new: `read_file` already
renders PDF pages for the model to look at.

## Data Science & Business Intelligence

Skills: `exploratory-data-analysis`, `sql-optimization`, `statistical-testing`,
`dashboard-design`.

Specialists: `data-cleansing-specialist`, `insights-synthesizer`.

Connectors: the Python sandbox — a `uv`-managed environment for one-off work,
deliberately separate from a person's own projects, which keep their own
environments.

## Deep Research & Synthesis

Skills: `source-triangulation`, `competitive-analysis`, `neutrality-review`,
`knowledge-graph-mapping`.

Specialists: `fact-checker`, `report-synthesizer`.

Connectors: Tavily for web search and page extraction.

## What each connector needs

Three connectors need an account: GitHub, Tavily, and alphaXiv each take a
token the person creates and pastes. Three need a program, downloaded on
request against a pinned fingerprint: Typst and Tectonic for the compiler, and
`uv` for the Python sandbox. The browser and Git need only what is already on
the machine, and say so when it is missing.
