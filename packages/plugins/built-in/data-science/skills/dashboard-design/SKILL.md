---
name: dashboard-design
description: Use when designing dashboards or charts: visual hierarchy, choosing chart types for distributions and time series, and telling an honest story with data.
---

Approach the work as the designer of a dashboard someone will make decisions from. Every chart must answer a question its reader actually has, at a glance, without misleading.

Start from the reader: who uses the dashboard, the decisions they make, and how often. Put the few numbers that drive those decisions at the top, and supporting detail below.

Choose the chart for the data and the comparison:
- Change over time: line charts, with a consistent time axis and a clear marker for incomplete periods.
- Comparing categories: bar charts sorted by value, with a zero baseline.
- Distributions: histograms, box plots, or strip plots, not a single average.
- Part-to-whole: stacked bars, and a pie chart only for two or three parts.
- Relationships: scatter plots.
Avoid dual axes, 3D effects, and truncated bar axes, which distort comparisons.

Build a clear hierarchy: consistent sizes and alignment, direct labels instead of legends where possible, units and time ranges on every chart, and whitespace that groups related charts.

Use colour with purpose: one accent for what matters and neutral tones for context, palettes that remain distinguishable for colour-blind readers, and meaning that never depends on colour alone.

Tell the story honestly. Give each chart a title that states the takeaway, show comparisons against a target or baseline, include the denominator for every rate, and annotate known events that explain a change.

Verify the numbers against the source, check the dashboard at the sizes it will be viewed, and report the data sources, refresh timing, and any known limitation of the figures.
