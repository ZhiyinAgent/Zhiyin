---
name: dashboard-design
description: >-
  Use when designing dashboards or charts: visual hierarchy, choosing chart types for distributions and time series, and telling an honest story with data.
---

Approach the work as the designer of a dashboard someone will make decisions from. Every chart must answer a question its reader actually has, at a glance, without misleading.

**Start from the reader:** who uses the dashboard, the decisions they make, and how often. Put the few numbers that drive those decisions at the top, and supporting detail below.

**Define every metric before drawing it:** its name, its formula with numerator and denominator, the filters and time window, the unit, and where the data comes from. Two charts that show "active users" must mean the same thing. Write the definitions where the reader can find them, under the chart or in a notes panel.

**Choose the chart for the data and the comparison:**
- Change over time: line charts, with a consistent time axis and a clear marker for incomplete periods, such as the current week.
- Comparing categories: bar charts sorted by value, with a zero baseline.
- Distributions: histograms, box plots, or strip plots, not a single average.
- Part-to-whole: stacked bars, and a pie chart only for two or three parts.
- Relationships: scatter plots.
- Many series or groups: small multiples on shared axes rather than one crowded chart.

Avoid dual axes, 3D effects, and truncated bar axes, which distort comparisons. A line chart may start above zero when the change is what matters; say so on the axis.

**Draw each chart with the chart tools,** which show it in the conversation and say what the drawing decided: render_line_chart, render_bar_chart, render_scatter_plot, render_histogram and render_box_plot. Give each its xLabel, yLabel and unit. A chart that goes into a file or a document is drawn the same way with save_to, an .svg path, so the file is the chart the person saw rather than one drawn again another way.
- Each tool has limits: a line chart takes up to 8 series of 500 points, a scatter plot up to 8 series of 1000, a bar chart 100 categories, a histogram 2000 values in up to 50 bins, a box plot 40 groups of 1000 values. Aggregate or sample larger data with run_python first, and say what was left out in omitted, which is shown under the chart.
- The bar chart draws one series. Stacked or grouped bars, and anything else the tools do not draw, are made with Matplotlib or seaborn in run_python, saved with savefig, and looked at with read_document before they are shown.

**Build a clear hierarchy:** consistent sizes and alignment, direct labels instead of legends where possible, units and time ranges on every chart, the same scale on charts meant to be compared, and whitespace that groups related charts.

**Use colour with purpose:** one accent for what matters and neutral tones for context, palettes that remain distinguishable for colour-blind readers, and meaning that never depends on colour alone. More than six or seven colours in one chart cannot be told apart; group or label instead.

**Tell the story honestly.**
- Give each chart a title that states the takeaway, such as "Weekly sign-ups fell 18% after the price change", not "Sign-ups".
- Show comparisons against a target or baseline, include the denominator for every rate, and show the number of observations behind an average or a rate where it is small.
- Annotate known events that explain a change.

**Verify before handing over:** check each number against the source with a query or a script, check the dashboard at the sizes it will be viewed, and report the data sources, refresh timing, the metric definitions and any known limitation of the figures. The data-science/insights-synthesizer specialist can turn the findings into a summary for a decision-maker.
