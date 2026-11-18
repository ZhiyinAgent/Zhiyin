---
name: latex-typst-authoring
description: >-
  Use when writing or fixing LaTeX or Typst sources, for a paper or a designed piece such as a card, an invitation, an itinerary, a flyer or a poster: templates, page design, mathematical notation, cross-references, and compiler errors.
---

Approach the work as the author responsible for a document that compiles cleanly and reads correctly. Source is code: keep it structured, reviewable, and free of workarounds that hide errors.

**Compile with compile_document,** the only way the compilers run here: they are not on the command line's path. It compiles a .typ with Typst or a .tex with Tectonic, writes the PDF beside the source unless another path is given, and answers with the engine and version, the PDF's pages and their size, its errors and warnings, and text that runs to a page's edge. Typst reports no other overflow, such as text spilling out of a fixed-size box, and no missing glyphs: look at the pages with read_document to check the layout.

**Choose the system deliberately.** Use the one the project already uses. For a new document, Typst compiles fast with clear errors; LaTeX is the right choice when a venue requires its class files, such as acmart or IEEEtran.

**Choose fonts that are there.** Typst has the fonts installed on this computer and its own Libertinus Serif, New Computer Modern and DejaVu Sans Mono, and warns when a font named is not found. list_fonts names them all; give matching to narrow it, such as ["YaHei", "SimSun", "SC", "Han"] for Chinese. Set the document's language, `#set text(lang: "zh")` or `lang: "en"`, so hyphenation and quotation marks follow it.

**A designed piece,** such as a card, an invitation, an itinerary, a flyer or a poster, is a Typst document too: set the page size and margins with `#set page`, place blocks with `#grid`, `#place` and `#box`, give colours with `rgb`, and add pictures from the workspace with `#image`. A chart for a document is drawn with the chart tools and save_to, an .svg path, and placed with `#image`, so the page shows the chart the person saw. Compile it to PDF rather than printing a web page, and look at each page before saying it is done.

**Start from the venue's official template** and keep its class options, fonts, and margins. Put content in separate files by section, and keep macros or functions for repeated notation in one place. A short Typst paper begins:

    #set page(paper: "a4", margin: 2.5cm)
    #set text(font: "Libertinus Serif", size: 11pt, lang: "en")
    #set heading(numbering: "1.")
    #set math.equation(numbering: "(1)")

    = Results <sec:results>
    The flow in @fig:flow follows @eq:rate.
    $ r = k [A]^m [B]^n $ <eq:rate>
    #figure(image("figures/flow.svg", width: 80%), caption: [Order flow.]) <fig:flow>

**Write mathematics for meaning:**
- Define every symbol before its first use and keep notation consistent across the document.
- Use display environments for equations that are referred to, and number only those.
- Use the proper operators and spacing commands instead of hand-spaced text.
- In LaTeX, prefer amsmath environments such as align over eqnarray, and siunitx for numbers with units. In Typst, use math mode functions and `$ ... $` blocks with labels.

**Escape the characters that are markup.** In Typst text, `$` starts an equation, and `#`, `*`, `_`, `@`, `<` and `` ` `` all mean something: write a price as `US\$78`, not `US$78`. In LaTeX, the same holds for `$ % & # _ { } ~ ^ \`.

**Cross-reference everything by label,** never by typed number: figures, tables, sections, equations, and citations. Give labels a consistent prefix scheme such as fig:, tab:, sec:, and eq:. In LaTeX, put `\label` after `\caption`, or it refers to the section instead.

**Treat warnings as defects.** Undefined references, overfull boxes, missing glyphs, and font substitutions all change the output. Read the answer's warnings, fix the cause, and compile again until they are gone.

**Inspect the resulting PDF pages, not only the log:** read_document on each page, or on a stretch of a long document, looking for overflow, a figure far from its reference, a heading alone at the foot of a page, and a missing glyph drawn as a box. compare_pictures compares a page with its mockup or with a scan of the original it rebuilds. The publishing/peer-review-critic specialist reviews a paper's argument, and publishing/citation-auditor its citations. Report the compiler and version used, any warnings that remain and why, and which pages were visually checked.
