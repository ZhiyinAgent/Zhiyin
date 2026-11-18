---
name: diagram-engineering
description: >-
  Use when producing technical diagrams in TikZ, Mermaid, or vector graphics: architecture, flows, sequences, and plots with a clear typographic hierarchy.
---

Approach the work as the engineer of a figure that must be correct before it is attractive. A diagram is a claim about a system; every box, arrow, and label must match the text and the real structure.

**Decide what the diagram must show before drawing:** the one question it answers, the audience, and the level of detail. Split a diagram that tries to show structure and behaviour at once. For a system, draw one level at a time: the system in its surroundings, then its parts, then the inside of one part.

**Choose the notation for the job:**
- Component or architecture diagrams for structure, with trust or deployment boundaries drawn explicitly.
- Sequence diagrams for interactions over time.
- Flowcharts or state diagrams for decisions and lifecycles.
- Entity-relationship diagrams for data, with cardinalities on every line.

Use one notation consistently, and give a legend for any shape or line style whose meaning is not obvious. Label every arrow with what flows along it or what it means, such as "HTTPS: order JSON" or "writes"; an unlabelled arrow can be read several ways.

**Choose the tool for the output.**
- render_diagram draws Mermaid 11 in the conversation: flowcharts, sequence, state, class and entity-relationship diagrams, Gantt charts, mindmaps, timelines and pies. With save_to, an .svg path, it writes the same drawing to a file, which a Typst document places with `#image("figures/flow.svg")`.
- TikZ suits LaTeX documents that need exact typography and alignment.
- Typst documents can draw with their own packages or include vector graphics.

Keep diagrams as source, not only as exported images, so a change to the system is a change to the source. For example, a sequence diagram for render_diagram:

    sequenceDiagram
        participant B as Browser
        participant A as API
        participant D as Database
        B->>A: POST /orders (Idempotency-Key)
        A->>D: insert order and key, one transaction
        D-->>A: order id
        A-->>B: 201 Created

**Design with a clear hierarchy:** one visual weight for primary elements and a lighter one for context, a type size that remains legible at the printed size (no smaller than the document's captions), the document's own font for labels, and consistent spacing on a grid. Keep the flow in one direction, left to right or top to bottom, and keep crossings few. More than about nine boxes at one level is a sign the diagram needs grouping or splitting. Use colour to encode meaning, never as the only signal, and check the figure in greyscale.

**Verify the figure:** render it, check every label against the text, check that arrows point the right way, and check legibility at final size: compile the document with compile_document and look at the page with read_document, not only at the figure alone. Give each figure a caption that says what it shows, and refer to it in the text. Report how it was rendered and what was checked.
