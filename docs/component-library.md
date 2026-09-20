# Component library workflow

The component lab is the review surface for the React components used by the
desktop application. It is not a second interface implementation.

## Invariants

- Every lab example renders the production component. Fixtures may provide
  representative data and callbacks; copied markup is not allowed.
- Every reusable interactive component appears in the catalog with the states
  a user must understand: normal, disabled or paused, loading, empty, error, and
  confirmation where those states exist.
- Component behavior is covered by focused DOM tests. The lab is for visual and
  interaction review, not a replacement for behavior tests.
- Loading examples use the same dimensions and hierarchy as the content they
  replace. They do not display invented task progress.
- Text and long tokens are reviewed at narrow widths before a component is
  accepted into a composed screen.

## Change workflow

1. Write or update the behavior test for the user-visible change.
2. Change the production component.
3. Add or update its catalog entry and representative states.
4. Review the isolated component at desktop and narrow widths.
5. Review the composed workspace for hierarchy, duplication, and overflow.
6. Run the repository gate.

The named test `ComponentLab > renders every production component catalog
entry` guards catalog registration. Component-specific tests guard behavior.

The catalog currently covers identity, structured model responses, the main
conversation timeline, the new-conversation state, permission, task plan, live
work trace, durable action history, history recovery, private evidence, task
context, composer, app frame, produced files, provider connection, usage,
onboarding, Skills, Agents, MCP connections and their component editor, the
browser panel, conversation rewind, quizzes, clarifying questions, the
user-input prompt, diagram and chart tool results, and the shared loading
placeholders. The produced-files example
reaches a ready preview, a missing file, a saved copy, and a failed save from
its own controls, and includes a long generated file name for overflow review;
its empty state is that the section does not render at all. The permission
examples cover an ordinary request, a long multi-line script, a shell command
whose effect only Zhiyin can describe, and a write that replaces existing work.
A pending decision never makes the decision area scroll: however long the
request is, the card shrinks to the space available and scrolls inside itself,
with one scroll region rather than a bounded block inside a scrolling card, and
Deny and Allow stay in view while it does. The same holds for a pending
clarification. The permission example uses the production pending-decision
feedback. The task-plan example uses the production ledger component with
observable criteria and verification states. The action-history example
includes running, completed, failed, and denied states with real targets and
plain-language reasons. Completed actions use the check marker without a
redundant status label; exceptional states retain text. The structured-response fixture includes headings,
lists, inline code, and a table so long-form output cannot be reviewed as a
one-line happy path. The composed `thinking` state keeps initial status
alignment reviewable, while the `done` state interleaves production assistant
messages and action history by their stored sequence. Ordinary answers end with
their content rather than a completion strip; artifact outcomes remain visible.
Tool invocations use the same complete card in permission, inspection, and
standalone catalog contexts. The caption, tool identity, connection, and inputs
remain inside that card; narrow cards stack input names above their values.
Adding a new reusable
interactive surface without a catalog entry is a documentation and review
defect, not a separate backlog item.

Skills, Agents, and MCP share one list-and-editor frame. Entering a category
selects its first item, and selecting another row replaces the editor without a
separate Edit action. MCP retains backend-reported connection and tool state.
Unsaved form edits block row, breadcrumb, and close navigation until the user
keeps or explicitly discards them. Required values, including a valid HTTP or
HTTPS MCP endpoint, report errors beside the affected field before storage is
called. The named regressions `keeps dirty edits until the user confirms a row
change`, `protects unsaved edits when the breadcrumb is used`, `protects dirty
server edits when another row is selected`, and `explains invalid MCP fields
before attempting a connection` guard those behaviors.
The task composer owns both Send and Stop in one stable control slot. Running
and paused are different states and must not look alike: while a response is
running only the message field is closed, so the dimming is confined to the
field and the Stop button, the reasoning control and the add-context control
stay live; a paused composer dims entirely and says why. The named regressions
`blocks typing while a response is in progress`, `keeps the settings and stop
controls usable while a response is in progress`, and `keeps every control
unavailable while the composer itself is paused` guard that split.

Diagrams and charts share one view frame: a rendered tab, a second tab holding
the source or the data it was drawn from, and an explicit save. What the frame
draws must also be readable — a chart states the range of both axes rather than
implying it, and a series is told apart by shape or dash pattern as well as by
colour. A diagram's labels are drawn as SVG text, never as HTML inside a
`foreignObject`: such a label is stripped before the diagram is shown and
refused when it is saved, so an HTML label is a label nobody ever sees. A saved
view leaves the stylesheet behind, so the frame writes out a self-contained
copy — namespaced, with what CSS was painting inlined — rather than the markup
as it stood in the page. Damaged stored data is drawn as a contained failure,
never thrown at the surrounding view. The named regressions `puts a readable
scale on the value axis, so a chart can be read as well as seen`, `names where a
plotted axis starts and ends, rather than implying it`, `saves a chart that
still stands up outside the app that drew it`, `shows a validated diagram with
source, keyboard zoom, and explicit save`, and `keeps a corrupt restored view
contained in a readable failure state` guard those behaviors. The catalog covers
the rendered, source, failed, and oversized diagram states, and the rendered,
single-value, empty, and rejected chart states.
