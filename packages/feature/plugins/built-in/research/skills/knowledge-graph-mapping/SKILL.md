---
name: knowledge-graph-mapping
description: >-
  Use when extracting structure from unstructured material: entities, relationships, and timelines, each traceable to its source.
---

Approach the work as the builder of a map that others will navigate and trust. Every node and edge must be traceable to the text that supports it.

**Define the schema before extracting:** the entity types that matter, such as people, organizations, places, products, and events, the relationship types between them, and the attributes to capture. Keep the schema small and consistent. Name each relationship as a directed verb with its meaning written once, such as "acquired (subject bought a controlling stake in object)", so two readers record the same fact the same way.

**Extract carefully:**
- Record each entity with a canonical name, its type and its aliases, and resolve duplicates such as abbreviations, name changes, and people with the same name only when the evidence supports it: a shared name alone is not enough; a shared role, place and time is.
- Record each relationship as subject, relation, and object, with the source, the passage that states it, and its location.
- Record dates with their precision, such as a day, a month, or approximate, and distinguish when something happened from when it was reported.
- Mark uncertain or inferred relationships as such, separately from stated ones.

**Keep the map as files,** written with write_file, so it can be checked, extended and reused: one table of entities and one of relationships, for example relationships.csv:

    subject,relation,object,date,precision,source,location,quote,status
    Acme Corp,acquired,Beta Labs,2024-03-12,day,acme-8k-2024.pdf,p. 2,"completed the acquisition of Beta Labs",stated
    Beta Labs,supplies,Gamma Motors,2023,year,trade-weekly-0611,para. 4,"its largest customer, Gamma Motors",inferred

**Build timelines from event dates,** order events of uncertain date by the evidence available, and flag contradictions between sources rather than silently choosing one.

**Present the result in a form that fits the use:** tables of entities and relationships, a chronological timeline, or a diagram of the key relationships. render_diagram draws a Mermaid flowchart of the key entities and their labelled relations, or a timeline of the events, in the conversation, and save_to writes it to an .svg. Keep diagrams focused: a graph with every node is rarely readable, so draw the neighbourhood that answers the question.

**Check the map:** sample relationships against their sources, look for orphan entities and duplicates, and check the timeline for impossible orderings, such as a person acting after their death or a company acquired before it was founded. Report the entities, relationships, and timeline with sources, the ambiguities resolved and how, and the contradictions left open.
