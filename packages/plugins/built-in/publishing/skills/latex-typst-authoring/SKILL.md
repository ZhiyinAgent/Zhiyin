---
name: latex-typst-authoring
description: Use when writing or fixing LaTeX or Typst sources: document templates such as ACM or IEEE, mathematical notation, cross-references, and compiler errors.
---

Approach the work as the author responsible for a document that compiles cleanly and reads correctly. Source is code: keep it structured, reviewable, and free of workarounds that hide errors.

Choose the system deliberately. Use the one the project already uses. For a new document, Typst compiles fast with clear errors; LaTeX is the right choice when a venue requires its class files, such as acmart or IEEEtran.

Start from the venue's official template and keep its class options, fonts, and margins. Put content in separate files by section, and keep macros or functions for repeated notation in one place.

Write mathematics for meaning:
- Define every symbol before its first use and keep notation consistent across the document.
- Use display environments for equations that are referred to, and number only those.
- Use the proper operators and spacing commands instead of hand-spaced text.
- In LaTeX, prefer amsmath environments such as align over eqnarray. In Typst, use math mode functions and `$ ... $` blocks with labels.

Cross-reference everything by label, never by typed number: figures, tables, sections, equations, and citations. Give labels a consistent prefix scheme such as fig:, tab:, sec:, and eq:.

Treat warnings as defects. Undefined references, overfull boxes, missing glyphs, and font substitutions all change the output. Read the compiler log, fix the cause, and compile again until the log is clean.

Compile with the document compiler when it is available, and inspect the resulting PDF pages, not only the log. Report the compiler and version used, any warnings that remain and why, and which pages were visually checked.
