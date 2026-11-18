# 0017. Capabilities are plugins found in one catalog; connectors are reached when used

Status: accepted

## Decision

### Plugins

- **Zhiyin is a general-purpose agent, and its capabilities arrive as
  plugins.** It is for people who want to use AI agents, whatever the work.
  Each plugin has one stated purpose and bundles the skills, specialists and
  connectors for one kind of work. Onboarding asks about interests and
  switches the built-in plugins on or off to match; it grants no access and
  signs in to nothing.
- **A plugin package is the only definition of a component.** Every skill,
  specialist and connector is declared by exactly one package in the portable
  Agent Plugins layout, and identified as `<plugin>/<component>`. Zhiyin's own
  additions sit where the format leaves room for them: specialists,
  application connectors and the stages of a plugin's work in the
  `com.zhiyin` extension, and a connector's read-only tools, what its tools
  do, and its setup page as fields of its server entry. Built-in plugins are
  ordinary package folders shipped with the app and read by the same loader.
  The Plugins page is the one place a person manages them.
- **A package is accepted whole or refused whole.** A path that leaves the
  package, a symbolic link, a duplicate id, a lifecycle hook, a UI app or a
  transport Zhiyin cannot run refuses the package. An imported package cannot
  take a built-in's name or another package's, and cannot name an application
  connector (the browser, git, the document compiler, the Python environment);
  only a built-in can. Only a built-in package may say what its connector's
  tools do, since that is Zhiyin's word about the service (ADR 0012).
  Installing and updating stage a complete version and journal the change,
  and the previous version is kept for rollback.
- **A person's edits never change what a package ships.** A built-in or
  imported component is edited as an override, which reset removes and which
  survives an update, noting when the shipped content changed. A plugin made
  in the app is edited as a whole and saved as a new version each time.
  Choices about a removed component are forgotten, its connector's
  credential included.
- **The model is told of the built-in plugins the person switched off.** The
  plugin directory lists every built-in plugin, enabled or not. One the person
  switched off, on the Plugins page or by not choosing it when they started, is
  marked `switchedOff`, with its name, purpose and contents as for any other,
  and the instructions say the person can switch it on in Plugins. A
  switched-off plugin is never activated, and its catalog entries are never
  offered: opening one refuses with that one reason. The model is given
  nothing of it to load or call: no skill, specialist, connector or
  connection. A plugin the person made or imported and switched off is not
  listed; it is their own, and they know of it.

### One catalog, toolkits and core tools

- **One catalog holds what an enabled plugin brings.** Its toolkits, skills,
  library functions, reference pages and known API changes are entries, each
  with an id of the form `kind:path`, a title and one line. The model searches
  it with `find(query, kind?)`, which ranks entries offline by their names,
  descriptions and parameters and returns the best five, and reads one whole
  with `open(id)`. Nothing is fetched to search.
- **Opening activates.** Opening an entry of an enabled plugin activates that
  plugin for the conversation from then on, saved with it; opening a plugin's
  own id from the directory activates it and lists what it holds. The
  workspace tools (files, search, shell) are always there.
- **A plugin's core tools come with it; a toolkit loads when opened.** A
  toolkit groups at most ten tools of one plugin for one kind of work. A tool
  no toolkit names is a core tool, in the request from the moment its plugin
  is active. A studio's cores are what any work in it uses: the 3D studio's
  scene, description, script and render tools; the CAD studio's build and
  drawing tools. A plugin of ten tools or fewer is all core. A call to a
  toolkit's tool before the toolkit is opened is refused, naming the toolkit.
- **An opened toolkit reaches each lab the way that lab keeps its cache.**
  - Natively where the lab loads tools mid-conversation without changing the
    start of the request: Anthropic (tools added inline in the conversation),
    OpenAI from GPT-5.4 (client tool search), and Moonshot's Kimi K3 and
    K3.1 Pro (a system message carrying tools, appended).
  - Elsewhere by a bridge: `open` answers with the toolkit's schemas as text,
    and `call(name, arguments)`, one tool whose own schema never changes, runs
    an opened tool through the same argument check (ADR 0009), inspection,
    approval and card as a direct call.
  - Behind one switch, the opened tools can instead be added at the end of the
    tool list, for a lab where the bridge proves worse.

  When the route changes, as when the person chooses another model, the model
  is told once what is open and how to call it now.
- **The start of the request changes on activation only by the plugin's core
  tools** (ADR 0016). The plugin directory lists every enabled plugin with its
  skills and their descriptions, and no activated flag; every enabled
  specialist can be delegated to; no system line depends on which plugins are
  active.

### Connectors

- **Connectors are remote MCP servers over Streamable HTTP.** A connector
  authenticates with a key the person pastes or with the service's own sign-in
  (below); either is kept in Credential Manager (ADR 0025). A connector is
  reached only when something needs it: a conversation that activated its
  plugin, a check the person asks for, or a new credential. Looking at the
  list reaches nothing, and a connector nothing has reached is shown as not
  checked.
- **A connector is untrusted.** Its calls are decided by the permission engine
  (ADR 0012): a connector Zhiyin does not ship declares nothing, so each of its
  tools asks unless the person said otherwise. A call carries its connection
  and the tool's own name, so a grant is recorded against the connection. A
  call that does not fit the tool's published schema is refused before
  approval (ADR 0009). A server that announces a changed tool list has its
  tools replaced, which changes their approval identity. A connection lost
  during a call is opened again on the next look, and the lost call is not
  repeated. A connection that could not be made is tried again after 30
  seconds; one whose key was refused waits for the person.
- **A program a connector needs is installed on request**, from a version and
  SHA-256 digest pinned in source, after saying what it downloads and from
  where (ADR 0027). A mismatch or an interrupted install leaves nothing usable.

### Signing in to a connector

- **A connector is signed in to only from its settings, by the person.** When
  a connector's service offers the MCP sign-in (OAuth 2.1 with PKCE, a
  protected-resource document naming where to sign in, and self-registration
  for apps), its settings offer a choice: sign in with an account, or paste an
  access token. A token is asked for only when the person chooses one. A
  connector made in the app is saved without a test, a sign-in or a token;
  once saved, it offers its sign-in, now or later.
- **The sign-in runs in the person's own browser.** The service's page opens
  there and returns to an address on this computer that Zhiyin listens on for
  that sign-in alone. The person can cancel while the browser is open; after
  five minutes the sign-in ends by itself. Nothing is kept until the service
  has issued tokens.
- **Nothing else signs in.** A conversation, a check, or switching a plugin on
  never opens a browser or registers Zhiyin with a service. A connector that
  is not signed in is treated like one with no key: none of its tools are
  offered to the model, and the connector says to sign in.
- **A sign-in is a credential like a key.** It is kept in Credential Manager,
  in pieces because one entry holds 1,280 characters, with the count written
  last so a half-written sign-in reads as none. It is never in a file, a
  server state or the window. When a key is also saved, the key is sent.
- **It is kept fresh without the person.** A token ending within a minute is
  refreshed before it is sent, and a token the service refuses is refreshed
  once and the request tried again; one refresh runs at a time per connector.
  When the service refuses the refresh, the sign-in ends: the tools are
  withdrawn and the connector asks to be signed in again. When the service
  cannot be reached, the sign-in is kept for later.
- **The service's pages are trusted only as far as their address shows.** A
  sign-in page that is not `https`, or plain `http` on this computer, is not
  opened. Failures are told in Zhiyin's own words; the service's error text is
  not shown.
- **Signing out forgets the sign-in on this computer.** It does not revoke it
  at the service, and the connector's settings do not claim it does.

## Why

People know what they want done. A plugin matches that: it bundles the
instructions, connectors and specialists for one kind of work, so it is found,
switched on and versioned as one thing. Two copies of a component, one in the
package and one in a separate store, would disagree after any failure.

Each application connection, such as the browser, Python and the document
compiler, belongs to one built-in plugin. A person who skips onboarding, or
chooses other cards, has those switched off; told nothing of them, the model
says it cannot reach the web though Zhiyin ships a browser, and nothing tells
the person which switch would give it one. Listed as switched off, the plugin
lets the model say what to turn on, while the person's choice still decides
what it may use.

A plugin that brought all its tools at once put the 3D studio's 19 tools,
about 75,000 characters or roughly 20,000 tokens of definitions, in every
request of every 3D conversation. Choice degrades as the list grows: a 7 to
85% accuracy drop from 49 to 741 tools (LongFuncEval), past 30 to 50 tools by
Anthropic's guidance, and GLM refuses more than 128. A searchable catalog
keeps the definitions small and still lets the model reach every capability.
Activation that changed the start of the request in five places made a later
activation on DeepSeek, Qwen or MiMo read nothing of the conversation from the
cache; with the directory and specialists fixed and toolkits loaded natively
or through the bridge, a load costs one round, not the conversation's cache. A
model that loads a studio uses its main tools, so those come with it.

Reaching a connector before anything needs it contacts a service nobody asked
for, and turns an unused connector's outage into an app problem.

Many people never make an API key, and some services offer only a sign-in.
Signing in from settings keeps the moment a browser opens under the person's
hand; a conversation that opened one would ask for consent in the middle of
unrelated work. The cost: a person visits settings once per connector, and a
service that accepts only apps registered in advance still needs a pasted key.

## Rejected

- Skills, specialists and connectors as separate top-level stores: asks
  people to understand agent internals first, and keeps two copies of every
  component.
- Forking a built-in plugin to edit it: an override with reset keeps the
  shipped content and the edit apart.
- Local (stdio) MCP servers: any local transport must first launch through
  containment (ADR 0005).
- Lifecycle hooks and plugin UI apps: valid in the portable format, refused
  until they have a reviewed trust model.
- Bundling every program in the installer: size for everyone, for components
  many never use. Looking only on `PATH`: most people would have to install
  the program themselves.
- Connecting every enabled connector at startup.
- Not switching any plugin off at onboarding, only ordering them: it keeps
  every connection in reach, but a person who said what they want would get
  everything regardless.
- Offering the browser as a connection of the app itself whenever Edge or
  Chrome is present: it fixes the browser alone; Python, the compiler and the
  3D studio would stay hidden the same way.
- Every tool from the start: the prompt cache study measured 9% more cost with
  94 tools before any growth, and it breaks GLM's limit.
- Smaller plugins only: the model picks plugins blind, and each late
  activation misses the cache on five labs.
- Adding loaded tools to the list on every lab: native calls everywhere, but
  each load misses the whole conversation on four labs. It stays as the
  switch's fallback.
- Scripts only, with no typed tools: typed tools carry approvals, cards and
  measured answers people read; they stay for common and risky steps.
- Separate tools to inspect a plugin, activate it and load a skill: the
  catalog's `find` and `open` do all three.
- Signing in when a conversation first uses a connector: a browser opening
  mid-task is consent nobody prepared for, and an unattended turn would wait.
- Registering Zhiyin with Google or Microsoft to reach their APIs directly:
  each requires the app's own registration, and Gmail's useful scopes need
  verification and a security assessment. Only a connector server that runs
  the standard sign-in itself is in scope.
- A client metadata document as Zhiyin's identity: it needs an `https` page
  that Zhiyin publishes and keeps, which it does not have.
- Showing the service's error text: it may carry anything.

## Assumptions

- People name interests more easily than they configure agents.
- The model can activate any enabled plugin by itself, so scoping an
  application connector to an enabled plugin hides it from no work. A
  connector of a switched-off built-in plugin is out of reach until the person
  switches it on, which the model can tell them to do, and does when the work
  needs it rather than trying to use it.
- The directory of built-in plugins stays short: five, each a few lines in the
  request.
- Agent Plugins stays the portable format; specialists remain a Zhiyin
  extension until a standard defines them.
- The pinned programs are published as versioned archives with stable digests.
- Checked on 6 November 2026 in each lab's documentation: Anthropic keeps
  deferred tools out of the cached prefix and expands a `tool_reference`
  inline, and its inline-tools beta can add a tool as it removes one; OpenAI's
  client tool search runs on GPT-5.4 and later in the Responses API; Moonshot
  documents tool-carrying system messages for Kimi K3 only.
- Measured live on the same day, as the stack reference records: each native
  form read the whole earlier start from the cache on the request after a
  load, and the model called the loaded tool. Kimi K3.1 Pro takes the system
  message as K3 does. Anthropic's inline addition is used: deferring every
  toolkit tool from the start makes every request's start larger.
- DeepSeek, Qwen, MiMo, GLM, MiniMax, Mistral and OpenRouter document no way
  to add a tool mid-conversation.
- Models search the catalog when told it holds what they need, and use the
  bridge's `call` well; the watched runs check both.
- A history that calls a tool no longer offered is accepted by every lab.
- The loopback redirect reaches Zhiyin. Where a firewall blocks it, the
  device-code flow would be needed, and MCP services do not commonly offer it.
- A cancelled sign-in may leave Zhiyin registered at the service as a public
  client with no secret. That registration grants nothing by itself.
- The service's own consent page says what is requested.
