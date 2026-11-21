# Architecture overview

Zhiyin is an Electron app written in TypeScript. Its logic lives in
workspace packages, one per feature, each with its own tests and its own page
under [features](features/). The Electron processes around them hold wiring
and drawing only. This page is the map: the layers, the packages in each, and
the path one message takes. The words used here are defined in
[vocabulary.md](../vocabulary.md); the reasons are in the
[decision records](../decisions/).

## The processes

- **The window** (the renderer) draws everything a person sees. It runs
  sandboxed, imports only the contract and the pure packages, and builds its
  state from the events the core sends it, never by asking (ADR 0003). Its
  modules are described in [renderer](renderer/README.md).
- **The preload bridge** carries the window's commands to the main process
  and the core's events back. It holds nothing else.
- **The main process** is the composition root: it constructs every
  package's real implementation, hands each what it needs, and checks which
  window sent a command. It says which implementation a part uses, never what
  that part does.
- **Helper processes**: a contained process that draws documents, a thread
  that compares pictures, and the programs Zhiyin starts (shell commands, the
  browser, Python, Blender, the document compilers), each owned by a Windows
  Job Object that ends it with the app. A sealed-off shell command runs in
  Zhiyin's busybox-w32 in an app container of its conversation's; its `git`
  hands each git command over a pipe to the core, which runs the person's
  Git outside the container (ADR 0029).

## The layers

Every package is in one layer and imports only the layers below it
(ADR 0002). A package sits in the folder of its layer,
`packages/<layer>/<name>`, and that folder is how the lint configuration
(`eslint.config.js`) knows its layer (ADR 0002). Lint refuses any import the
layer does not allow, and a folder under `packages` that is not a layer
stops it.

```
core            the core: commands in, events out, the app's state
  │
loop            agent-loop: runs turns
  │
group           capabilities, rewind: features always used together
  │
feature         one concept each; never imports another feature
  │
platform        Windows and file-system mechanisms features share
  │
pure            computation without I/O, usable by every layer and the window
  │
contract        declarations only: types, commands, events, value sets

test helpers    beside the layers: only tests may import them
```

Rules that go with the layers:

- **A feature never imports another feature.** Where two features need the
  same rule, it moves down: into a pure package if it is computation, a
  platform package if it is a mechanism of the operating system.
- **Above the feature layer, only types are imported.** A group, the loop
  and the core receive real implementations from the composition root, so
  each can be tested with fakes.
- **Above the group layer, a group's members are reached through the
  group.** The core imports the browser and the 3D studio directly only for
  the panels a person drives themselves.
- **A package's entry point is its public interface**, listed on its feature
  page. Nothing reaches into another package's files.

## The packages

Every package is named `@zhiyin/<name>`, and its feature page says what it
owns, what it does not, and the invariants its tests hold. Each heading below
is a layer's folder, and lists every package in it; a repository test holds
the list to the folders.

**`packages/contract`**

- `contract`: every type, command and event the packages and the window
  share.

**`packages/pure`**

- `catalog-search`: ranking catalog entries for a query, and matching a
  script's error to a known API change.
- `context-budget`: how much a request to a model may carry, and the token
  estimate it is measured by.
- `conversation-rules`: the rules the core and the window both apply to what
  a conversation holds, such as whether a turn is under way.
- `credential-removal`: the credential formats removed from text before it
  leaves the computer or becomes evidence.
- `memory-projects`: which project a folder or conversation belongs to.
- `one-at-a-time`: work run one piece at a time in the order asked, alone or
  one line per key.
- `path-comparison`: whether two Windows paths name the same folder, or one
  lies inside the other, by their names alone.
- `studio-requirements`: the requirements file both studios measure a design
  against.
- `text-and-names`: texts cut to fit, and the portable names and file names
  made from what a person wrote.
- `text-diff`: line and word differences between two texts.
- `tool-input`: a call's input checked against the schema its tool offers,
  and what is wrong with it in words.
- `trust-rules`: whose word a tool call's declaration is, and where a
  connection may travel.
- `value-checks`: whether data from outside is a value a contract type
  names.
- `window-changes`: the window's copy of the app's state, built from the
  core's snapshot and numbered changes.

**`packages/platform`**

- `credential-store`: Windows Credential Manager.
- `file-kinds`: what a file is, from its bytes.
- `files`: replacing a file whole, so it is never read half written; the
  files a studio wrote, known by their content; and the Recycle Bin, with
  whether Windows would take a path.
- `pdf-engine`: loading pdf.js with the options every PDF is opened with.
- `picture-comparison`: how two pictures' pixels differ.
- `sandbox`: Job Objects, so every process Zhiyin starts ends with it, app
  containers that reach only the folders and hosts they are given, and the
  one way to run a program.
- `workspace-containment`: whether a path stays inside a conversation's
  folder.
- `workspace-listing`: the bundled ripgrep, for search and folder listings.

**`packages/feature`**

- `artifacts`: the files a task produced, for review.
- `blender-studio`: the 3D studio, a Blender per conversation.
- `cad-studio`: exact parts from build123d scripts, and their drawings.
- `conversation-export`: a conversation as a page or an ATIF trajectory.
- `corrections-log`: the corrections answered to the model alone.
- `document-compiler`: Typst and LaTeX to PDF.
- `document-viewer`: the PDF, picture or video shown beside a conversation.
- `git-connector`: Git as one typed tool per operation, and git run outside
  the container for a sealed-off shell.
- `interactive-browser`: the conversation's own headless browser.
- `mcp`: connections to MCP servers, remote and served by Zhiyin.
- `memory`: what Zhiyin keeps across conversations.
- `model-client`: one request to a model, streamed back as typed events,
  for every provider's wire format.
- `permission-engine`: whether an action may run without the person
  deciding.
- `plugins`: plugin packages and what a person switches on.
- `python-sandbox`: Python environments for data work.
- `recovery`: copies of what a change will overwrite, put back on request.
- `rewind-planner`: planning going back to an earlier message, or undoing a
  turn's file changes.
- `session`: conversations and choices on disk.
- `spelling`: spell checking and the text menu.
- `toolchains`: installing the programs connectors need.
- `tools`: the workspace tools and each conversation's folder.
- `updates`: Zhiyin updating itself from signed releases.
- `usage`: tokens and cost per request.
- `views`: charts and diagrams the window draws for the model.

**`packages/group`**

- `capabilities`: everything the model can call, as one set per
  conversation: workspace tools, plugins' skills, specialists and
  connectors, and the connections Zhiyin serves itself, such as the
  browser, Git, Python and the studios.
- `rewind`: going back and undoing, joining the rewind planner's plan to the
  file copies.

**`packages/loop`**

- `agent-loop`: runs a turn from the person's message to its end.

**`packages/core`**

- `core`: receives every command, holds the app's state outside a turn, and
  says every change to the window.

**`packages/test-helper`**

- `test-support`: folders that clean themselves up, waits on what the code
  under test does, and files held open as another program would.

## The path of one message

1. **The window** sends the person's message as a command through the
   preload bridge. The main process checks it came from the app's own
   window and passes it to the core.
2. **The core** checks the command's shape, saves the message through the
   session, and starts a turn in the agent loop. Every change it makes is
   sent to the window as an event, and the window redraws from those.
3. **The agent loop** builds the request. Its start stays the same from one
   request to the next, so the provider can serve it from its cache: the
   instructions, the folder's top-level listing, memory, the directory of
   plugins that are on, and the tools the capabilities group offers. The
   conversation follows, kept within its context budget (ADR 0016).
4. **The model client** sends the request to the provider the person chose
   and streams the answer back as text, reasoning and tool calls. Usage and
   cost are recorded.
5. **Each tool call** goes to the capabilities group, which names the
   member that owns it. That member inspects the call: what it is, what it
   touches, and its effects (ADR 0012).
6. **The permission engine** decides from those effects whether it runs
   without asking. When the person must decide, the loop waits, and the
   window shows the question.
7. **The member runs the call.** A change to the folder is backed up first
   by recovery; a program runs contained, its processes owned by a Job
   Object. The result goes back to the model as typed data.
8. **The loop repeats** from step 3 until the model has nothing left to do,
   then settles the turn. The conversation is saved as it goes, so a crash
   loses at most the save under way.

Specialists run the same loop as child runs in the background, under the same
permission decisions, and hand their report back to the turn that started
them.

## Where to go next

- [Adding a tool or a feature](adding.md).
- [Tooling](../tooling.md): the gate, lint and tests.
- [Testing philosophy](../testing-philosophy.md).
- [Security policy](../../.github/SECURITY.md): what each boundary covers.
