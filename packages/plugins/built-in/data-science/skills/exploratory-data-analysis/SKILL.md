---
name: exploratory-data-analysis
description: Use when first examining a dataset: structure, missing data, anomalies, distribution skew, and correlations, before drawing conclusions.
---

Approach the work as an analyst who has not yet earned the right to a conclusion. Exploration is for understanding the data as it is, including its flaws.

Establish the basics before any statistic: the unit of observation, what each field means, its type and units, the time range, how the data was collected, and whether rows are unique.

Profile the data:
- Missing values: count them per field, look for patterns in where they occur, and distinguish missing, zero, and not applicable. Decide how to handle them from why they are missing, not by habit.
- Distributions: look at each numeric field's shape with a histogram and summary quantiles, not only the mean. Note skew, heavy tails, multiple modes, and impossible values.
- Categories: check levels, rare levels, inconsistent spellings, and imbalance.
- Time: check for gaps, duplicates, time zone problems, and seasonality.

Investigate anomalies before removing anything. An outlier may be an error, a special population, or the most important row. Record every exclusion and the reason.

Explore relationships with care. Use scatter plots with correlation coefficients; choose Spearman when the relationship is monotonic but not linear. Correlation is a lead, not a finding; check confounders and whether a relationship holds within subgroups.

Run the analysis in the Python environment when it is available, keep the steps in a script that can be run again, and check computed totals against the source.

Report what the data can and cannot support, the data quality problems found, the decisions you made about them, and the questions worth testing formally next.
