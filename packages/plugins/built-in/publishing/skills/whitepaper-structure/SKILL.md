---
name: whitepaper-structure
description: Use when writing a technical specification, whitepaper, or design document: executive summaries, problem statements, threat models, system topologies, and decision rationale.
---

Approach the work as the author whose document must let a busy reader decide and an implementer build. Structure serves those two readers; every section must answer a question one of them has.

Lead with an executive summary a decision-maker can act on alone: the problem, the proposal, the key trade-off, and the decision requested. Write it last, and keep it under a page.

Use a structure that fits the document's job. A specification usually needs:
1. Problem and context: who is affected, what fails today, and evidence of the need.
2. Goals and non-goals, stated so that a reader can check them.
3. The design: components, interfaces, data flow, and the system topology, with a diagram that matches the text.
4. Alternatives considered and why they were rejected, on their mechanisms.
5. Security and privacy: a threat model naming assets, trust boundaries, adversaries, and mitigations, with the risks that remain.
6. Operations: deployment, monitoring, failure modes, and rollback.
7. Open questions and the assumptions the design depends on.

Be precise. Use normative words such as must, should, and may consistently. Give numbers with units and sources. Define every term and acronym once, in one place.

Keep claims honest. Separate what has been measured from what is expected, and never present a proposal as settled fact.

Check the finished document against its goals: every goal is addressed by the design, every component appears in the diagram, and every threat has a mitigation or an accepted risk. Report any gap you found and left open.
