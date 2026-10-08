# Built-in plugins

Zhiyin ships four plugins, each holding the skills, specialists and
connectors for one kind of work. Each is an ordinary Agent Plugins package,
the same format as a plugin a person makes, read by the same loader. On first
launch, Zhiyin asks what the person plans to use it for and enables the
plugins that match, and only those. Any plugin, or any part of one, can be
turned on or off later.

An enabled plugin costs a conversation little until it is used: the model
sees a short entry for it, with its name, its purpose and the names of what it
holds, and activates it when the work calls for it. Activation adds the
plugin's skills, specialists and connectors from that point in the
conversation, and a connector is reached only once its plugin is active
(ADR 0016). Requests keep a stable start that the provider caches, and
activation changes it once, in the request that follows: a cache miss that is
expected and intended (ADR 0012).

Each package holds three kinds of component:

- **Skills**: instructions the model loads into context when it needs them.
- **Specialists**: roles the model delegates a bounded task to, which report
  back in a structured handoff. A read-only specialist is offered only tools
  that read.
- **Connectors**: tools the plugin brings, either a remote MCP server or a
  part of Zhiyin itself, such as its browser.

Each plugin's manifest also says what it can reach and where its data goes,
and the app shows that with the plugin.

## Full-Stack Software Engineering

Skills: `frontend-design-systems`, `backend-api-patterns`,
`system-architecture`, `database-architecture-and-design`,
`test-driven-development`.

Specialists: `code-reviewer` (read-only), `interactive-debugger`,
`refactoring-architect`, `qa-e2e-verifier`.

Connectors: GitHub, which needs the person's own token; Zhiyin's browser; and
local Git, which reads history and can stage, commit, branch and stash, but
not push.

The browser and Git belong here rather than to the whole app. The browser is a
testing instrument, for driving a page and reading its console, and Git is
software work. Any conversation that needs either can activate this plugin,
and every other conversation keeps a shorter tool list. The workspace tools,
files and shell, are part of the app and available without a plugin.

## Technical & Academic Publishing

Skills: `latex-typst-authoring`, `whitepaper-structure`, `diagram-engineering`,
`bibliography-hygiene`.

Specialists: `peer-review-critic` (read-only), `citation-auditor`
(read-only).

Connectors: the document compiler, which builds Typst and LaTeX documents
with Typst and Tectonic, installed on request; and alphaXiv, for finding
research and reading papers' full text.

Reviewing a compiled PDF needs no extra connector: `read_document` draws PDF
pages for the model to look at.

## Data Science & Business Intelligence

Skills: `exploratory-data-analysis`, `sql-optimization`, `statistical-testing`,
`dashboard-design`.

Specialists: `data-cleansing-specialist`, `insights-synthesizer`.

Connector: the Python environment, a `uv`-managed environment for one-off
data work, with pandas, polars, NumPy, SciPy, Matplotlib, seaborn and
statsmodels. It is kept apart from the person's own projects, which keep their
own environments.

## Deep Research & Synthesis

Skills: `source-triangulation`, `competitive-analysis`, `neutrality-review`,
`knowledge-graph-mapping`.

Specialists: `fact-checker` (read-only), `report-synthesizer`.

Connector: Tavily, for web search and page extraction.

## What each connector needs

- **An account**: GitHub, Tavily and alphaXiv each take a key or token the
  person creates on the service and pastes in. The connector's settings link
  to the page where it is made.
- **A program**, downloaded on request and checked against a pinned SHA-256:
  Typst and Tectonic for the compiler, and `uv` for the Python environment,
  which then installs Python.
- **Nothing extra**: the browser uses Edge or Chrome, and Git uses the Git
  already installed. Each says so when its program is missing.
