---
name: exploratory-data-analysis
description: >-
  Use when first examining a dataset: structure, missing data, anomalies, distribution skew, and correlations, before drawing conclusions.
---

Approach the work as an analyst who has not yet earned the right to a conclusion. Exploration is for understanding the data as it is, including its flaws.

**Work in a script, never on the original.** Run the analysis with run_python, in the default environment, which has pandas, polars, NumPy, SciPy, Matplotlib, seaborn and statsmodels, and openpyxl for Excel workbooks. Keep the steps in a .py file in the workspace that can be run again from the raw file to the result. Read the original file and never write over it: write cleaned or derived data to a new file. Each run starts fresh, so a later run reads what an earlier one saved rather than what it held in memory.

**Establish the basics before any statistic:** the unit of observation, what each field means, its type and units, the time range, how the data was collected, and whether rows are unique on the key that should identify them. Ask the person, with ask_user, what a field means when its name and values leave it open and the answer would change the analysis.

**Profile the data.** A first pass, for example:

    import pandas as pd
    df = pd.read_csv("data/orders.csv")
    print(df.shape, df.dtypes, sep="\n")
    print(df.isna().sum())
    print(df.duplicated(subset=["order_id"]).sum(), "repeated order ids")
    print(df.describe(percentiles=[0.01, 0.5, 0.99]))
    print(df["status"].value_counts(dropna=False))

Then look at each kind of field:
- Missing values: count them per field, look for patterns in where they occur, and distinguish missing, zero, and not applicable. Decide how to handle them from why they are missing, not by habit.
- Distributions: look at each numeric field's shape with a histogram and summary quantiles, not only the mean. Note skew, heavy tails, multiple modes, and impossible values, such as a negative amount or a date in the future. A field that spans several orders of magnitude reads better on a log scale.
- Categories: check levels, rare levels, inconsistent spellings, and imbalance.
- Time: check for gaps, duplicates, time zone problems, and seasonality.
- Totals: check row counts and sums against the source, such as the number of orders the system reports for a month.

**Look at the data, not only its summaries.** Very different data can share the same means, variances and correlation. Draw the distributions and relationships: render_histogram, render_box_plot and render_scatter_plot show them to the person in the conversation; for your own looking, a Matplotlib figure saved with savefig to a PNG and opened with read_document.

**Investigate anomalies before removing anything.** An outlier may be an error, a special population, or the most important row. Record every exclusion and the reason, with the number of rows it removed. Messy encodings, malformed records, mixed schemas or time zones can be handed to the data-science/data-cleansing-specialist specialist.

**Explore relationships with care.** Use scatter plots with correlation coefficients; choose Spearman when the relationship is monotonic but not linear. Correlation is a lead, not a finding: check confounders, whether a relationship holds within subgroups, and whether it reverses when the data is split, as aggregated data can. Ask how the rows came to be in the data: a sample of survivors, responders or customers who stayed shows a different picture from the whole.

**Report** what the data can and cannot support, the data quality problems found, the decisions you made about them, where the script and any derived files are, and the questions worth testing formally next (skill:data-science/statistical-testing).
