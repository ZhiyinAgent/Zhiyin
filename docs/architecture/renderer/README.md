# Renderer

## Purpose

The renderer is Zhiyin's window: a React app that shows the state the core
holds and sends what the person asks for back to it. It draws conversations,
the agent's actions and the decisions it waits on, the browser and documents
beside a conversation, diagrams and charts, and the app's pages. It decides
nothing about the work itself: the core runs turns, asks for permission, keeps
history and counts cost, and the window renders what the core says
([ADR 0003](../../decisions/0003-the-window-is-a-sandboxed-view-of-core-state.md)).

The window is written for people who want to use AI agents, so it favours plain
words, quiet surfaces and clear states. Tool and protocol names stay out of
ordinary text. What a technical reader needs in order to audit the work, such
as the exact command, the raw call or the data behind a chart, stays one fold
away, under Technical details.

## Boundaries

- **Owns:** presentation; the window's copy of core state, rebuilt from the
  core's events; which page is open; drafts in the composer and in forms; where
  a person is reading in a conversation; formatting of model text; the wording
  of everything on screen.
- **Does not own:** conversations, turns, permission decisions, model requests,
  files, history, usage figures or plugin data. A control calls a core command
  and shows the outcome the core reports; it never answers in the core's place.
- **Talks to other features only through:** the preload bridge, which exposes
  the contract's `CoreApi` and nothing else: typed commands, one stream of app
  events, and the view check. The renderer imports `@zhiyin/contract` and no
  other package, and no Electron or Node module.

## Structure

`App` subscribes to the core's events, keeps the window's state in a reducer
and renders `WorkspaceShell`, which decides what is on screen and composes the
modules. Before the workspace, the shell shows whichever applies: a
content-shaped placeholder while the core answers, a page for history saved by
a newer version, a recovery page when saved conversations cannot be opened, or
onboarding, which asks what the person wants to do and switches on the matching
built-in plugins. When the window cannot reach the core, it offers to
reconnect.

The workspace is laid out as:

- **A sidebar:** New task, Plugins, the recent conversations (each with a menu
  to rename, review permissions, export or delete), and a preferences menu
  leading to Usage, Model, Custom instructions and Settings. At 720 pixels wide
  or less it becomes a drawer behind a floating button.
- **A top bar** across every view, painted by the app under Windows' own window
  controls. Over a conversation it is the header: the folder, the title,
  commands still running, the Conversation/Workspace switch, and Files.
- **The conversation**, with the plan above it (ADR 0013) and the composer
  below. Pending approvals and most questions sit above the composer.
- **The space beside the conversation**, holding the agent's browser or a
  document, behind a divider the person can drag.
- **Pages** that take the conversation's place, one at a time.

The window has no application menu. Ctrl+N starts a new task and Ctrl+, opens
the model page.

Each folder under `ui` is one module. `app` is the shell and holds the window's
state. `conversation` draws the timeline, model text, composer, reasoning
control, context ring and plan; `rewind` editing and resending a message;
`user-input` quizzes and the other questions; `actions` approvals, action
history, change review, the files a turn changed and specialist runs; `views`
diagrams and charts; `commands` commands running as jobs; `artifacts` the files
a task produced. `workspace` is the split beside the conversation, holding
`browser` or `document`. `capabilities`, `model`, `usage`, `instructions` and
`settings` are the pages; `onboarding` and `recovery` come before the
workspace. `shared` holds neutral components every module may use; they are
described in the [component library](../../component-library.md).

## Public interface

- **From the core:** `CoreApi`, exposed by the preload bridge at
  `window[BRIDGE_KEY]`. Each command is one IPC channel from
  `COMMAND_CHANNELS`. A refusal arrives as an `Error` carrying the core's own
  message: the bridge removes the wrapping Electron adds. `onAppEvent` delivers
  the workspace and its changes. `onViewCheck` asks whether a diagram or chart
  can be drawn; the window answers with `answerViewCheck` after `validateView`.
- **The window's state:** the contract's `WindowCopy` turns events into a whole
  workspace or a whole conversation, and `workspaceReducer` holds the result as
  `WorkspaceState`.
- **`WorkspaceShell({ state, dispatch, commands })`** draws everything.
  `commands` is `WorkspaceCommands`, the part of `CoreApi` the window uses. Some
  of it is optional, and a control whose command is absent is not drawn. The
  composed demo renders the same shell with commands of its own.
- **From the main process:** a `restarted` query parameter after the window's
  page crashed and was reloaded; the theme chosen in Settings (Match Windows,
  Light or Dark), through `prefers-color-scheme`; and the top bar's height,
  shared with the title-bar overlay.

## Design principles

- **Every colour is a theme token**, defined for both the dark and the light
  theme. A colour that marks a state means one thing: the brand red is running
  work and the primary action, green is done, amber needs a look, the danger red
  failed, grey is inactive. No text is under 12 px, and every text colour
  reaches 4.5:1 on every ground of its theme. The gate's theme check enforces
  the tokens, the size and the contrast.
- **Every state is drawn.** Loading placeholders keep the shape of what they
  replace and never invent progress. Empty, denied, failed and interrupted
  states say what happened in plain words, a failure gives its reason, and a
  form that could not be sent stays filled in.
- **The keyboard reaches everything.** The focus ring shows for keyboard focus.
  Escape closes what is open and returns focus to what opened it; a dialog keeps
  focus inside itself. A control drawn as an icon alone is named on hover and
  keyboard focus, and one that cannot be used yet says what it is waiting for.
  What floats closes on a press outside it, top layer first; menus also close
  when the window loses focus, dialogs stay open.
- **The smallest window is 720 × 480**, and every page works there. Nothing is
  drawn or scrolls under the window controls. In a short window the composer
  gives way to a pending decision until it is answered. Animations and
  transitions shrink to an instant when Windows asks for reduced motion.

## Invariants

### State and commands

- The window's copy is the core's. It is built from one snapshot and the changes
  after it, in order; past a missing change it asks for that conversation whole,
  once. A message, action or view the core did not change keeps its identity,
  so only what changed is drawn again.
- Nothing is shown as done before the core says so. An approval or an answer
  carries the conversation id and the core's request id, and a second press
  while it is on its way does nothing. A deletion is confirmed by name once the
  core has deleted. A failed command shows the core's reason and leaves the
  control as it was.
- What is beside a conversation, and whether it shows, is the core's decision
  (ADR 0018). The person's choice goes to the core and appears when the core
  announces it.
- New task is a draft in the window. The conversation is created with its first
  message, on the context budget the window shows at that moment.
- A window reloaded after a crash says so once. Reports from the core show while
  they concern the open conversation or none; each can be dismissed and offers
  only actions that can change it.

### Conversation and composer

- The timeline places messages, actions, views, answered questions, specialist
  runs and compactions in the order they happened. Raw reasoning is not shown,
  and a message with nothing visible in it draws nothing. Entries off screen
  are skipped by layout and keep their height.
- Model text is rendered as Markdown with tables, never as raw HTML, revealed
  at a steady pace while it streams and whole once the turn stops. A link
  never navigates the window: a web address is shown as text, and a link to a
  document in the folder, with an optional `#page=N`, is a button that asks the
  core to show that page.
- A person reading the end of a conversation is kept at the end while it grows,
  until they move the view away with a wheel, a finger, a scroll key or the
  scrollbar. When the column changes width, the message being read stays put.
- A running turn says "Working", or what it is composing, and after five seconds
  for how long. A provider retry counts down to its deadline (ADR 0011). A
  stopped turn says why. A failed one gives its reason and offers the next steps
  the core suggests as buttons, such as trying again, updating the key, choosing
  another model or adding credits.
- The composer holds Send and Stop in one place. While a turn runs the field
  stays open: a message typed then is added to the current work, and Stop shows
  while the field is empty. The reasoning control, which offers only what the
  chosen model supports, and the context ring stay usable during a turn; the
  folder picker is locked. When tasks cannot run at all, every control is off
  and the composer says why.
- The context ring shows how much of the conversation's budget the last request
  used (ADR 0012). Its menu offers each budget with its real size, and Compact.
  A budget chosen in a conversation applies to it alone; one chosen before the
  first message becomes the default. A compaction is a card where it happened,
  and what the model knows only from its summary is dimmed and labelled. The
  code calls compacting condensing.
- A paste of 15,000 characters or more, and a message typed past 50,000, become
  a file the core keeps, shown as a chip. Pictures pasted, dropped or chosen are
  treated alike, up to eight a message; with a model that cannot see pictures,
  the attach button is off and says why.
- A message the person wrote can be edited where it is or sent again. Going back
  asks first only when it would remove a later message the person wrote, or
  work that may have changed something; files are put back only on request.

### Decisions and questions

- An approval reads in the order the decision is made: what the action is, what
  it can do (the app's own account, never the model's), what Zhiyin says it is
  for (attributed as a claim), then the exact command, the inputs, or the files
  it changes. A file change is reviewed as a difference, with line numbers and
  changed words marked. A long approval scrolls inside itself, so its buttons
  stay in view at the smallest window.
- Deny offers optional guidance for the agent once it is chosen. "Allow for this
  conversation" appears only when the core proposes a rule for the rest of the
  conversation, and says what that rule covers.
- A quiz lives in the conversation and grades an answer only once it is
  checked. Clarifying questions, the work checkpoint (Keep going, or Stop and
  summarise) and a folder's `AGENTS.md`, shown in full with Use and Ignore, sit
  above the composer.

### Actions, files and specialists

- Each action leads with why it was done, then what was done and on what. Its
  inspector shows what it did in the shapes the tool reported, with the exact
  call and result folded away.
- Once a turn that changed files has ended, a panel counts the files and lines,
  opens each file's difference, and offers Undo after showing what goes back
  and what stays. A file a command changed with no copy kept is listed by name,
  without Review or Undo. A PDF is compared by the words on its pages.
- A specialist's run is a card led by its task and latest call while it runs,
  and by the first line of its report once done; the report and every call open
  in a dialog. After a turn ends, the conversation names specialists still
  working. Commands running as jobs are counted in the header and open to their
  latest output, each with Stop (ADR 0007).

### Beside the conversation

- One surface shows at a time; with a browser and a document both open, a switch
  chooses between them and closes neither. The divider keeps the width the
  person chose for each layout, and a portrait document gets a narrower space.
- The browser panel shows the page as a picture the core captured and sends
  clicks and keys to the core in the page's coordinates; the app's own
  shortcuts stay with the app. The document panel shows pages the core drew as
  pictures (ADR 0018) and offers Open only for a type Windows may open; a PDF
  or picture a task produced opens there from Files. Nothing in the space can be
  dragged out of the window. While the space is put away, the conversation says
  what is in it and opens it from there.

### Diagrams and charts

- Diagrams are drawn by Mermaid in strict mode with SVG text labels, and the
  result is made inert before it is shown. A drawing uses the theme's colours,
  is drawn again when the theme changes, and repaints any label below 4.5:1 on
  the shape behind it. The page holds its animations off while a drawing is
  measured, so a diagram's shape does not depend on motion settings.
- Charts (line, bar, scatter, histogram and box plot) have a Data tab with their
  values as a table. A chart that cannot be drawn says what is wrong with it,
  and a kind the window does not know is named as unknown. Save image writes a
  copy that stands on its own outside the app.

### Pages

- The plugins page is the one place capabilities are managed (ADR 0016). Each
  plugin shows what it is for and what it can reach before its skills,
  specialists and connectors, each with one switch. A connector is reached by
  signing in or with an access token (ADR 0021).
- The model page lists only models that can use tools and saves the model and
  the upstreams chosen to serve it as one change. The API key is write-only:
  once saved it is never shown again.
- Settings holds the appearance, spelling (ADR 0023), notifications, the data
  folder (ADR 0019) and conversations from an earlier version waiting for an
  update (ADR 0022). Each row appears only when the core offers it, and a change
  that was not saved says so and leaves the control as it was.

### Security and boundaries

- The window runs sandboxed with no Node, cannot navigate, and loads only its
  own files and `data:` images; web and document pages reach it as pictures.
- Each folder under `ui` is a module used only through its `index.ts`. Of the
  renderer's own code a module imports only `shared`, never another module, the
  shell or the demo; the shell composes modules and passes one module's pieces
  into another. The lint rules read the folders, so a new folder is held to
  this from the start. The window and the main process never import each
  other's code.
- Each module's styles are one CSS Module named for it, and the global
  stylesheet holds only the theme, the reset and the shared basics. A module
  names no other module's classes; a parent that needs a child to look
  different passes it an option. A repository test enforces these rules.

## Testing notes

State and formatting are tested on plain data; component tests render
production components with Testing Library. Layout a DOM test cannot observe,
such as the smallest window, chart text and diagram geometry, is checked in a
real browser against the component lab, and the installed-app suite checks the
built window. Visual review happens in the component lab and the composed demo,
in both themes and at 720 × 480.
