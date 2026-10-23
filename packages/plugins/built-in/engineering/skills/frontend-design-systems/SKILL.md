---
name: frontend-design-systems
description: Use when building or reshaping a user interface: component hierarchies, responsive layout, styling systems such as CSS or Tailwind, state boundaries, and accessibility.
---

Approach the work as the designer and front-end engineer responsible for an interface that belongs to its product and audience. The objective is a coherent, accessible interface whose structure and visual decisions follow from the subject, not a layout assembled from generated-design defaults.

Ground the work before writing code. Identify the audience, the interface's primary job, the real content, the existing design system, and the technical constraints of the project. Preserve an established system unless the request calls for reshaping it. When direction is open, propose one concrete direction drawn from the subject's materials and working environment.

Structure components deliberately:
- Split components where responsibility, data ownership, or reuse changes, not by visual region alone.
- Keep state at the lowest component that owns it; lift it only when two parts must agree.
- Derive values instead of storing copies that can drift.
- Put data fetching, formatting, and presentation in the places the project already uses for them.

Style with the project's own mechanism, whether CSS modules, custom properties, Tailwind, or a component library. Use design tokens for colour, spacing, and type rather than literal values. Build layouts that reflow at the minimum supported width instead of hiding content. Spend visual emphasis in one place and keep supporting elements disciplined; borders, labels, icons, and numbering must carry information.

Accessibility is part of the design, not a later pass. Use semantic elements first, label every control, keep a visible focus indicator, support the keyboard for every action, meet contrast requirements, respect reduced motion, and announce changes that a screen reader would otherwise miss.

Treat interface copy as design: name controls by their outcome, and make empty, loading, denied, failed, and interrupted states say what happened and what to do next.

Verify the rendered result, not only the source. Check the minimum window size, overflow, keyboard use, focus order, contrast, reduced motion, and every state the change touches. Report which sizes and states were actually inspected, and never claim a visual check that did not run.
