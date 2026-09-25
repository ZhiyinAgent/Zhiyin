# Renderer

## Purpose

The renderer presents backend-owned task state and carries user commands back across the
preload bridge. It includes conversation, work trace, permission, produced
files, quizzes, clarifying questions, context, provider settings, usage,
Skills/Subagents management, and MCP
connection surfaces, rewind, and reasoning controls, plus an
executable catalog of the same production React components and a scenario view
of the real workspace shell driven by fixtures. Model prose is
rendered as safe structured Markdown with GitHub-style tables; raw HTML is not
rendered.

## Boundaries

- **Owns:** presentation, local form drafts, selection of a visible management
  surface, content-shaped loading states, safe response formatting,
  conversation-tail following, task-plan presentation, durable action-history
  presentation, relative conversation timestamps, contextual conversation
  controls, and plain-language labels.
- **Does not own:** task lifecycle, permission decisions, provider calls,
  persistence, usage aggregation, or capability data. Production controls call
  the typed core API; they do not simulate backend success. The app shell
  requires those commands, so there is no path through it that answers for the
  core — typecheck holds that — and the demo supplies a stand-in core of its
  own, with its own store, rather than the window pretending for it.
- **Talks to other features only through:** the contract exposed by the preload
  bridge: one initial snapshot, subsequent events, and typed commands.

## Public interface

- A reducer reconstructs visible workspace state from a snapshot and later
  events.
- Production React components render that state and invoke typed core commands.
- Permission decisions return the exact task id and tool-call id through the
  preload bridge; the renderer never marks backend work approved locally.
- Quiz and clarification answers return the exact task id and core-owned request
  id. The renderer keeps the form editable when validation or transport fails.
- The component catalog imports those production components and supplies only
  representative fixtures and callbacks.

## Invariants

- **A refusal from the core reads as the core's own words.** Electron hands
  the window a command's error wrapped as "Error invoking remote method
  '<channel>': VisibleError: …"; the preload bridge takes that wrapping off,
  once, for every command. Named tests: `reads as the core's own words,
  without Electron's wrapping`, `keeps a message that spans lines whole` and
  `leaves an error Electron did not wrap as it is`.
- **A renderer module cannot grow into an unbounded component.** Production
  TypeScript and TSX files have the same 600-effective-line ceiling as other
  source layers. The two existing exceptions are pinned at their current size
  with no growth headroom until they are split. Named regression: `pins
  oversized package and renderer files at their current size with no growth
  headroom`.
- **Every reusable interactive surface can be reviewed without entering the
  application flow that reveals it.** The component catalog renders production
  components, including the main conversation timeline, empty conversation,
  component editor, and history-recovery gate; fixtures provide state but no
  copied UI. Named test: `renders every production component catalog entry`.

- **A diagram is the same diagram whatever a person's motion preference is.**
  Mermaid sizes a drawing by measuring its labels, and those labels measure
  about a pixel differently while decorative animations are running — enough for
  the layout engine to produce a materially different graph. A drawing therefore
  holds the page still while it is measured, using the declarations the
  reduced-motion rule already applies, and releases it when the last concurrent
  drawing finishes. Named test: `draws the same diagrams every time within one
  motion setting`, which asserts the two settings agree.
- Real-browser renderer regressions are discovered only by the serial
  system-boundary suite; they cannot also enter the ordinary DOM suite through
  a stale hand-maintained list.
- **The browser panel shows a page, or says why it cannot.** An open panel
  draws a decoded picture of the page in the proportions the frame arrived in,
  never stretched to fit its frame; opening and failed say what happened where
  the picture would have been, and draw no picture at all. The markup is this
  feature's, not the browser's. Named real-browser regression: `shows a page, or
  says why it cannot, in every browser panel state`.
- **The window keeps up while a model streams at length.** A long reasoning
  stream arrives in pieces and is drawn as it goes, and the thread that draws
  must not be held long enough for anybody to feel it. Measured in the installed
  application against a live provider rather than against a fixture, because a
  stream delivered as fast as a machine can manage is not the thing people were
  waiting on when this was reported. Named live check: `keeps the window
  responsive while the model reasons at length`, which needs a credential and is
  skipped without one.
- **What a turn is composing is shown even once it has done something.** A tool
  call arrives as a run of argument fragments, and the loop says what it is
  composing throughout; drawing that only for a turn with no plan and no actions
  means no session past its first round ever shows it. Measured in the installed
  application on 2026-09-14 before this held: eight views drawn across 150
  seconds and the note shown not once. Named tests: `shows what a turn is
  composing after it has already done something`, and the live check `says what
  it is composing, and keeps the window responsive while it does`.
- **The reasoning control is usable at the smallest window, by keyboard alone.**
  Its panel is portalled to the body and positioned by hand against the button
  it belongs to, so nothing in the surrounding layout keeps it on screen: at 720
  by 480 it has to sit inside every edge, and stay inside when the window
  changes size under it. Opening it puts the keyboard on the effort slider,
  whose stops read back as words rather than numbers, and Escape closes it and
  returns focus to the button that opened it. Named test: `opens and drives the
  reasoning control at the minimum window`.
- **Settings is usable at the smallest window, by keyboard, with motion
  reduced.** At 720 by 480 the page keeps everything inside the window, names a
  withdrawn model as still being the stored choice where a person can see it,
  and lets the keyboard reach a model to choose rather than skipping the list —
  under both motion settings. Measured against the page with a key stored, since
  without one it draws no list, no upstreams and no notice, and reviewing that
  state qualifies nothing. Named test: `qualifies the settings page at the
  minimum window, by keyboard and with motion reduced`.
- **A person's place in a conversation survives the window changing size.**
  Resizing reflows the whole thread, and replacing what was on screen with
  whatever lands at the same offset loses somebody's place in a long
  conversation. Measured against the composed workspace rather than a component,
  with the thread parked partway up so a thread pinned to its end cannot pass by
  accident. Named real-browser regression: `keeps a person's place in the
  conversation when the window is resized`.
- **A drawing is operable by keyboard and by pointer, and the focus ring belongs
  to the keyboard.** Zoom steps in round numbers a person can read back, the
  arrows move the drawing inside its frame, and dragging it with a pointer pans
  without leaving a keyboard ring drawn around it — a ring that returns the
  moment a key is pressed. None of this is establishable where there is no
  layout. Named real-browser regressions: `zooms and pans a diagram from the
  keyboard`, `pans a diagram by dragging, without taking the keyboard's focus
  ring`.
- **A long approval keeps its decision reachable.** At the smallest supported
  window a card may fit the window or scroll the part that made it long, but it
  may not grow past the window with nothing to scroll, which would put the
  decision out of reach. Named real-browser regression: `keeps a long approval's
  decision reachable at the minimum window`.

- **The app works at the smallest window it claims to support.** At 720 by 480
  everything on the top row shares one centre line, nothing escapes the sides,
  the conversation list scrolls to its end, and the preferences row - which is
  how settings and usage are reached - stays on screen however many
  conversations exist. Measured in the running app, because a DOM test renders
  at a size that is not a size. Named tests: `puts everything on the top row on
  the same centre line`, `lets the conversation list be scrolled to its end`,
  `keeps the preferences menu reachable however many conversations there are`,
  and `leaves nothing off the side of the window`. A surface page is drawn in
  the window rather than beside it - a surface still asking for a column that
  the narrow layout does not have is placed in an invented track past the
  right-hand edge - and the floating navigation button, which covers whatever is
  behind it, is cleared sideways by every surface and sits on the same row as the
  drawer's own name. Named tests: `draws the settings page inside the window
  rather than beside it`, `keeps the settings page from running off the side`,
  `puts the app's name beside the button that opened the drawer, not under it`,
  and `does not draw the floating button over the settings page's own heading`.
- **The window is the app's own, not a generic Electron one.** It carries the
  Zhiyin mark, and its menu names what a person does here - a new task, a
  folder, settings, usage, capabilities, quit - beside the editing shortcuts
  worth keeping from the default. Developer tools appear only where there is a
  developer. The menu drives the same core operations the window does and
  reaches the renderer's pages by asking for one as an event, rather than
  holding a second route into its state. Named tests: `offers Zhiyin's own menus
  rather than Electron's default bar`, `names what a person does here`, `opens
  the page a menu item names`, `carries its own mark rather than Electron's`,
  `does not put a way into the running renderer in a built app`, and `looks
  beside the package, not inside the built output`.


- **A privileged command is answered only for this app's own window, from its
  own top frame.** Validating a payload says nothing about who sent it, so the
  sender rule is checked separately and is exercised on its own: another
  window's contents and a frame inside the right window that is not its top
  frame are both refused, whatever the payload looks like. Named tests: `accepts
  the app's own window, from its own top frame`, `refuses another window's
  contents`, `refuses a frame inside the right window that is not its top
  frame`, and `refuses a sender that is missing altogether`.


- **Each renderer module owns a folder, is used only through its entry point,
  and never imports another module.** A module reaches shared presentation or
  the contract and nothing else; shared presentation never reaches back into a
  module or the app shell; the app shell composes modules. Every folder under
  the renderer's `ui` is a module the moment it exists — the rules read the
  folders rather than a list, because a hand-kept list went stale and left two
  modules unguarded. TypeScript has no private module boundary, so the lint
  rules stand where a compiler would, and imports that must fail establish that
  they catch violations rather than merely being present. Named tests: `rejects
  a module importing another module, even through its entry point`, `rejects a
  module importing another module by its folder name`, `rejects a module
  importing the app shell`, `rejects the app shell reaching past a module's
  entry point`, `rejects the renderer root reaching past a module's entry
  point`, `allows the app shell to use a module through its entry point`,
  `allows a module to use shared presentation through its entry point`,
  `rejects shared presentation depending on a module`, `holds every folder
  under ui to the module rule, including ones added later`, and `holds every
  folder of the renderer to the module entry points, including ones added
  later`. The window and the main process are also held apart, by `rejects the
  window importing main-process or bridge code` and `rejects the main process
  importing the window's own code`.
- **Shared presentation holds nothing with a feature in it.** A placeholder
  shape and a neutral list are shared; the loading state of a conversation
  belongs to the conversation and that of the whole workspace to the app shell,
  each with its own styles, so changing one of those layouts changes one owner.
- **Each renderer module owns its styles, and names no other module's.** A
  module's styles are a CSS Module beside its components, so its class names
  are private to it. Its stylesheet is named for the owning module, so one
  convention identifies the boundary rather than an individual component. The
  one global stylesheet holds the theme, the reset and the shared basics every
  module may use: buttons, text buttons, and the eyebrow and instrument labels.
  A module stylesheet names nothing else from outside
  itself, and a component writes no other class name as plain text. A parent
  that needs a child to look different passes it an option or styles its own
  element around it (ADR 0035). Named tests: `rejects a global stylesheet
  defining a module's class`, `allows a global stylesheet the theme, the reset
  and the shared basics`, `rejects a module stylesheet reaching another
  module's class`, `allows a module stylesheet its own classes and the shared
  basics`, `rejects a component writing a class name its module does not style`,
  `allows a component its module's styles, the shared basics, and states it
  compares against`, and `holds every renderer stylesheet and component to these
  rules`. A module stylesheet is also refused when it styles elements the
  module does not own, reaches out through a global selector written without
  parentheses, or pulls in another module's styles: `rejects a module
  stylesheet styling anything but its own elements`, `rejects a module
  stylesheet reaching out through a global selector without parentheses`,
  `rejects a module stylesheet pulling in another module's styles`, and
  `allows a module stylesheet its own elements, its animations and its media
  queries`. What the check cannot tell is whose markup sits inside a module's
  own element, so a rule below one of its own classes is its own business.
- **A shared frame owns the properties it sets.** A page that needs the frame
  to behave differently takes an option — whether it scrolls, how much room its
  heading gets — rather than setting the same property from its own stylesheet,
  where the winner would be whichever sheet loaded last. Named test, measured
  in a real browser with the stylesheets served in both orders: `keeps each
  page's own layout whichever order the stylesheets load in`.
- **A rewound conversation says what it dropped and what it restored.** Rewind
  is presented in the conversation itself rather than as a separate mode, so a
  person can see where the conversation was taken back to without leaving it.
  Named tests live with the rewind surface.
- The task header selects Conversation or a split Workspace. Messages and final
  answers stay visible alongside the browser. Completion offers a return rather
  than automatically withdrawing the page. Named regression: `keeps the
  conversation and final answer beside the browser with the selector in the header`.
- Approvals occupy only the conversation column and never resize the browser
  image. Named real-browser regression: `keeps the browser image fixed when an
  approval arrives in the split conversation`.
- The divider retains its position across updates and layout changes; the
  browser is not navigated by resizing. Named regression: `retains the
  user-selected divider position across updates and layout switches`.
- Closing preserves an inert last frame only for the exit transition. Failure
  remains explicit and offers a return. Named regressions: `retains the last
  frame only for the closing transition and disables its controls` and `offers
  a return after a browser failure without treating it as a completed task`.

- An approval names an action once. When its invocation has the same name,
  only meaningful inputs appear below it; the exact call stays inspectable.
  Named regressions: `shows a named action once without an empty input box and
  keeps its exact call inspectable` and `keeps named action inputs readable
  without repeating the approval title`.

- Captured browser frames decode under the production renderer security policy.
  Data images are allowed; inline scripts remain blocked. Named regression:
  `decodes a captured browser frame under the production security policy while
  blocking inline scripts` (real browser with the production component and HTML).

- Browser events offer the workspace selector independently of a context shelf. New
  frames update the page image; loading and failed states remain visible and
  closing withdraws the selector. Events name their owning conversation, so a
  late event cannot add the selector or browser notice to another conversation.
  Named regressions: `offers the browser workspace from core events and updates
  its live picture without a context shelf` and `does not show another
  conversation's browser after switching conversations`.

- Switching workspace layouts preserves the conversation draft and live browser
  session. Keyboard arrows, Home, and End select and focus the controls. Named regression:
  `switches between conversation and live browser without losing the draft or
  closing the session`. A shared approval stays mounted inside the conversation and
  submits the same task/request binding: `keeps one approval accessible in
  either workspace view`. Activity and Stop remain available while viewing the
  browser: `shows task activity and lets the user stop work from the browser
  workspace`.

- Live reasoning opens in a bounded scrolling region and remains inspectable
  after interruption. It shares the answer's mark rather than adding another
  working indicator. Named tests: `shows arriving reasoning and keeps an
  interrupted trace inspectable` and `shows one live reasoning mark and passes
  the selected effort to the core`.
- The composer submits the selected reasoning setting, offers only supported
  efforts, explains mandatory reasoning, and locks controls during a turn.
  Named tests: `sends the chosen reasoning setting with the message` and
  `explains mandatory reasoning and disables edits during a turn`.
- The effort slider orders the contract's closed effort universe, then shows
  only the efforts the selected model advertises.
- A light-bulb button opens a compact, ascending effort slider above the
  composer. Off is offered only when supported, and reset restores the model's
  default. Escape restores focus to the bulb; leaving the control dismisses it.
  Unavailable settings occupy one disabled icon. Named tests: `opens the effort
  slider from the bulb and dismisses with Escape or outside interaction`,
  `keeps unavailable controls compact and supports on/off without effort levels`,
  and `explains mandatory reasoning and disables edits during a turn`.
- **The context ring shows how much of the budget the conversation already
  uses.** Beside the reasoning control, it fills with the size the loop
  measured for the last request, instructions and tools included, as a share
  of the chosen budget's target for the model chosen now, so a model switch or
  a budget change shows at once. A new conversation reads 0%, and the message
  being written is not counted until it is sent. An unknown window is said.
  Its menu offers each budget at its real target, says a larger one costs more
  on every request, says when two give the same room on a small model, and
  warns when instructions and tools alone take too much. "What's using space"
  shows four parts in plain words — Setup, Summary when there is one,
  Conversation and Free — each explained in a tooltip on hover or focus, and
  says when the limit was lowered after the provider refused a request, and at
  what size. Named tests: `fills as the next request nears the budget, and the
  breakdown says in plain words what uses it, explained on hover or focus`,
  `says in the breakdown when the limit was lowered after the provider refused
  a request`, `offers Low, Medium and Ultra with their real targets on a 1M
  model, and says a larger one costs more`, `offers no Ultra below 300k, and
  shows Medium for a conversation set to Ultra`, `says why two budgets give
  the same room on a small model`, `starts a new conversation at 0%, and says
  so when the window is not known`, `draws no arc once a new conversation
  starts at 0%, however full the last one was`, `follows a model switch and a
  budget change`, `shows the context already used, not what the message being
  written would add`, and `says when instructions and tools alone take too
  much of the budget`. Its menu also offers "Compact" once a conversation
  exists, in words since an icon there read as closing the menu, says it is
  compacting until done, and says why when it could not. The person sees
  "compact" throughout; the code keeps the name condensing. The menu is drawn
  at the end of the page, so opening it takes focus to the chosen budget and
  Escape brings it back to the ring. Named tests: `is reachable by keyboard:
  opening it moves focus to the chosen budget, and Escape returns it`,
  `compacts on request, saying so until it is done` and `says why it could not
  compact, and offers nothing to compact before a conversation exists`.
- **Each condensing is a card where it happened.** Closed, one line says how
  many messages and actions were summarised and how far the request shrank;
  open, the summary is formatted text with the person's words as quotes,
  followed by what Zhiyin carried over and the files it read again. A failed
  condensing is the same card, saying why and when Zhiyin tries again, with
  nothing to open. One that followed the provider refusing the request as too
  long says so. "Nothing old enough to summarise" is shown only until the next
  message, since it is news only until the conversation moves on; a rewind
  past it removes it. Named tests: `says in one line what was condensed, and
  opens by keyboard to the summary as formatted text`, `counts one of each in
  the singular`, `says when it followed the provider refusing the request as
  too long`, `shows a failed condensing as the same card, with its reason and
  nothing to open`, `says where a condensing failed, and why, in plain words`,
  `says what a %s failure means` (for each reason), `says there is nothing old
  enough to compact only until the next message`, and `are kept from the core,
  so the conversation can show where each happened`.
- **What the model knows only from a summary stays readable, at less
  emphasis, and says so.** Messages up to the last one condensed sit in a
  group named as condensed earlier conversation, drawn in the secondary text
  colour, which meets contrast on its own, with a dashed rule beside it; hover
  or keyboard focus says the assistant works from the summary instead. A
  rewind that cuts through the condensed part removes its condensing, and the
  messages return to normal. Named tests: `dims what was condensed, up to the
  last message it covered, and says why`, `dims nothing when nothing is
  condensed, as after a rewind that cut through it`, and `say where the
  condensed part ends, and nothing once a rewind has cut through it`.
- **Each upstream is named by its provider and variant, and flex alone is
  warned about.** Two rows both called "OpenAI" cannot be told apart, so a row
  is named with its tier and region and says what the tier trades. A flex tier
  fails rather than falling back when busy, so choosing only flex rows shows a
  note until a standard one is chosen too. Named tests: `names each upstream by
  its provider and variant, and says what a tier trades` and `warns that flex
  alone fails when busy, until a standard upstream is chosen too`.
- **The budget is chosen in one place, the composer's ring.** Chosen in an
  open conversation, it is that conversation's alone and goes to the core at
  once. Chosen on the new-conversation screen, it becomes the default for new
  conversations. Each conversation is given the budget it starts on before its
  first message is sent, so a later default never changes it. Settings has no
  budget. Named tests: `shows how full the conversation is and sends a budget
  change to the core`, `changes only the open conversation when its budget is
  chosen, never the default`, `makes a budget chosen before the first message
  the default, and fixes it on the conversation that message starts`, `starts
  a new conversation on the default, fixed on it so a later default leaves it
  alone`, and `leaves the budget to the context ring: there is no budget
  here`.

- What a person was told when they allowed an action stays with the record of
  it having happened: what it would do, what it could reach, and what Zhiyin
  said it was for, still attributed as an unverified claim. Named test: `keeps
  what was agreed to with the record of what happened`.
- Work still going on is marked as neither a success nor a failure. It shared
  the accent ring with failed, denied and blocked, so a running command looked
  like a broken one. Named test: `keeps running, completed, failed, and denied
  actions in human-readable history`.
- Nothing in an inspection is said twice, and nothing that was only said once
  is dropped. Values are compared with whitespace normalised, because a target
  is a one-line rendering of something that may have spanned twelve. The target is shown unless a change or a detail already carries
  the same value, compared as content rather than by tool name — a shell
  command repeats itself, a skill's instructions never name the skill. The raw
  call and result appear only for a tool that described nothing at all, where
  they are the only record there is. Named tests: `puts a command's own output
  in front, not its call`, `keeps naming what was acted on when the answer does
  not`, and `falls back to the raw answer for a tool that described nothing`.
- An action is inspected as what it did, not as the call that did it. The
  difference a change made, the text a command printed, the places a search
  found something — each drawn as the shape the tool said its answer takes, and
  nothing here switching on a tool's name. The exact call and raw result stay
  reachable, folded away, for whoever is auditing rather than reading. Named
  tests: `shows the change an action made, as the difference it made`, `draws
  what a tool reported in the shapes the tool named`, `puts a command's own
  output in front, not its call`, and `offers no inspection for an action with
  nothing recorded about it`.
- A tool invocation is one card in every surface: its caption, tool identity,
  connection, and inputs share one contained structure and one internal spacing
  model. A surrounding permission request or inspector may position the card
  but does not restyle its contents. Named regression: `keeps its heading,
  identity, and inputs inside one card`.
- Descriptions supplied by a connected tool are attributed once per call, then
  placed beside their inputs without repeating the same source heading on every
  row. Named regression: `attributes the description to the connection rather
  than to Zhiyin`.
- A change to a file is reviewed as a difference, never as the call that would
  produce it. When the core carries before-and-after contents, the permission
  request offers them; when it carries none, no review is offered rather than
  an empty one; when a change was too large to carry, the panel says the
  approval is being given without a full picture. Named tests: `reviews a file
  change as a difference rather than as the call`, `offers no review when the
  action changes no files it can name`, and `says when a change is too large to
  show instead of showing an empty diff`.
- One turn draws one mark. A message with nothing visible in it draws nothing,
  so a turn that has opened but not yet said anything does not appear beside
  the status saying it is still working, and the answer replaces that status
  rather than joining it. Named test: `shows one mark while a turn is still
  finding its words, and one once it has`.
- Streaming text is paced, and a turn that stops is drawn whole. What has
  arrived is revealed at a steady rate rather than in the bursts it lands in,
  and the moment the turn stops running the remainder appears at once. Named
  tests: `reveals a burst of arriving text over several frames instead of at
  once` and `shows the whole answer the moment the turn stops running`.
- A diagram's text stays readable on whatever ground it lands on. The theme
  supplies one lettering colour; a diagram's author may fill any node or panel
  with anything, including something pale. After drawing, text that fails a
  4.5:1 contrast against the shape behind it is repainted with whichever
  lettering reads there, and text that already passes is left alone — a colour
  the author chose and got right is not overridden. Named tests: `darkens a
  label the author put on a pale panel`, `leaves a label that already reads on
  its own ground alone`, and `keeps a readable colour the author chose`.
- The ground behind a label is the nearest enclosing shape that actually paints
  something. A drawing carries collapsed backdrop rects behind its labels —
  filled, and zero by zero — and taking one of those for the background is how
  a pale panel comes to be treated as dark. Named tests: `uses the nearest box,
  not the panel behind it` and `ignores a zero-sized backdrop that paints
  nothing`.

- A view's footer exists only when it has something in it. A chart has no zoom
  and nothing to report until it is saved, so it ends at the chart rather than
  under a ruled-off bar of nothing; a save result still brings the footer back
  to say where the file went. Named tests: `ends a chart at the chart, with no
  empty bar beneath it` and `still has somewhere to report a save`.
- The keyboard focus ring appears for keyboard navigation and not for a mouse
  grab. Taking hold of a diagram to drag it focuses the region, and the browser
  reports that as focus-visible, so the ring is suppressed by how focus arrived
  rather than removed — the first key press brings it back, and so does tabbing
  in. Named tests: `marks a grabbed diagram as pointer-focused, and unmarks it
  at the first key` and `forgets a pointer grab once focus leaves, so tabbing
  back shows focus`.
- Zoom reaches the drawing, not just the readout, in both directions. A
  zoomable canvas lifts both the ceilings that held a diagram at its resting
  size when zooming in and the floors that held it there when zooming out, and
  the wheel, the buttons and the keyboard all drive the same control. A drawing
  smaller than its frame is centred in it rather than left against one corner,
  and one larger than its frame stays scrollable to its top-left. Named tests:
  `drives zoom from the wheel and the buttons as well as the keyboard` and
  `zooms out to a quarter and no further`. That the picture actually changes
  size is not established by those tests; it was measured in a browser — 592px
  wide at 100%, 2172px at 350%, 276px at 50%.
- Dragging a diagram pans it without starting native text selection. Named
  test: `pans a diagram without starting browser text selection`.
- Files a task produced live in a panel of their own, reachable at any point in
  the conversation rather than at the point they happened to be written, and
  closable with Escape. Named test: `keeps the files a task produced in a panel
  of their own, addressed by task`.

- A task occupies exactly one phase, and selection-dependent data is derived
  rather than duplicated. The named test `represents each task phase as one
  non-contradictory state` guards this.
- A reconnect reconstructs the same visible task from backend state. The named
  test `reconstructs the visible task from a core snapshot and later events`
  guards rehydration.
- Production task creation and messaging go through core-owned commands.
  Choosing New task creates only a renderer draft; the core task is created
  with the first non-empty message. The named tests `sends the first message
  through the core-owned task command` and `keeps New task ephemeral until the
  first message is sent` guard both entry paths.
- Skills, Subagents, MCP, Usage, and Settings navigation invokes its owning surface
  directly and carries no decorative status counts. The named test `keeps
  management navigation direct and free of decorative metadata` guards this.
- Work steps appear only in the main trace; the context shelf contains evidence
  or controls relevant to the selected task. The named test `keeps context
  concise and progress only in the work trace` guards this.
- When a task plan exists, it replaces the transient work trace in the composed
  view. A running action is visible in action history; the trace remains a
  fallback for older or degraded state without plan or action records.
- Each assistant explanation renders once at the point it was emitted. A
  settled action stays between the explanation that preceded it and the later
  interpretation of its result. A pending decision is rendered directly above
  the composer so it remains available without interrupting the transcript;
  the dock fades into the conversation without a separating rule. Ordinary
  answers have no completion banner, while a created artifact keeps its outcome
  card. The named tests `renders
  explanations and actions in chronological order`, `keeps the explanation in
  the turn and the decision beside the composer`, and `renders one structured
  Markdown answer without repeating its completion summary` guard these states.
- The task plan is distinct from temporary work activity and durable action
  history. It shows each criterion and never labels unresolved work as complete.
  The named test `shows criteria and live reviewer states without claiming
  unfinished work` guards the component states.
- Inspected tool actions appear when execution starts and remain visible after
  they settle. A completed action uses its success icon without repeating
  `Completed`; exceptional states retain their text labels. The named tests `keeps running, completed, failed, and denied
  actions in human-readable history` and `renders one structured Markdown
  answer without repeating its completion summary` guard the isolated and
  composed action-history views.
- Provider and tool protocol identifiers are not ordinary interface copy. A
  work trace is omitted when there are no concrete actions, and permission uses
  a task-specific title and description while retaining the inspected target.
  The named test `keeps the explanation in the turn and the decision beside the
  composer` guards the rendered boundary; the loop owns the source invariant.
- Streaming follows the latest content while the reader is already near it and
  stops following after the reader scrolls upward. The named test `follows
  streaming output only while the reader remains near the latest message`
  guards this.
- Loading placeholders preserve content shape and never invent task progress.
  The named test `uses content-shaped placeholders while the workspace loads`
  guards this.
- The initial response status uses the same 28-pixel row as the agent mark. Its
  production state is retained as the `thinking` composed-demo scenario so
  vertical alignment is part of normal visual review.
- Assistant prose uses the available response lane instead of an arbitrary
  character cap. Paragraph wrapping remains natural at the lane edge, while
  headings keep a shorter readable measure.
- The composer cannot start an overlapping turn while a task is already
  running. The named test `prevents the composer from starting an overlapping
  turn` guards this. Stop replaces Send in the composer while the response is
  running; the header carries no transient task control.
- **A paste of 15,000 characters or more never enters the message field.** It
  is taken on the paste event, kept by the core, and shown as a chip naming its
  file, size and line count, so a paste of any size never has to be laid out
  as text. The chip opens the text in the person's own editor and can be taken
  off; the pastes return with the words when a message could not be sent. A
  paste over 50 MB is refused with what to do instead. A sent message shows
  the same chips, opening that conversation's copy. Named tests: `keeps a long
  paste as an attachment rather than putting it in the field`, `never puts a
  10 MB paste in the field`, `leaves a short paste to the field`, `opens a kept
  paste, and can take it off the message`, `refuses a paste over 50 MB and says
  what to do instead`, `puts the pastes back with the words when a message
  could not be sent`, `sends a long paste by the name it was kept as, and opens
  it from the message after`. A rewind puts a message's pastes back in the
  composer with its words, to open or send again. Named test: `puts a rewound
  message's pastes back in the composer with its words, to open or send again`.
- **A message typed past 50,000 characters is sent as a file.** The field
  says so before it is sent; on sending, the words are kept as a paste is and
  go as its chip. If they cannot be kept, they stay in the field unsent, with
  the reason. Named tests: `sends a message typed past 50,000 characters as a
  file, and says so before it is sent` and `keeps a long typed message in the
  field when it cannot be kept as a file`.
- Conversation age is derived from persisted timestamps and refreshed while
  the app remains open. Legacy records without a timestamp use a neutral
  fallback instead of remaining `Now`. The named test `shows relative
  conversation age from timestamps instead of a frozen label` guards this.
- A conversation's context menu is anchored to its sidebar row but positioned
  in the viewport, so opening it never enlarges or clips inside the scrolling
  conversation list. Rename replaces the row with an input; Delete changes the
  same nearby menu into a compact confirmation rather than opening a centered
  dialog. The named tests `places a conversation menu above a low row without
  enlarging the list`, `renames a conversation in place from its context menu`,
  and `confirms deletion beside the conversation instead of opening a dialog`
  guard these interactions.
- Component switches cross the core boundary and are not retained as
  renderer-only state. The named test `sends component switches through the
  core instead of keeping them local` guards this. The named test `keeps a
  failed save editable without generic retry copy` guards the storage
  failure path.
- The Plugins panel is the only capability surface — there is no standalone
  Skills, Agents, or MCP screen to leave it for. Every skill, specialist, and
  connector belongs to a plugin and is grouped, labeled, switched, edited, and
  removed from that plugin's own detail panel, using the manifest's own
  vocabulary (Skills, Specialists, Connectors). A component's switch is shown
  exactly once, in its own row; readiness text belongs to connectors, which
  have a state beyond on and off. The named tests `groups a plugin's components
  and shows each component's switch exactly once` and `sends a component switch
  to the core by the component's full id` guard this.
- What a plugin is for is shown before its parts: what it can use, where its
  data goes, and the requests it is meant for. The named test `shows what a
  plugin is for, who publishes it, and what it can reach` guards this.
- How a plugin is managed follows who wrote it. A built-in offers no lifecycle
  actions at all; one imported from a folder can be updated, rolled back, and
  removed; one made in the app is removed but never updated from a folder. The
  named tests `offers no way to update or remove a built-in plugin`, `updates,
  rolls back, and removes an imported plugin`, and `removes a plugin made in
  the app, but never updates it from a folder` guard this, and `shows a failed
  update's reason on the page` keeps a refusal visible.
- Editing a component follows the same rule. A component of an app-made plugin
  opens the form that saves the plugin's whole content (`ComponentEditor`);
  a shipped or imported one opens the edit form (`OverrideEditor`), which keeps
  the plugin's own version readable and restorable and says when the plugin has
  since shipped something different. The named tests `opens a shipped skill for
  editing, and saves the edit as an edit of that component`, `marks an edited
  component, and says when the plugin ships a different version since`, and
  `edits a component of an app-made plugin as the plugin's whole updated
  content` guard the two paths.
- A connector its package declares is set up rather than edited: its address is
  shown, and what a person owns is the access token and which tools may be
  used (`ConnectorSettings`). The named tests `sets up a shipped connector's
  token without offering to change its address` and `lets a person remove a
  saved token and switch a connector's tools` guard this. A connector made in
  the app keeps the full form, whose save stays disabled until a test in the
  same session succeeds; its token is saved under the connector's full id,
  guarded by `saves a new connector's token under the connector's full id`.
- A connector that needs a program says what installing would download —
  which program, which version, how large, and from where — before anything is
  downloaded, and shows an installation in progress or a failure with its
  reason. The named tests `states what installing a connector's program
  downloads before doing it` and `shows an installation in progress and a
  failed one's reason` guard this.
- While a browser session exists, Conversation and Workspace share the main
  workspace, and the context shelf returns when the browser closes. The panel renders
  only backend-reported browser state and sends one intent per action. Named
  test: `shows the page and says whose browser it is`.
- Provider credentials are write-only. The named test `saves a write-only key
  without rendering it back` guards the form boundary; separate tests cover an
  environment-owned credential and removal. Stored credentials expose direct
  Replace and Remove actions without repeating storage-policy copy already
  represented by the field behavior.
- The files a task produced are shown as their own section of the thread, read
  from task state rather than parsed out of a tool result. Each one says whether
  the task created it or replaced something already there. The named tests
  `separates files it created from files it replaced` and `puts the files a task
  produced in the thread, addressed by task` guard the section and its command
  boundary. A task that produced nothing renders no section, guarded by `shows
  nothing until the task has produced a file`.
- A produced file that has moved, become unreadable, or is not text says so
  where it would have been shown. A shortened preview says it is shortened. A
  save that was cancelled or failed is never rendered as saved, and a second
  save cannot start while one is running. The named tests `explains a produced
  file that is no longer in the workspace`, `opens a produced file for review and
  says when it is shortened`, `reports a failed save instead of showing the copy
  as written`, `names where a copy was saved and stays quiet when the choice is
  cancelled`, and `does not start a second save while one is still running`
  guard these states.
- A permission request shows what the action will change, not only what it is
  called, whenever the acting feature supplies that sentence. Approving a write
  that replaces existing work must not look like approving one that creates a
  new file.
- What Zhiyin says an action is for is shown separately from what is known about
  it, and labelled as Zhiyin's own account. A command's authoritative
  description and the agent's unverified claim about it must never read as one
  statement.
- The permission card has no generic approval heading and keeps technical detail
  collapsed. The named test `returns the exact approval decision to the core`
  guards its command boundary. The named test `prevents
  duplicate decisions while the chosen response is pending` guards immediate
  feedback and duplicate-click suppression.
- Clarifying questions use native mutually exclusive choices and bounded text,
  remain visually distinct from permission, and submit one complete response.
  Selecting a choice adds its state without replacing the option-card layout.
  The named tests `answers several clarifying questions once`, `keeps a
  selected clarification choice inside its option card`, `keeps a selected
  clarification choice inside its option card in a real browser`, `keeps a
  failed answer editable`, and `returns the exact structured answer to the
  core` guard the form, layout, and bridge boundaries.
- A renewable-work checkpoint shows only the completed tool-round count and the
  Continue and Pause choices. Token, time, provider-cost, and ledger terminology
  stay out of this decision surface. The named test `offers an explicit
  continue or pause choice at a work checkpoint` guards this presentation.
- A quiz supports single and multiple selection across several questions,
  exposes no correct answer before submission, and leaves one scored result in
  the conversation afterwards. The named tests `submits one and many answers
  across a multi-question quiz` and `reveals quiz grading only after submission`
  guard the two states.
- Usage is rendered from real aggregate input with visual summaries and range
  changes. The named test `uses visual summaries and updates when the range
  changes` guards this.
- Private evidence is a local-data page, separate from ordinary conversation
  history. It shows correction provenance, retained and excluded recovery data,
  every retention ceiling, and the explicit limits of redaction. Correction and
  recovery deletion each require a second irreversible confirmation. Named test:
  `shows limits, exclusions, corrections, and explicit deletion`.
  The installed test `shows limits at minimum size and deletes corrections by
  keyboard with reduced motion` guards real narrow layout and keyboard behavior.
- The component lab renders production component catalog entries, never copied
  implementations. The named test `renders every production component catalog
  entry` guards registration.
- A control is rendered only when a real action is connected. Completed files
  without an opener are presented as created artifacts, not clickable buttons.
  The named test `does not present an artifact as clickable without an open
  action` guards the artifact state; component tests cover optional context and
  navigation actions.
- A delegated specialist's own run is a timeline entry in its own right, drawn
  with the same production components as the main task's history rather than
  a generic tool call: its status and task, its structured handoff once it
  finishes or its reason for stopping, and its own actions nested through the
  unmodified action history — never repeated in the main list. The named
  tests `draws a delegated specialist's run through its own piece, in
  sequence order` and the `SpecialistRunHistory` component tests guard this.

## Testing notes

Reducer tests use plain data for state invariants. DOM tests cover behavior a
user can observe or invoke, such as write-only secrets, permission decisions,
capability commands, loading hierarchy, and usage range changes. Visual review
in the component lab remains necessary for typography, spacing, overflow, and
narrow layouts; snapshots are not a substitute. The composed demo selects
named states from its preview URL so initial thinking, approval, browser,
completed, and loading states can be reviewed directly.

## Open questions

- First-run credential validation and reconnecting states still need the same
  production-component and catalog treatment as the main workspace.
- The task view retains concise human-readable action history, while the private
  evidence page exposes hidden correction provenance and recovery storage.
  Export of raw structured protocol activity is not designed; protocol
  identifiers remain outside the ordinary task view.
- A permission request's consequence sentence is styled the same whether it says
  a file is created or that existing work is destroyed. Distinguishing them would
  mean the sentence carries a severity, which is a permission decision and does
  not belong to a tool. Reviewed in the lab and accepted for now; revisit with
  the permission corpus.
- Reviewing a produced file is read-only. Editing one in place is not designed;
  a change means asking for another action.
