# Component library

Zhiyin's window is built from React components that live in the renderer's
modules, plus a small set of shared components every module may use. Two pages
show them outside the app: the component lab, where each component is reviewed
on its own in the states a person can meet, and the composed demo, which runs
the whole workspace on fixtures. Both render the production components; neither
is a second implementation of the interface.

## Running it

```
pnpm --filter desktop demo
```

This serves the lab at `component-lab.html` and the composed workspace at
`zhiyin-demo.html`. The demo's `?scenario=` picks a starting state: `new`,
`thinking`, `required-reasoning` (a model whose reasoning cannot be turned off),
`working` (the default), `quiz`, `approval`, `browser`, `document`, `done`,
`condensing`, `loading`, `plugins`, `long` (a 300-entry conversation that keeps
streaming, for measuring typing while text arrives) and `damaged` (two
conversations that cannot be opened and a report about the app).

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
  the dialog closes. It stays open when the window loses focus, so something can
  be copied into it from another app. `className` styles the dialog's own box.
- **`SurfacePanel`**: a page that takes the conversation's place. It takes a
  `label` (its accessible name), an `eyebrow`, a `title`, an optional
  `description`, optional `controls` beside the close button, `closeLabel` and
  `onClose`. How it scrolls (`scroll`: `"page"` or `"contained"`) and how much
  room its heading gets (`headerSpacing`: `"normal"` or `"loose"`) are options,
  so a page never sets those properties from its own stylesheet. `className`
  and `headerClassName` are for what is particular to a page.
- **`StandalonePage`**: a page shown before the workspace, such as onboarding or
  history recovery. It takes a `label`, a `title`, an `introduction`, and
  optionally a `tagline` beside the mark, `children` for what the page asks,
  a `note` and `actions` at the end, and an `error`. `layout="split"` puts the
  content beside the heading in a wide window; narrow windows stack it.
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
- **`CloseButton`**: the round close control of a page, with its `label` and
  `onClick`.
- **`Icon`**: one of the app's line icons by `name`, drawn in the current text
  colour and hidden from assistive technology. Name the control that holds it.
- **`Logo`**: the mark with the name beside it, or the mark alone when
  `compact`; `size` is the mark's width in pixels.
- **`HoverTips`**: mounted once per window. It names an icon-only control on
  hover and keyboard focus from its accessible name, and shows a control's
  `data-tip` when it has one. Put `data-tip` on a disabled control to say what
  it is waiting for. A control with its own `title` keeps it.
- **`useDismiss(open, inside, dismiss, { closeOnBlur })`**: closes a menu,
  popover or dialog on a press outside the elements in `inside`. Only the top
  layer closes. `closeOnBlur` (on by default) also closes it when the window
  loses focus. While a layer is open, the top bar stops dragging the window, so
  a click there closes the layer instead.
- **`countWords`** and **`wordCount`**: instructions are measured for people in
  words, never in bytes.

## Theme and shared styles

Every colour is a `--zy-` token from the theme, defined for both the dark and
the light theme; a stylesheet never writes a literal colour. The grounds are
`--zy-canvas`, `--zy-sidebar` and the `--zy-panel` family; text is `--zy-text`,
`--zy-text-soft`, `--zy-muted` and `--zy-faint`. `--zy-accent` is the red for
text, icons and borders, and `--zy-accent-fill` the darker red a control is
filled with, under `--zy-on-accent` text. States use `--zy-running`,
`--zy-green`, `--zy-amber` and `--zy-danger`. Radii (`--zy-radius-sm`, `-md`,
`-lg`) and fonts (`--zy-font-display`, `--zy-font-body`, `--zy-font-data`) are
tokens too. Text is never set under 12 px.

The global stylesheet also holds the shared basics any module may use as plain
class names: `button`, with `button--accent` for the primary action,
`button--quiet` and `button--small`; `text-button`; `eyebrow`; and
`instrument-label`. Everything else a module draws is styled by its own CSS
Module, and a module never names another module's classes.

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
model and usage, the browser, and documents. A test renders the whole lab and
checks that every entry appears.

## Change workflow

1. Write or update the behavior test for the change a person will see.
2. Change the production component.
3. Add or update its lab entry and its states.
4. Review the component on its own at desktop and narrow widths, in both
   themes.
5. Review the composed workspace for hierarchy, repetition and overflow,
   including at 720 × 480.
6. Run the repository gate.
