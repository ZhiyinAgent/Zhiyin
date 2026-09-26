# 0055. What floats over the page closes on a click outside it

Status: accepted

## Context

Menus, popovers and dialogs each decided for themselves when to close. The
reasoning and context-size popovers, the folder picker and a conversation's
menu closed on a press outside them. The app menu (Usage, Evidence, Settings)
and every dialog did not. The context panel's Compact button left the panel
open after acting.

Two kinds of click never reach the page, so no handler of a component could
see them:

- The window's top bar is its drag region. A press there moves the window.
- A click in another application or in the embedded browser only takes focus
  away from the window.

## Decision

1. **One shared rule, `useDismiss`.** Every open menu, popover and dialog is a
   layer on one stack. A press outside the top layer closes that layer alone,
   so a dialog opened over another closes by itself.
2. **Popovers close when the window loses focus.** Dialogs stay, so something
   can be copied into one from elsewhere.
3. **The top bar stops dragging while a layer is open.** The root carries
   `data-layer-open`, and the stylesheet makes the bar `no-drag`, so a click
   there closes the layer.
4. **A button in a popover that acts closes it.** Compact closes the context
   panel, which opens again to say why if compacting fails. Choosing a value
   (a budget, an effort) is not an action, and leaves it open.

## Consequences

- While a menu is open the window cannot be dragged by its bar. The first
  press closes the menu, and the next one drags.
- Components keep their own Escape handling.

Named tests are listed in the renderer architecture document under this ADR's
number.
