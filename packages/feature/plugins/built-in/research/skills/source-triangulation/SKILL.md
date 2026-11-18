---
name: source-triangulation
description: >-
  Use when a claim must be verified: cross-checking it across independent sources, tracing it to its origin, and weighing each source's authority.
---

Approach the work as an investigator whose conclusion must remain traceable to evidence. A claim is established when independent, credible sources support it, not when many pages repeat it.

**Define the claim precisely:** who, what, when, where, and in what units. Vague claims cannot be checked. "Sales tripled" becomes "the company's revenue for 2025 was three times its 2024 revenue, in its reported currency".

**Search, then open the pages.** With Tavily connected, tavily_search finds candidate sources and tavily_extract reads the pages you choose, in full. A search result's content is a snippet, and its Answer line is a generated summary: neither is a source. Narrow a search toward primary sources with include_domains, such as a statistics office's or a regulator's domain, toward a period with start_date and end_date, and to an exact phrase with exact_match. A PDF the person gives is read with read_document. Without a search connector, work from the sources the person provides and say so.

**Trace each claim to its origin.** Follow citations back to the primary source: the dataset, the filing, the statute, the paper, or the first-hand account. Secondary coverage helps you find sources and context; it does not independently confirm what it copied. For example: a news article cites a think-tank report, which cites a figure from a government survey; the survey's own table is the source, and the article and the report count as one source, not three. A page that changed or disappeared may survive in a web archive; cite the archived copy with its date.

**Weigh each source:**
- Authority: does the author or publisher have direct knowledge or relevant expertise?
- Independence: does the source have its own access to the facts, or does it repeat another source?
- Method: how was the information obtained, and is that method sound?
- Interest: does the source benefit from the claim being believed?
- Currency: is the information current for the question asked?

Read laterally: before trusting an unfamiliar source, search what others say about it, its owner, its funding and its record, rather than judging it by its own pages.

**Triangulate:** look for at least two independent sources that reach the claim by different routes. When sources disagree, explain the mechanism of the disagreement, such as different definitions, time periods, or methods, instead of picking the most confident one.

**Keep the trail.** For each source record its address, the date you opened it, and the passage the claim rests on, quoted. Never invent a source, a quotation, or a citation, and never claim to have read a page you did not open. The research/fact-checker specialist checks figures, dates, quotations and attributions against their primary sources independently.

**Report** each claim with its status, established, contested, or unverified, the sources behind it with their independence noted, and what evidence would change the assessment.
