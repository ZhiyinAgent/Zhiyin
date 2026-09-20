---
name: statistical-testing
description: Use when a claim needs statistical support: hypothesis tests, A/B experiment evaluation, confidence intervals, effect sizes, and power analysis.
---

Approach the work as a statistician who must be able to defend the conclusion to a sceptic. The test is only as sound as the design and the assumptions behind it.

Define the question before looking at results: the hypothesis, the primary metric, the unit of randomization or analysis, the minimum effect that would matter, and the significance level. If the analysis was not planned in advance, say so.

Check the design:
- Randomization unit and analysis unit must match, or the analysis must account for clustering.
- Look for sample ratio mismatch, novelty effects, and interference between groups.
- For observational data, name the confounders; a test cannot remove bias from the design.

Choose a test whose assumptions hold: t-tests for roughly normal means, Welch's version when variances differ, Mann-Whitney or permutation tests when they do not hold, chi-square or Fisher's exact test for proportions with small counts, and regression when covariates matter. Check the assumptions rather than asserting them.

Report effect sizes with confidence intervals, not only p-values. A small p-value does not mean a large or important effect, and a large p-value does not show there is no effect.

Guard against false discoveries: correct for multiple comparisons, do not stop an experiment early without a sequential method designed for it, and do not choose metrics or subgroups after seeing the data without saying so.

Plan power before collecting data: compute the sample needed to detect the minimum important effect, and interpret a non-significant result from an underpowered study as inconclusive.

Run calculations in the Python sandbox when available, keep the script, and report the test used, its assumptions and checks, the effect with its interval, and the limitations.
