---
name: whitepaper-structure
description: >-
  Use when writing a technical specification, whitepaper, or design document: executive summaries, problem statements, threat models, system topologies, and decision rationale.
---

Approach the work as the author whose document must let a busy reader decide and an implementer build. Structure serves those two readers; every section must answer a question one of them has.

**Lead with an executive summary a decision-maker can act on alone:** the problem, the proposal, the key trade-off, and the decision requested, the conclusion first. Write it last, and keep it under a page.

**Use a structure that fits the document's job.** A specification usually needs:
1. Problem and context: who is affected, what fails today, and evidence of the need.
2. Goals and non-goals, stated so that a reader can check them.
3. The design: components, interfaces, data flow, and the system topology, with a diagram that matches the text.
4. Alternatives considered and why they were rejected, on their mechanisms.
5. Security and privacy: a threat model naming assets, trust boundaries, adversaries, and mitigations, with the risks that remain.
6. Operations: deployment, monitoring, failure modes, and rollback.
7. Open questions and the assumptions the design depends on.

A whitepaper for a wider audience keeps the summary, the problem with its evidence and the proposal, and moves detail an implementer needs to an appendix.

**State goals so they can be checked.** "Fast" cannot be checked; "the order endpoint answers 99% of requests within 200 ms at 500 requests a second" can. Give each requirement an id, such as R1, so the design, the tests and the review can point at it.

**Build the threat model from the diagram.** For each trust boundary the data crosses, ask how each kind of threat applies: someone pretending to be another, data changed in transit or at rest, an action denied afterwards, data disclosed, the service made unavailable, and a privilege gained. Each threat gets a mitigation or an accepted risk with its owner.

**Be precise.** Use normative words such as must, should, and may consistently; where the document follows BCP 14, say so and write them as it defines (MUST, SHOULD, MAY). Give numbers with units and sources. Define every term and acronym once, in one place.

**Keep claims honest.** Separate what has been measured from what is expected, and never present a proposal as settled fact. Give the document a status, such as draft, under review or accepted, and a date.

**Make it in the app.** Draw the topology and the flows with render_diagram and save_to, an .svg path, and place them in the document. Write it in Typst and compile it with compile_document (skill:publishing/latex-typst-authoring), then read the pages with read_document. The publishing/peer-review-critic specialist reviews the argument as a demanding reader would.

**Check the finished document against its goals:** every goal is addressed by the design, every component appears in the diagram, and every threat has a mitigation or an accepted risk. Report any gap you found and left open.
