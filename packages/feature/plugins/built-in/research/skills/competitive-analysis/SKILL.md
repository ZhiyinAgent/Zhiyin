---
name: competitive-analysis
description: >-
  Use when comparing products or companies: feature matrices, pricing models, positioning maps, and the evidence behind each comparison.
---

Approach the work as an analyst whose comparison a decision-maker will rely on. Fairness and sourcing matter more than volume.

**Define the frame first:** the buyer or user segment, the job they need done, the competitors that are real alternatives for that job, including doing nothing and building it in-house, and the dimensions that matter to the decision. Ask the person with ask_user when the segment or the decision is unclear: a comparison for a startup buyer and for an enterprise buyer weigh the same features differently.

**Gather from the vendors' own pages.** With Tavily connected, tavily_map lists the pages of a vendor's site, tavily_crawl reads a section such as its documentation, and tavily_extract reads a pricing page or a changelog in full; tavily_search finds independent coverage. A search result's snippet or Answer line is not evidence; the page is.

**Build the feature matrix from evidence:**
- Use the vendors' current documentation, pricing pages, changelogs, and release notes, and record the date checked for each cell.
- Define each feature precisely enough that "yes" means the same thing for every vendor, and use "partial" with a note when it does not. "SSO" is three features: on which plans, with which protocols, at what extra cost.
- Mark what you could not verify as unknown, never as absent.
- Distinguish what is generally available from what is in beta, announced or on a roadmap.

**Compare pricing on a like-for-like basis:** the pricing model, such as per seat, usage, or tiers, list prices for representative scenarios, what each tier includes, and known costs such as minimums, overages, and required add-ons. Note where prices are not public. Price each scenario in full, for example "10 seats, 50,000 API calls a month, billed yearly, with SSO": one vendor's lower seat price can end higher once the plan that includes SSO and the overage are counted. Show the scenarios' totals with render_bar_chart, one chart per scenario.

**Map positioning on two axes that matter to the buyer,** such as depth versus ease of use or price versus scope, and place each competitor from evidence, not impression: say what each position rests on. render_scatter_plot draws it, each competitor a series of its own, so its name labels its point.

**Look beyond features:** target customers, distribution, ecosystem, and momentum signals such as release cadence and hiring, each with a source. Review sites and forums show what users complain about; weigh them for who writes there and who may have paid for the reviews.

**Stay neutral.** Present each competitor's strengths and weaknesses in comparable terms, including those of the product you may be asked to favour. skill:research/neutrality-review covers spin in the sources.

**Report** the matrix, pricing comparison, and positioning with sources and dates, the key differentiators for the decision, and the information that remains unverified. The research/fact-checker specialist can check the figures and claims before it is handed over, and research/report-synthesizer can turn the findings into one cited report.
