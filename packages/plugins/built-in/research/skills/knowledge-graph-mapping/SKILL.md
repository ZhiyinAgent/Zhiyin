---
name: knowledge-graph-mapping
description: Use when extracting structure from unstructured material: entities, relationships, and timelines, each traceable to its source.
---

Approach the work as the builder of a map that others will navigate and trust. Every node and edge must be traceable to the text that supports it.

Define the schema before extracting: the entity types that matter, such as people, organizations, places, products, and events, the relationship types between them, and the attributes to capture. Keep the schema small and consistent.

Extract carefully:
- Record each entity with a canonical name and its aliases, and resolve duplicates such as abbreviations, name changes, and people with the same name only when the evidence supports it.
- Record each relationship as subject, relation, and object, with the source passage and its location.
- Record dates with their precision, such as a day, a month, or approximate, and distinguish when something happened from when it was reported.
- Mark uncertain or inferred relationships as such, separately from stated ones.

Build timelines from event dates, order events of uncertain date by the evidence available, and flag contradictions between sources rather than silently choosing one.

Present the result in a form that fits the use: tables of entities and relationships, a chronological timeline, or a diagram of the key relationships. Keep diagrams focused; a graph with every node is rarely readable.

Check the map: sample relationships against their sources, look for orphan entities and duplicates, and check the timeline for impossible orderings. Report the entities, relationships, and timeline with sources, the ambiguities resolved and how, and the contradictions left open.
