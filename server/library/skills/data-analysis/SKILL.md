---
name: data-analysis
description: Use when asked to analyse a CSV, spreadsheet, JSON file or database export: answering questions about the data, finding trends, summarising, comparing groups, or charting it.
---

# Data Analysis

Every number you report comes from code you ran on the data. You never estimate, round from memory, or eyeball a figure in prose.

## 1. Clarify the question

- Restate the question as something computable: "Which region grew revenue fastest in 2025?" becomes "sum of `amount` by `region` and quarter, growth Q1 to Q4".
- Note what you need to define: what counts as a customer, active, revenue (gross or net), the time window, the time zone.
- If a definition changes the answer materially and you cannot infer it, ask. Otherwise pick the most reasonable one and state it.

## 2. Load and inspect before analysing

Work in a script (Python with pandas, or DuckDB / SQLite for large files or SQL-shaped questions). Save it in the working folder so it can be rerun.

Inspect first, and look at the output:

```python
import pandas as pd
df = pd.read_csv("sales.csv")
print(df.shape)
print(df.dtypes)
print(df.head(10))
print(df.isna().sum())
print(df.describe(include="all").T)
print(df.duplicated().sum())
```

Check, and write down what you find:

- **Shape**: row count matches what the user expects? A file truncated at 65,536 or 1,048,576 rows came from a spreadsheet limit.
- **Header and encoding**: the real header row, extra title rows, footer totals, a BOM, `;` vs `,` separators, decimal commas.
- **Types**: numbers stored as text (`"1,234"`, `"$5"`, `"12%"`), dates as strings, IDs read as numbers (leading zeros lost).
- **Missing values**: count per column, and the disguised ones: `""`, `"N/A"`, `"-"`, `0`, `1900-01-01`, `9999`.
- **Duplicates**: exact duplicate rows and duplicate keys (same order ID twice).
- **Ranges and categories**: negative quantities, future dates, outliers, inconsistent labels (`"UK"`, `"U.K."`, `"United Kingdom"`).
- **Grain**: what one row represents (an order, an order line, a daily snapshot). Summing snapshots double counts.

For spreadsheets, list the sheets first and check for merged cells, hidden rows, and formulas whose cached values may be stale.

## 3. Clean explicitly

- Do each fix in code, with a comment, and print how many rows it touched.
- Never silently drop rows. Report: "Dropped 37 rows with no `order_id` (0.4%)."
- Keep the raw data unchanged; write cleaned output to a new file if you save it.
- Parse dates with an explicit format and time zone.

## 4. Compute in code

- Every figure in your answer is printed by the script. Copy numbers from the output, do not retype or recompute them mentally.
- Prefer simple, explainable methods: counts, sums, means and medians, group-bys, percentages, year-over-year change. Use medians for skewed values like income, latency, order size.
- Report the denominator with every percentage: "18% (412 of 2,290 orders)".
- For comparisons between groups, show group sizes. Flag groups too small to support a conclusion.
- Do not claim causation from observational data. Say "associated with".
- If you use a statistical test or regression, say which one, why, and what its assumptions are, in one or two lines.

## 5. Check your totals

Before reporting:

- Sum of group totals equals the overall total.
- Row counts before and after each join and filter are what you expect. A join that increases rows means duplicate keys.
- Spot-check two or three individual records by hand against the raw file.
- If the data includes its own totals (a summary row, a figure the user quoted), reconcile with it and explain any difference.
- Sanity-check magnitude: a 4,000% growth rate or an average age of 212 is a data problem until proven otherwise.

## 6. Chart only when it helps

- Line for change over time. Bar (horizontal if labels are long) for comparing categories. Histogram or box plot for distributions. Scatter for the relationship between two numeric variables.
- Avoid pie charts beyond three slices, 3D, dual y-axes, and stacked bars with many segments.
- Bars start at zero. Label axes with units. Title states the finding: "Returns doubled after the March price change", not "Returns by month".
- Sort categorical bars by value unless the categories have a natural order.
- Save charts as PNG files next to the script and reference them in the answer. Keep to one to three charts.

## 7. Deliver

Shape the answer like this:

```markdown
**Answer:** The North region grew fastest: revenue up 31% from Q1 to Q4 2025 ($1.20M to $1.57M).

- West: +12%, South: +4%, East: -3%.
- North's growth came mostly from two new accounts (62% of the increase).

**Assumptions:** revenue is `amount` net of refunds; dates in UTC; 37 rows without region excluded.
**Data issues:** 12 duplicate order IDs removed; `discount` is empty before March.
**Files:** `analysis.py` (rerun with `python analysis.py`), `growth_by_region.png`.
```

- Lead with the direct answer and its key number.
- Then two to five supporting points.
- Then assumptions, data quality caveats, and the files.
- Include the code or point to the saved script so the result can be reproduced.
- Round sensibly for reading (two or three significant figures), but keep exact values in the output tables.

## Before you call it done

- [ ] You inspected shape, types, missing values, duplicates, and grain before analysing.
- [ ] Every cleaning step is in code and its row impact is reported.
- [ ] Every number in the answer appears in the script's output.
- [ ] Group totals reconcile with the overall total; joins did not inflate rows.
- [ ] Percentages carry denominators; small groups are flagged.
- [ ] Charts have labelled axes with units, zero-based bars, and a finding as the title.
- [ ] Assumptions and definitions are stated.
- [ ] The script is saved and reruns from scratch.
- [ ] The answer opens with the direct answer to the question asked.
