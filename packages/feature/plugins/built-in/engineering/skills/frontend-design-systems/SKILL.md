---
name: frontend-design-systems
description: >-
  Use when building or reshaping a user interface: component hierarchies, responsive layout, styling systems such as CSS or Tailwind, state boundaries, and accessibility.
---

Approach the work as the designer and front-end engineer responsible for an interface that belongs to its product and audience. The objective is a coherent, accessible interface whose structure and visual decisions follow from the subject, not a layout assembled from generated-design defaults.

**Ground the work before writing code.** Identify the audience, the interface's primary job, the real content, the existing design system, and the technical constraints of the project. Preserve an established system unless the request calls for reshaping it. When direction is open, propose one concrete direction drawn from the subject's materials and working environment: a typeface pairing, a palette, a density and one distinctive element, said in a sentence before building. The defaults a generator reaches for, a system sans-serif everywhere, a purple gradient, evenly rounded cards in a grid, read as no decision at all.

**Set the system as tokens first,** then build from them: colour, a type scale, a spacing scale and radii, in the project's own mechanism. For example, in CSS custom properties:

    :root {
      --space-1: 4px; --space-2: 8px; --space-3: 16px; --space-4: 24px; --space-5: 40px;
      --text-sm: 0.875rem; --text-md: 1rem; --text-lg: 1.25rem; --text-xl: 1.75rem;
      --ink: #1d232b; --muted: #5b6573; --surface: #fbfaf7; --accent: #b4462b;
    }

Every margin, size and colour in a component is one of these. Body text reads best at 45 to 75 characters a line, with a line height about 1.5; headings tighter.

**Structure components deliberately:**
- Split components where responsibility, data ownership, or reuse changes, not by visual region alone.
- Keep state at the lowest component that owns it; lift it only when two parts must agree.
- Derive values instead of storing copies that can drift.
- Put data fetching, formatting, and presentation in the places the project already uses for them.

**Style with the project's own mechanism,** whether CSS modules, custom properties, Tailwind, or a component library. Build layouts that reflow at the minimum supported width instead of hiding content. Spend visual emphasis in one place and keep supporting elements disciplined; borders, labels, icons, and numbering must carry information. Give images and media their dimensions, so the page does not jump as they load.

**Accessibility is part of the design, not a later pass.**
- Use semantic elements first: a button for an action, a link for navigation, headings in order, a label for every control.
- Support the keyboard for every action, in a focus order that follows the reading order, with a visible focus indicator.
- Meet contrast: 4.5:1 for normal text, 3:1 for large text and for the edges of controls and focus indicators (WCAG 2.2 AA).
- Give pointer targets at least 24 × 24 CSS pixels.
- Respect reduced motion (prefers-reduced-motion), and announce changes that a screen reader would otherwise miss, with a live region.

**Treat interface copy as design:** name controls by their outcome, and make empty, loading, denied, failed, and interrupted states say what happened and what to do next.

**Verify the rendered result, not only the source.** Open a workspace page with browser_preview: its answer gives the viewport and whether the page is wider than it, the console's errors, the page's snapshot, a picture of the window when the model sees pictures, and each file the page asked for and was not given. A font or library the page loads from the internet needs browser_allow_addresses first. Then:
- browser_resize to the minimum supported width and to a desktop width, and look again at each;
- use the page with the keyboard alone, with browser_press_key, and check the focus order in browser_snapshot;
- check every state the change touches, and the console with browser_console_messages;
- compare a screen before and after a change with compare_pictures, which shows where they differ.

The engineering/qa-e2e-verifier specialist can drive the flows through the browser independently. Report which sizes and states were actually inspected, and never claim a visual check that did not run.
