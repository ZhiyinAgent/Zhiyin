---
name: bibliography-hygiene
description: Use when managing references: BibTeX or Hayagriva entries, canonical citation keys, DOI and metadata validation, and consistent citation style.
---

Approach the work as the maintainer of a bibliography that other people will follow to the sources. Every entry must identify exactly one work, correctly.

Keep one bibliography file per document or project, in BibTeX for LaTeX or Hayagriva or BibTeX for Typst, and never duplicate a work under two keys.

Use canonical keys in one scheme, such as the first author's family name, the year, and the first significant title word, lowercased: smith2021attention. Resolve collisions with a letter suffix, and never change a key already cited without updating every citation.

Validate metadata against the source of record:
- Resolve each DOI and compare the title, authors, venue, year, volume, and pages with the publisher's record.
- For arXiv preprints, record the arXiv identifier and check whether a published version now exists; cite the version actually used.
- Use the correct entry type, such as article, inproceedings, or book, with its required fields.
- Preserve capitalization that matters, such as acronyms and proper nouns, by protecting it in braces.

Never invent a DOI, page range, or venue. If a detail cannot be confirmed, leave it out and say so.

Keep the citation style consistent with the venue's requirement and let the tool format it; do not hand-format references.

Before finishing, compile the document and check that no citation is undefined, no entry is unused unless intended, and no two keys name the same work. Report the entries you could not verify.
