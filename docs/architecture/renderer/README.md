# Renderer

## Purpose

The renderer is Zhiyin's window: a React app that shows the state the core
holds and sends what the person asks for back to it. It draws conversations,
the agent's actions and the decisions it waits on, the browser, documents and
3D scenes beside a conversation, diagrams and charts, and the app's pages. It decides
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
placeholder in the workspace's own frame (its sidebar, top bar and
conversation) while the core answers, a page for history saved by
a newer version, a recovery page when saved conversations cannot be opened, or
onboarding, which asks what the person wants to do and switches on the matching
built-in plugins. When the window cannot reach the core, it offers to
reconnect.

The workspace is laid out as:

- **A sidebar:** New task, Plugins, the recent conversations (each with a menu
  to rename, review permissions, export or delete), and a preferences menu
  leading to Usage, Model, Custom instructions and Settings. A rename the core
  refuses says why. Reviewing the permissions of a conversation not open yet
  has the core read it, without going to it, and the dialog follows once it
  is read; if it cannot be, the reason is shown, and if the person goes
  elsewhere first, the dialog does not appear. At
  720 pixels wide or less the sidebar becomes a drawer behind a floating
  button. While the drawer is open, Tab and Shift+Tab go round the button and
  the drawer, and Escape closes it with focus back on the button. Escape in
  one of the sidebar's menus closes only that menu, with focus back on the
  button that opened it. Opening a page puts focus on its heading.
- **A top bar** across every view, part of the page's ground, with Windows' own
  window controls drawn straight onto it. Over a conversation it is the header: the folder, the title,
  commands still running, the Conversation/Workspace switch, and Files. While
  a dialog covers the page, the window controls' symbols are dimmed as the
  page is.
- **The conversation**, with the plan above it (ADR 0018) and the composer
  below. Pending approvals and most questions sit above the composer.
- **The space beside the conversation**, holding the agent's browser, a
  document or a 3D scene, behind a divider the person can drag.
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
`browser`, `document` or `scene`. `capabilities`, `model`, `usage`, `instructions` and
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

- **One ground, drawn in ink.** The window stands on a warm, grained ground,
  darker toward the edges beside a conversation. Mountains rise along the foot
  of the conversation with mist drifting between them, water runs along the
  foot of the sidebar, and each page has far ranges at its foot and clouds
  behind its title. The pages shown before the workspace, and the window
  while it loads, stand on the conversation's ground. What is read lies on that ground; cards rest on it like
  paper, and what is typed in stays clean. Menus unroll from where they open,
  dialogs rise over a blurred page, and a page or a newly opened
  conversation settles into place. The slow motion holds still while the
  window is in the background.
- **Every colour is a theme token**, defined for both the dark and the light
  theme. A colour that marks a state means one thing: the brand red is running
  work, the primary action, a switch that is on and where you are, green is
  done, amber needs a look, the danger red
  failed, grey is inactive. No text is under 12 px, and every text colour
  reaches 4.5:1 on every ground of its theme, and the chart palette's colours
  3:1; a chart's numbered series are drawn in those colours. The gate's
  theme check enforces the tokens, the size and the contrast.
- **Every state is drawn.** Loading placeholders keep the shape of what they
  replace and never invent progress. Empty, denied, failed and interrupted
  states say what happened in plain words, a failure gives its reason, and a
  form that could not be sent stays filled in.
- **The keyboard reaches everything.** The focus ring shows for keyboard focus.
  Escape closes what is open, one dialog at a time, and returns focus to what
  opened it; a dialog keeps focus inside itself, Tab and Shift+Tab going round
  its own controls in the order it shows them, from a body that scrolls too,
  and focus stays where the person moved it while what is behind the dialog
  is drawn again. A control drawn as an icon alone is named on hover and
  keyboard focus, and one that cannot be used yet says what it is waiting for;
  a control whose name changes while it is named, such as one that opens and
  then closes something, is named anew.
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
  (ADR 0023). The person's choice goes to the core and appears when the core
  announces it.
- New task is a draft in the window. The conversation is created with its first
  message, on the context budget the window shows at that moment.
- A window reloaded after a crash says so once. Reports from the core show while
  they concern the open conversation or none; each can be dismissed and offers
  only actions that can change it.

### Conversation and composer

- Opening another conversation, its words settle into place once they have
  arrived, a line after another; the conversation shown first, and whatever
  arrives once one is open, appear as they are.
- The timeline places messages, actions, views, answered questions, specialist
  runs and compactions in the order they happened. Reasoning a model sends is
  shown only while it arrives, before the answer begins: its last lines, as
  plain text under the status, following the newest. Beside that status is the
  offer to have the answer now: it takes one press, and stands again when the
  core says nothing was stopped. Reasoning that is over is
  not shown, and a message with nothing visible in it draws nothing. Entries off screen
  are skipped by layout and keep their height. A person's message is drawn on
  the lines it was written on.
- A message added while a turn works is drawn at once at the end of the
  conversation, in outline where a read message is filled, and says it will be
  read at the next step. Under each is the offer to take it back, which returns
  it to the message box. Under the last, while the model only reasons, is the
  offer to send them all now. Once the model has read a message it is an
  ordinary one, drawn once.
- Model text is rendered as Markdown with tables, never as raw HTML, revealed
  at a steady pace while it streams and whole once the turn stops. While it
  streams, the blocks the answer has finished are read once, and each step
  reads again only what follows the last paragraph, heading, rule, table,
  quote or fenced code block that has two blocks after it. A step at the end
  of an answer of many such blocks costs about what one at its start did; a
  long list or indented code block, with what follows it up to the next of
  those, is read again at each step, and an answer that defines links or
  notes is read whole. At every point the answer looks as the same text does
  once finished, and finishing keeps what was drawn. A link
  never navigates the window: a web address is shown as text, once where the
  link's words are already the address, and a link to a
  document in the folder, with an optional `#page=N`, is a button that asks the
  core to show that page. A picture in model text is shown as its words: the
  window never fetches an address the model wrote.
- A person reading the end of a conversation is kept at the end while it grows,
  until they move the view away with a wheel, a finger, a scroll key or the
  scrollbar. When the column changes width, the message being read stays put.
- A running turn says "Working", that the model is thinking, or what it is
  composing, and after five seconds for how long, counted from when the core
  says the turn began: the time is the shown conversation's own and this
  turn's, and survives the window being opened again. A provider retry counts down to its deadline (ADR 0016). A
  stopped turn says why. A failed one gives its reason and offers the next steps
  the core suggests as buttons, such as trying again, updating the key, choosing
  another model or adding credits, which opens the billing page of the provider
  requests go to.
- The composer holds Send and Stop in one place. While a turn runs the field
  stays open: a message typed then is added to the current work, and Stop shows
  while the field is empty. The reasoning control, which offers only what the
  chosen model supports, shows and sends a saved effort the model does not
  offer as the model's default. It and the context ring stay usable during a
  turn; the folder picker is locked, and stays locked while a specialist or
  a command the conversation started still works. When tasks cannot run at all, every control is off
  and the composer says why.
- The context ring shows how much of the conversation's budget the last request
  used (ADR 0017). Its menu offers each budget with its real size, and Compact.
  A budget chosen in a conversation applies to it alone; one chosen before the
  first message becomes the default. A compaction is a card where it happened,
  and what the model knows only from its summary is dimmed and labelled entry
  by entry, with what that means said once before them and shown when reached
  from the keyboard. Compacting changes how an entry looks, never which
  element it is, so nothing is drawn again. The code calls compacting
  condensing.
- A paste of 15,000 characters or more, and a message typed past a tenth of
  the budget chosen (in estimated tokens), become a file the core
  keeps, shown as a chip; the composer says so before a long message is sent. A paste that holds text is text, even
  where the app it came from adds a picture of it, as Office apps do; only a
  paste with no text in it is taken as a picture. Pictures pasted, dropped or chosen are
  treated alike, up to eight a message; with a model that cannot see pictures,
  the attach button is off and says why. While the model's details cannot be
  looked up, pictures go to the core, which looks again and says if it still
  cannot tell.
- A message the person wrote can be edited where it is or sent again. Going back
  asks first only when it would remove a later message the person wrote, or
  work that may have changed something; files are put back only on request.

### Decisions and questions

- An approval reads in the order the decision is made: what the action is, what
  it can do (the app's own account, never the model's), what Zhiyin says it is
  for (everything a model wrote about it, under one attribution as a claim),
  then the exact command, the inputs, or the files
  it changes. The heading is the app's own words, never a model's. A file
  change is reviewed as a difference, with line numbers and changed words
  marked. When any file's change cannot be shown as a difference, such as a
  binary scene's or one too large to carry, the call's inputs are shown with
  the files; when none can, the tool's consequence sentence is shown too. A
  command a built-in tool marks as what runs is shown as the command, with its
  other inputs under it; nothing is laid out by a tool's name, so a connector
  tool called `bash` shows every input it is sent. Every input is shown whole,
  and a value an older record holds cut says how much is missing where it is
  missing. Inputs a built-in tool wrote in words read as text, not code. A
  long approval scrolls inside itself, so its buttons stay in view at the
  smallest window.
- A new approval takes focus, so the keyboard answers it, unless a message is
  being written or a dialog is open; either way a screen reader hears that
  permission is needed.
- What an approval, a change under review, a call's inputs, an action's
  record and its account, the files a turn changed, the work trace or a
  folder's `AGENTS.md` show from the model, a connector or a file writes out a
  character that draws nothing or changes the direction of the text as its
  code, such as `[U+202E]`, so it reads as what will run or be used. A file
  path is written out wherever it is drawn. Emoji keep their look.
- Deny offers optional guidance for the agent once it is chosen. "Allow for this
  conversation" appears only when the core proposes a rule for the rest of the
  conversation, and says what that rule covers. Choosing it asks once more,
  with the rule beside the buttons that answer, and focus moves to the
  question.
- A quiz lives in the conversation and grades an answer only once it is
  checked. Clarifying questions, the work checkpoint (Keep going, or Stop and
  summarise) and a folder's `AGENTS.md`, shown up to the most any
  conversation sends, with the line this conversation stops at and Use and
  Ignore, sit above the composer. However long the file, its text scrolls inside the
  question, so both answers stay in reach down to the smallest window.

### Actions, files and specialists

- Each action leads with why it was done, then what was done and on what. Its
  inspector shows what it did in the shapes the tool reported, with the exact
  call and result folded away; an input longer than 20,000 characters shows its
  start and opens whole on request. Files whose contents are not kept, such as
  a render, are named once each after what the action produced.
- Once a turn that changed files has ended, a panel counts the files and lines,
  opens each file's difference, and offers Undo after showing what goes back
  and what stays. A large file changed more than once in the turn says it
  cannot be shown as one change; each action shows its own. A file a command changed with no copy kept is listed by name,
  without Review or Undo. A PDF is compared by the words on its pages.
- A file's name is shown with every space it has.
- A specialist's run is a card led by its task and latest call while it runs,
  and by the first line of its report once done; the report and every call open
  in a dialog. After a turn ends, the conversation names specialists still
  working. Commands running as jobs are counted in the header and open to their
  latest output, each with Stop (ADR 0011).

### Beside the conversation

- One surface shows at a time; with more than one open, a switch chooses
  between them and closes none. The divider keeps the width the
  person chose for each layout, and a portrait document gets a narrower space.
- The browser panel shows the page as a picture the core captured, tells the
  core its size in the screen's pixels while it is in view, again when the
  window moves to a screen of another density, and that it is out of view
  once another conversation is shown or the conversation is shown alone. It
  sends clicks and keys to the core in the page's coordinates, keys with Shift as
  pressed and pasted text as text; the app's own shortcuts stay with the app,
  and F6 leaves the picture for the address. The document panel shows pages
  the core drew as pictures (ADR 0023) and offers Open only for a type Windows
  may open; a PDF or picture a task produced opens there from Files. A page
  that could not be drawn is asked for once more before it says so. The two
  pages after the one being read, in the direction the reader moves, are drawn
  ahead. The panel keeps about 64 MB of drawn pages, the nearest to the one
  being read, more only while more are in view, drawing the rest again when
  they come back. Nothing in the space can be dragged out of the
  window. While the space is put away, the conversation says what is in it and
  opens it from there.
- The 3D view shows the picture Blender drew of the scene, named after its
  file. Dragging or the arrow keys turn the overview, the wheel or plus and
  minus zoom it, and Home goes back to its first angle; a switch moves between the overview and
  the scene's camera. A zoom scales the picture on screen at once until Blender
  draws the closer one, and the last good picture stays until the next can be
  drawn whole. It says when Blender is starting or working, when the scene is
  empty or has no camera, and when Blender stopped, that the scene comes back.
- A PDF page fitted to the document panel's width holds still. The space the
  pages scroll in keeps a scrollbar's room whether or not one shows, so a page
  that almost fits the panel's height cannot bring a scrollbar that narrows it
  until it fits, and lose it again.
- A picture at Fit is seen whole: no wider or taller than the panel, never
  larger than its own pixels, in the middle of the panel's width.

### Diagrams and charts

- Diagrams are drawn by Mermaid in strict mode with SVG text labels, and the
  result is made inert before it is shown: no script, embedded page or HTML,
  no animation, no event handler and no link but to a part of the drawing
  itself. A drawing uses the theme's colours,
  is drawn again when the theme changes, and repaints any label below 4.5:1 on
  the shape behind it. The page holds its animations off while a drawing is
  measured, so a diagram's shape does not depend on motion settings.
- Charts (line, bar, scatter, histogram and box plot) have a Data tab with their
  values as a table. A chart that cannot be drawn says what is wrong with it,
  and a kind the window does not know is named as unknown. Save image writes a
  copy that stands on its own outside the app, in the colours the window
  shows, a label's repaint included.
- A line chart draws every series against one x axis: numbers placed by their
  value, ISO dates by their time, each series a line from earliest to latest,
  other values in an order that keeps each series' own, those no series
  orders against each other in the order first given, and a gap where a
  series has no point. Its Data tab lists the x values in that order. A bar
  measures from zero; the value axes of scatter plots, box plots and line
  charts span their data, labelled at round values, and a scatter plot's x
  axis runs from its lowest x to its highest, so data far from zero fills the
  plot. A box plot's Data tab gives its quartiles as worked out, unrounded.

### Pages

- The plugins page is the one place capabilities are managed (ADR 0020). Each
  plugin shows what it is for and what it can reach before its skills,
  specialists and connectors, each with one switch. A connector is reached by
  signing in or with an access token (ADR 0021). A program a connector needs
  shows how far its install has come and can be cancelled from the button that
  started it; focus stays in the connector's row as the install starts and
  ends. A new component named like one its plugin already has is refused in
  its form, saying which.
- The model page lists every provider by name, and one that cannot be used yet
  stays listed, unchosen, with the reason. The provider, its platform where
  the lab runs two, the model and, on OpenRouter, the upstreams chosen to serve
  it are saved as one change, and the page names the host the stored
  choice's requests go to. The provider and model lists are one Tab stop
  each, on the chosen entry; the arrow keys, Home and End move among the
  entries that can be chosen, and Enter or Space chooses, since choosing a
  provider loads its models. A provider's models are asked for once for each
  choice, however often the window is drawn meanwhile, so a list that is
  slow to arrive is still shown. Only models that can use tools are listed. Each
  provider and platform keeps its own API key, which is write-only: once saved
  it is never shown again. The chosen provider's platform and whether its key
  is saved, and where from, are shown above its models, with its platform's
  billing page once a key is saved. No balance is read: most labs give a key
  no way to read it, and every provider is shown alike. On a lab, the model
  chosen is detailed beside the list: its prices on that platform, in its
  currency, with busy hours, given in the person's own time, or a higher tier
  where the lab has them, and its context window. "Lower cost" keeps the
  models under USD 1, or CNY 7, per million input tokens, each price in its
  own currency and never converted. A search that finds nothing suggests
  searching after the slash only where the models' ids have one.
- The usage page names each conversation that cost something by its title,
  whether or not it has been opened since Zhiyin started, and opens it from
  there. Only a conversation that no longer exists is called deleted. A total,
  model or conversation none of whose requests was priced says "No price",
  never $0.00. The model dial gives up to four models a colour each; past
  four, the three most used keep theirs and the rest share one row.
- Settings holds the appearance, spelling (ADR 0030), when long tasks stop
  to ask (ADR 0018), notifications, the data folder (ADR 0027) and
  conversations from an earlier version waiting for an update (ADR 0028). A
  limit on long tasks is typed in and saved once left or entered; one outside
  its range says the range and is not saved, and Escape puts back the saved
  one. Each row appears only when the core offers it, and a change
  that was not saved says so and leaves the control as it was.

### Security and boundaries

- The window runs sandboxed with no Node and cannot navigate, open another
  window, change the base its links resolve against, run a script but its
  own, or be granted any permission a page can ask for. The installed window
  is served from an address of its own, which holds its built files and
  nothing else, so a file elsewhere on the computer or on a network share is
  not its own and does not load. Besides its own assets, it draws pictures
  only from `data:` addresses Zhiyin built from what it read itself; web and
  document pages reach it that way too.
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
built window. The document panel's fit is measured in a real browser on the
production panel, bundled with the application's stylesheets. Visual review
happens in the component lab and the composed demo, in both themes and at
720 × 480.
