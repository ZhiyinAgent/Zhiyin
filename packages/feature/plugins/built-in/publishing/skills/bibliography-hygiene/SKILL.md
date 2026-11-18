---
name: bibliography-hygiene
description: >-
  Use when managing references: BibTeX or Hayagriva entries, canonical citation keys, DOI and metadata validation, and consistent citation style.
---

Approach the work as the maintainer of a bibliography that other people will follow to the sources. Every entry must identify exactly one work, correctly.

**Keep one bibliography file per document or project,** in BibTeX for LaTeX, or Hayagriva or BibTeX for Typst (`#bibliography("refs.bib")`), and never duplicate a work under two keys.

**Use canonical keys in one scheme,** such as the first author's family name, the year, and the first significant title word, lowercased: smith2021attention. Resolve collisions with a letter suffix, and never change a key already cited without updating every citation; search_files finds every use.

**Validate metadata against the source of record:**
- Resolve each DOI and compare the title, authors, venue, year, volume, and pages with the publisher's record. The DOI's own page, https://doi.org/ followed by the DOI, leads to it; Crossref's api.crossref.org/works/ followed by the DOI returns the registered metadata as JSON.
- For arXiv preprints, record the arXiv identifier and check whether a published version now exists; cite the version actually used. With alphaXiv connected, discover_papers finds a paper and get_paper_content reads it.
- Check the publisher's page for a retraction or a correction notice before citing a work as evidence.
- Use the correct entry type, such as article, inproceedings, or book, with its required fields.
- Preserve capitalization that matters, such as acronyms and proper nouns, by protecting it in braces.

For example, a checked BibTeX entry:

    @inproceedings{vaswani2017attention,
      author    = {Vaswani, Ashish and Shazeer, Noam and Parmar, Niki and others},
      title     = {Attention Is All You Need},
      booktitle = {Advances in Neural Information Processing Systems 30 ({NIPS} 2017)},
      year      = {2017},
      pages     = {5998--6008},
      eprint    = {1706.03762},
      archivePrefix = {arXiv}
    }

**Never invent a DOI, page range, or venue.** If a detail cannot be confirmed, leave it out and say so. A reference given only from memory, with no source opened, is unverified until it is checked.

**Keep the citation style consistent** with the venue's requirement and let the tool format it: a BibTeX style or biblatex in LaTeX, `#bibliography("refs.bib", style: "ieee")` or another style name in Typst. Do not hand-format references.

**Before finishing,** compile the document with compile_document and read its warnings: no citation is undefined, no entry is unused unless intended, and no two keys name the same work. Look at the reference list's page with read_document. The publishing/citation-auditor specialist checks that each cited source says what the text claims it says. Report the entries you could not verify.
