# 0035. Each renderer module owns its styles

Status: accepted

## Context

The renderer's modules already owned their components, and lint kept them from
importing one another. Their styles were a different matter. On 2026-09-11 most
of them sat in three shared stylesheets of about 6,400 lines, where any rule
could reach any element. Moving them apart turned up what that allowed:

- The browser module restyled the conversation, the permission request and the
  composer dock whenever it was open beside them.
- The app shell styled the insides of the permission request, and the
  capability, model and usage pages copied each other's panel class names.
- Several rules won only because their stylesheet happened to load later, and
  a few never applied at all.
- About fifty rules and class names styled nothing.

None of it was visible in a DOM test, and all of it made a style change in one
module a risk to another.

## Decision

- **A module's styles are a CSS Module beside its components.** Its class names
  are private to it, so no other module can depend on them.
- **One global stylesheet holds the foundations:** the theme tokens, the reset,
  and the shared basics every module may use — buttons, text buttons, and the
  eyebrow and instrument labels. It loads before any component. A page drawn
  around components for review, such as the component lab, loads its own
  styles after them.
- **A module that needs another's look uses that module's component or one of
  its options, never its class names.** The logo takes a size; the conversation
  and the permission request take a compact option; shared frames such as the
  page panel and the standalone page are components.
- **A parent places its children by styling its own elements**, or its direct
  children generically, and says so where that must outweigh a child's own
  default.
- **A repository test holds these rules**, since neither ESLint nor TypeScript
  reads styles: a global stylesheet may define only the foundations, a module
  stylesheet may name only its own classes and the foundations, and a component
  may write no other class name as plain text.

## Assumptions

- Vite's CSS Modules build and Vitest's option to keep written class names in
  DOM tests behave as documented. Checked on 2026-09-11 against Vite 7.3.6 and
  Vitest 4.1.11.
- Two modules never style the same element at the same weight. The order in
  which module stylesheets load is not relied on.
- Tests find elements by role, label or text rather than by class name.

## Consequences

- Class names in the built app are generated, so neither tests nor the
  component lab can select by them.
- Adding a shared basic means adding it to the list the test holds, which is
  meant to be a deliberate step.
- A visual change still needs a visual check. The move itself was compared
  screenshot by screenshot, at the default window and at 720 by 480.
