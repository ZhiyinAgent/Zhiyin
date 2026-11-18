# Component library

Zhiyin's window is built from React components that live in the renderer's
modules, plus a small set of shared components every module may use. Two pages
show them outside the app: the component lab, where each component is reviewed
on its own in the states a person can meet, and the composed demo, which runs
the whole window on fixtures. Both render the production components; neither
is a second implementation of the interface.

## Running it

```
pnpm --filter desktop demo
```

This serves the lab at `component-lab.html` and the composed window at
`zhiyin-demo.html`. The demo's `?scenario=` picks a starting state: `new`,
`thinking`, `required-reasoning` (a model whose reasoning cannot be turned off),
`waiting-message` (the same, with two messages sent during the turn waiting to
be delivered), `working` (the default), `quiz`, `folder-instructions` (a
folder's instructions, long enough to scroll, asked about before the first
answer), `approval` (a shell command, asked about for its full access),
`connected-tool` (a tool of a connection the person added),
`browser`, `document`, `done`, `condensing`, `loading`,
`plugins`, `long` (a 300-entry conversation that keeps streaming, for
measuring typing while text arrives) and `damaged` (two conversations that
cannot be opened and a report about the app).

Both pages take `?look=` and `?strength=` to open in a look, and the lab's
header switches the look and strength in place, so every entry can be reviewed
in each.

Restart the server after `pnpm install`. Vite pre-bundles dependencies when it
starts, and a server left running across an install can answer with 504
"Outdated Optimize Dep", which shows as a blank page.

## Shared components

These come from the `shared` module, which holds neutral pieces and imports no
other module. Use them rather than drawing a new frame, dialog or placeholder.

- **`Dialog`**: a modal over a scrim, with its `title` and a Close button at
  the top, the content as `children`, and an optional `footer` for its actions.
  `onClose` is called on Close, on Escape and on a press outside it. Focus moves
  into the dialog, Tab stays inside it, and focus returns to where it was when
  the dialog closes. With one dialog over another, Escape closes the top one. It stays open when the window loses focus, so something can
  be copied into it from another app. `className` styles the dialog's own box.
  `heading` sets what the header holds before Close, around the title, such
  as a mark or a status; `tabs` draws a tab list under the header, and the
  body becomes the panel its tabs control. `look` draws a dialog that is not
  the usual form, part by part: the records opened from an action (a change,
  what an action did, a specialist's run) are wider, under a lighter scrim.
- **`SurfacePanel`**: a page that takes the conversation's place. It takes a
  `label` (its accessible name), an `eyebrow`, a `title`, an optional
  `description`, optional `controls` beside the close button, `closeLabel` and
  `onClose`. How it scrolls (`scroll`: `"page"` or `"contained"`) and how much
  room its heading gets (`headerSpacing`: `"normal"` or `"loose"`) are options,
  so a page never sets those properties from its own stylesheet. `className`
  and `headerClassName` are for what is particular to a page.
- **`StandalonePage`**: a page shown before the conversations open, such as onboarding or
  history recovery. It takes a `label`, a `title`, an `introduction`, and
  optionally a `tagline` beside the mark, `children` for what the page asks,
  a `note` and `actions` at the end, and an `error`. `layout="split"` puts the
  content beside the heading in a wide window; narrow windows stack it.
- **`ModelSays`**: what a model wrote about an action, a command or a
  specialist's task, after the words "The AI says" (`modelAttribution`), which
  say on hover what that means. Every place that shows such text uses it, so
  it is attributed the same way everywhere.
- **`InfoTip`**: an info button that explains a choice, named "About" its
  `topic`. `children` is the explanation, at most two sentences; `setup`
  (`{ label?, open }`) adds one link to the page that says how to set it up, and
  `details` folds what it can reach under Details. It opens on a press, never
  on focus alone, closes on Escape or a press elsewhere without closing a dialog
  it sits in, and stays inside the window.
- **`Notice`**: a short boxed statement in the conversation, such as something
  that stopped or failed. `role` is `"alert"` or `"status"`.
- **`PathName`**: a file path on one line. When space runs out it shortens the
  folder first, then the middle of the file name, never the extension, and shows
  the whole path on hover.
- **`LoadingSkeleton`** and **`SkeletonBlock`**: placeholders. `LoadingSkeleton`
  is a list taking shape, announced by its `label`. `SkeletonBlock` is one shape
  (`variant`: `"avatar"`, `"title"`, `"line"` or `"control"`, with `wide` for a
  line that fills its column); its size and place belong to the component
  waiting for content, passed through `className`.
- **`FullSizePicture`**: a picture as large as the window allows, in a `Dialog`
  named by `title` (the file name, defaulting to `alt`).
- **`AttachedPicture`** and **`PastedText`**: what the person attached to a
  message, in the composer and on the message once sent. A picture shows small
  with its name, opens full size, and says why when it is no longer stored; a
  long paste shows as the file it was kept as and opens with `onOpen`. Each
  can be taken off with `onRemove`.
- **`CloseButton`**: the round close control of a page, with its `label` and
  `onClick`.
- **`Icon`**: one of the app's line icons by `name`, drawn in the current text
  colour and hidden from assistive technology. Name the control that holds it.
- **`Logo`**: the mark with the name beside it, or the mark alone when
  `compact`; `size` is the mark's width in pixels. The look draws the mark:
  `mark="small"` is the one drawn in a line of the conversation, and
  `mark="large"` the one on the new-task page, sized by the look.
- **`lookWords`** and **`strengthNames`**: each listed look's name, the
  sentence that describes it, and whether it draws pictures; and each
  strength's name. Every listed look must have its words.
- **`HoverTips`**: mounted once per window. It names an icon-only control on
  hover and keyboard focus from its accessible name, and shows a control's
  `data-tip` when it has one. Put `data-tip` on a disabled control to say what
  it is waiting for. A control with its own `title` keeps it.
- **`usePopover(options)`**: what floats from a button, a menu or a popover.
  It returns `open` with `toggle`, `close` and `setOpen`; the refs for its
  frame (`root`, given `onKeyDown`), its button (`trigger`) and its panel
  (`panel`, named by `panelId`), which may be drawn elsewhere in the page.
  It closes on a press outside it and when the window loses focus, only the
  top layer when several are open; while it is open the top bar stops
  dragging the window, so a click there closes it. It closes on Escape too,
  with focus back on its button, or on what `openedFrom` names; Escape inside
  it closes it alone, leaving a drawer or dialog around it open. With a
  `placement` it is placed in the window against its anchor from its own
  measured size, on its side or the other when only that has room, and again
  as the window changes or it grows. `onOpened` runs once it is placed, such
  as to put focus in it. `open` and `onOpenChange` hand its state to the
  caller.
- **`Menu`**: a menu's one look: its frame, items that are buttons with a menu
  item role (`data-danger` on one that removes something), and the unrolling
  from where it opens (`opens`, or as `usePopover` places it). The arrow keys,
  Home and End move among its items. `className` places it and sets its width
  and layer.
- **`ConfirmChoice`**: the question before something that cannot be taken
  back, announced as it appears, with its `detail` under it and two answers
  at the end: `keep` (Keep, by default) first, then `act`. `children` stand
  between the question and the answers, such as a choice about how to act.
  `busy` holds both answers while one is on its way; `small` is for a narrow
  place. Its frame, if any, is its holder's.
- **`useModalFocus(dialog, onEscape)`**: what makes a modal `Dialog` keyboard
  friendly, for a modal drawn another way: focus moves in and comes back, Tab
  goes round its controls, and Escape calls `onEscape`. The dialog holding
  focus answers; with focus in none, the last one opened does.
- **`Toggle`**: something on or off, drawn as a small slider: `on`,
  `onChange` and `disabled`. Name it with `aria-label` or
  `aria-labelledby`.
- **`PointedTip`**: a small info button named `label`, whose sentence (its
  children) shows above it, with an arrow down to it, while the button is
  pointed at or focused. `className` gives the button its size and place in
  its line.
- **`ChoiceSwitch`**: a few choices side by side, one of them on, such as a
  theme or a lab's platform. Its `choices` are real radio buttons, so the arrow
  keys move between them; `value` is the one on and `onChange` is told of a new
  one. `disabled` switches it off: the choice on still shows, quieter, and no
  other can be made; say why beside it. Name it with `aria-label` or
  `aria-labelledby`.
- **`SurfaceFrame`**: the frame every surface beside the conversation is
  drawn in. It takes the surface's `label`, an `icon`, the `title` and its
  `detail` or `status`, a `menu` of the surface's other items, `tools` for its
  title row, a `bar` for a second row, `close`, and `working`; what fills it is
  its children. A surface hands what fills it `FrameParts`: its label, menu and
  close. `FrameButton`, `FrameChoice`, `FrameWaiting` and `FrameNotice` are
  its small buttons, side-by-side choices, the waiting line and the notice
  that says why something is not shown.
- **`WindowLayer`**: puts its `children`, a dialog, over the whole window, so a
  dialog opened inside the conversation is not clipped by it or drawn under the
  browser, document or 3D view beside it.
- **`moveAmongTabs`** and **`moveAmongChoices`**: key handlers for a tab list
  and for a list of choices with one Tab stop. The arrow keys move focus to
  the next or previous item, wrapping at either end, and Home and End to the
  first and last. A tab is selected as focus reaches it; a choice is only
  chosen with Enter or Space, and one that cannot be chosen is passed over.
  **`tabStopOf`** says which choice holds the Tab stop, and **`focusMenu`**
  puts focus in a menu as it opens.
- **`useTurnAndZoom`**: how a 3D picture is turned and zoomed: dragging, the
  arrow keys, plus and minus, and Home to go back. It returns the handlers to
  spread on the view and whether a drag is under way.
- **`countWords`** and **`wordCount`**: instructions are measured for people in
  words, never in bytes.
- **`counted`** and **`listed`**: a number with its noun (`1 file`,
  `1,204 files`) and a list in words (`a, b and c`, or with `or`), written the
  same everywhere.
- **`fileSize`**, **`tokenCount`** and **`elapsedTime`**: a size (`240 bytes`,
  `47 KB`, `10.0 MB`), a number of tokens (`950`, `205K`, `1.1M`) and a length
  of time (`5 s`, `1 min 20 s`, `1 h 5 min`), written the same everywhere.
- **`formatMoney`** and **`currencySymbol`**: an amount in its own currency,
  never converted; cents for anything worth a cent.
- **`visibleText`**: a text with every character that draws nothing or changes
  the order of the rest written as its code, so what a person approves reads as
  what will run.

## Theme and shared styles

Every colour is a `--zy-` token from the theme, defined for both the dark and
the light theme; a stylesheet never writes a literal colour. The grounds are
`--zy-canvas`, `--zy-sidebar` and the `--zy-panel` family; text is `--zy-text`,
`--zy-text-soft`, `--zy-muted` and `--zy-faint`. `--zy-accent` is the red for
text, icons and borders, and `--zy-accent-fill` the darker red a control is
filled with, under `--zy-on-accent` text. States use `--zy-running`,
`--zy-green`, `--zy-amber` and `--zy-danger`. Radii and fonts
(`--zy-font-display`, `--zy-font-body`, `--zy-font-data`) are tokens too: the
radius scale runs `--zy-radius-1` to `--zy-radius-19`, each an exact size, with
`--zy-radius-round` for a circle and `--zy-radius-pill` for a pill. The
ground's texture is `--zy-grain-ground`, laid over a ground in soft light, and
`--zy-grain-text` over what is read, at `--zy-grain-text-strength`.

The pictures on the ground and the logo's mark come from the look (ADR 0028),
never from a component. A component reads the look's `--zy-look-` variables
for its slot (the ground, the drift over it, the side column, the page, the
title and the marks) and multiplies a picture's opacity by
`--zy-look-strength`; no component stylesheet names a look. A part a look
may redraw (panels, buttons, chips, checks, the step track, the person's
message, suggestions, the list's labels, the current row) reads its
`--zy-look-` variable with its own value as the fallback,
`var(--zy-look-panel-radius, var(--zy-radius-16))`; a look that keeps the
part sets the variable to `initial`, which makes `var()` use the fallback
(ADR 0028). Each look fills every variable, or declares it empty, in both
themes, and its colours meet the same contrast as the theme's. A look paints
in `--zy-landscape`, with `--zy-mist` for mist. The conversation's column is
`--zy-reading-width` wide, for the entries, the composer, the cards and any
look that keeps that column calm.

A card resting on the ground
is `--zy-card` with `--zy-card-line` and `--zy-shadow-card`; a field is
`--zy-field`; a hairline between rows is `--zy-hairline`; a chosen segment is
`--zy-ink-tint`, and what is chosen in a list carries an inset line of
`--zy-accent-fill` over `--zy-ink-wash`. Text is never set under 12 px; a size relative to its parent is written
as `max(12px, …)`. What floats over the page takes its place from a
`--zy-layer-` token, lowest first: `menu`, `confirm`, `popover`,
`navigation`, `modal`, `overlay`, `hover-tip` and `alert`. A dialog sits on
`modal`, over the narrow window's navigation and its button.

The global stylesheet also holds the shared basics any module may use as plain
class names: `button`, with `button--accent` for the primary action,
`button--quiet` and `button--small`; `text-button`; `eyebrow`; and
`instrument-label`. It also holds the shared motion, which a module names as
`global(zy-spin)`, a spinner's turn; `global(zy-progress)`, a hairline that
travels while something loads; `global(zy-unroll-down)` and
`global(zy-unroll-up)`, a menu unrolling below or above its button;
`global(zy-scrim-in)` and `global(zy-rise)`, a dialog's scrim and the dialog
rising over it; `global(zy-settle)`, a page settling as it opens; and
`global(zy-drift)`, mist moving one tile of its picture. An entrance runs with
its fill on `backwards`, so nothing it sets stays once it has run. Everything else a module draws is styled
by its own CSS Module, and a module never names another module's classes.

## Lab rules

- Every lab entry renders the production component. Fixtures provide data and
  callbacks; copied markup is not allowed.
- Every reusable interactive component has an entry with the states a person
  must understand: normal, disabled or paused, loading, empty, error, and
  confirmation where those states exist. An entry's states stack in its own
  column. A state reached only by a click, such as an open menu, says so in the
  entry's description.
- Loading examples have the size and layout of the content they replace, and
  never show invented progress.
- Long text and long names are reviewed at narrow widths before a component is
  used in a composed screen.
- The lab is for visual and interaction review. Behavior is covered by
  component tests.

An entry is an `id`, a `title`, a `description` and a `render` function, kept
in the catalog file for its area: the conversation, condensing, user input,
views, actions, tool calls, the app shell, capabilities, produced files, the
model and usage, the browser, documents and videos, and the 3D view's scene and parts. A test renders the
whole lab and
checks that every entry appears.

## Change workflow

1. Write or update the behavior test for the change a person will see.
2. Change the production component.
3. Add or update its lab entry and its states.
4. Review the component on its own at desktop and narrow widths, in both
   themes.
5. Review the composed window for hierarchy, repetition and overflow,
   including at 720 × 480.
6. Run the repository gate.
