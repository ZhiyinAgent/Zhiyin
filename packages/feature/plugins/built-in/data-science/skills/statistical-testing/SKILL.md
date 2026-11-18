---
name: statistical-testing
description: >-
  Use when a claim needs statistical support: hypothesis tests, A/B experiment evaluation, confidence intervals, effect sizes, and power analysis.
---

Approach the work as a statistician who must be able to defend the conclusion to a sceptic. The test is only as sound as the design and the assumptions behind it.

**Define the question before looking at results:** the hypothesis, the primary metric, the unit of randomization or analysis, the minimum effect that would matter, the significance level, and whether the test is one- or two-sided (two-sided unless a direction was fixed in advance). If the analysis was not planned in advance, say so.

**Check the design:**
- Randomization unit and analysis unit must match, or the analysis must account for clustering. Users randomized but page views analysed overstate the evidence.
- Check the sample ratio: the groups' sizes against the split planned, with a chi-square test. A p-value under 0.001 there means the assignment or the logging is broken, and the result cannot be trusted until it is explained.
- Look for novelty effects and interference between groups.
- For observational data, name the confounders; a test cannot remove bias from the design.

**Choose a test whose assumptions hold:** t-tests for roughly normal means, Welch's version when variances differ (and by default, as it costs little when they do not), Mann-Whitney or permutation tests when they do not hold, chi-square or Fisher's exact test for proportions with small counts, and regression when covariates matter. A ratio metric, such as revenue per session when users are randomized, needs the delta method or a bootstrap over users. Check the assumptions rather than asserting them.

**Report effect sizes with confidence intervals,** not only p-values. A small p-value does not mean a large or important effect, and a large p-value does not show there is no effect. Say whether the interval excludes the smallest effect that would matter, not only zero.

**Guard against false discoveries:** correct for multiple comparisons (Holm for a few planned tests, Benjamini-Hochberg when many are screened), do not stop an experiment early without a sequential method designed for it, and do not choose metrics or subgroups after seeing the data without saying so.

**Plan power before collecting data:** compute the sample needed to detect the minimum important effect, and interpret a non-significant result from an underpowered study as inconclusive. A significant result from an underpowered study tends to overstate the effect; say so.

**Run the calculations with run_python,** whose default environment has SciPy and statsmodels, keep the script in the workspace, and show the person the distributions with render_histogram or render_box_plot. For example, an A/B test of a conversion rate, checked in SciPy 1.18 and statsmodels 0.15:

    from scipy import stats
    from statsmodels.stats.power import NormalIndPower
    from statsmodels.stats.proportion import (
        confint_proportions_2indep, proportion_effectsize, proportions_ztest)

    users = [10_120, 9_880]  # control, variant, as assigned
    converted = [412, 468]
    print(stats.chisquare(users).pvalue)  # sample ratio: 0.09, no mismatch
    low, high = confint_proportions_2indep(converted[1], users[1], converted[0], users[0])
    z, p = proportions_ztest(converted[::-1], users[::-1])
    effect = proportion_effectsize(0.045, 0.040)
    print(NormalIndPower().solve_power(effect_size=effect, alpha=0.05, power=0.8))

The variant converts 0.67 points more (95% interval 0.10 to 1.24 points, p = 0.022), but detecting a lift from 4.0% to 4.5% at 80% power needs about 25,500 users a group: with about 10,000 the study was underpowered, so the true lift is likely smaller than measured. Other tools: stats.ttest_ind(a, b, equal_var=False) for Welch's test, stats.mannwhitneyu, stats.fisher_exact, stats.permutation_test, stats.bootstrap for an interval of any statistic, and statsmodels.stats.multitest.multipletests(pvals, method="holm") or method="fdr_bh".

**Report** the test used, its assumptions and checks, the effect with its interval, the power, and the limitations. The data-science/insights-synthesizer specialist can write it up for a decision-maker without overstating it.
