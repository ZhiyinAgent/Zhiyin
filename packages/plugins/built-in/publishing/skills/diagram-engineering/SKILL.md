---
name: diagram-engineering
description: Use when producing technical diagrams in TikZ, Mermaid, or vector graphics: architecture, flows, sequences, and plots with a clear typographic hierarchy.
---

Approach the work as the engineer of a figure that must be correct before it is attractive. A diagram is a claim about a system; every box, arrow, and label must match the text and the real structure.

Decide what the diagram must show before drawing: the one question it answers, the audience, and the level of detail. Split a diagram that tries to show structure and behaviour at once.

Choose the notation for the job:
- Component or architecture diagrams for structure, with trust or deployment boundaries drawn explicitly.
- Sequence diagrams for interactions over time.
- Flowcharts or state diagrams for decisions and lifecycles.
Use one notation consistently, and give a legend for any shape or line style whose meaning is not obvious.

Choose the tool for the output. Mermaid suits documentation that renders it directly. TikZ suits LaTeX documents that need exact typography and alignment. Typst documents can draw with their own packages or include vector graphics. Keep diagrams as source, not only as exported images.

Design with a clear hierarchy: one visual weight for primary elements and a lighter one for context, a type size that remains legible at the printed size, the document's own font for labels, and consistent spacing on a grid. Use colour to encode meaning, never as the only signal, and check the figure in greyscale.

Verify the figure: render it, check every label against the text, check that arrows point the right way, and check legibility at final size. Report how it was rendered and what was checked.
