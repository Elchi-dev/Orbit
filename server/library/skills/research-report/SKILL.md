---
name: research-report
description: Use when asked to research a question across several sources and write up the findings, such as a comparison, a market or technology scan, a fact check, or a briefing with citations.
---

# Research Report

Your job is a report the reader can act on and verify. Every claim traces to a source they can open. The answer comes first.

## 1. Frame the question

Before searching, write down:

- **The main question**, in one sentence. If the request is vague ("look into vector databases"), restate it as a decision or a question ("Which vector database fits a 10M-row, self-hosted, Postgres shop?") and say so in the report.
- **Three to seven sub-questions** whose answers together answer the main one. Example for "Should we move CI to self-hosted runners?": cost per build minute today vs self-hosted; maintenance effort; security exposure; build speed; who has done it and what they reported.
- **What would change the answer.** Name the facts that would flip the conclusion. Search hardest for those.
- **Time sensitivity.** Decide how old a source can be before it is useless. Pricing, versions, laws, and market share go stale in months. Concepts and history do not.

If the scope is ambiguous in a way that changes the work (country, budget, audience), ask one short question before you start. Otherwise state your assumption and proceed.

## 2. Search wide, then deep

**Wide pass.** For each sub-question, run several searches with different wording, including the terms an expert would use and the terms a critic would use ("X problems", "X vs Y", "migrated away from X"). Skim results; collect candidate sources. Do not read deeply yet.

**Deep pass.** Open the best candidates and read the relevant sections in full. Follow links from secondary sources to the primary source they cite. Stop a sub-question when new sources only repeat what you have.

Source preference, best first:

1. Primary: the official documentation, specification, standard, statute, filing, dataset, changelog, or the paper itself.
2. Direct reports from people who did the thing: engineering blogs, post-mortems, conference talks with data.
3. Reputable secondary sources with named authors and their own reporting.
4. Aggregators, listicles, vendor comparison pages, anonymous forum posts. Use these only to find leads, never as the sole support for a claim.

Treat a vendor's claims about its own product as claims, not facts. A benchmark published by the winner needs independent confirmation.

## 3. Check every source

For each source you will cite, check quickly:

- **Who** wrote it and what they gain if you believe it. Read about the source from other sites, not from its own About page.
- **When** it was published or last updated. Note the date. If a fact may have changed since, look for a newer source or flag it.
- **What it actually says.** Quote or paraphrase the specific passage. Do not cite a page for something it only implies.
- **Where the claim originated.** If five articles repeat one number, trace it to the original and cite that.

## 4. Triangulate

- A key claim (one the conclusion depends on) needs two independent sources, or one primary source.
- When sources disagree, report the disagreement, give each side's source, and say which you find stronger and why (newer, primary, larger sample, no conflict of interest).
- Numbers: record the unit, date, and population. "40% faster" means nothing without "than what, measured how, on what workload".
- If you cannot verify something important, say so plainly rather than dropping it or stating it as fact.

## 5. Separate known from claimed

Use wording that tells the reader how solid each statement is:

| Status | Wording |
| --- | --- |
| Verified in primary sources | "X supports Y ([docs](link))." |
| Reported, not independently verified | "The vendor states that... ([link])" / "According to a 2025 survey by..." |
| Contested | "Sources disagree: A reports..., B reports..." |
| Your inference | "This suggests...", "Likely, because..." |
| Unknown | "No public data found on..." |

Never upgrade a claim's status in the summary. If the body says "the vendor states", the summary cannot say "X is".

## 6. Write the report

Use this structure unless the user asked for another:

```markdown
# <Question as a title>

**Answer:** <2 to 5 sentences. The direct answer, the main reason, and the confidence level.>

## Key findings
- <Finding, with the number or fact that supports it> ([Source](url), 2026-03)
- ...

## Evidence
### <Sub-question 1>
<Short paragraphs or a table. Cite inline after each claim.>
### <Sub-question 2>
...

## Comparison (if comparing options)
| Criterion | Option A | Option B |

## Open questions and caveats
- <What you could not verify, what may change soon, what depends on the reader's situation>

## Sources
1. <Title>, <publisher>, <date>. <url>
```

Writing rules:

- Cite every factual claim with an inline Markdown link to the specific page, not the site's home page. One link per claim is enough; put it right after the claim.
- Put dates on time-sensitive facts: "as of September 2026", "pricing page checked 2026-10-23".
- Lead each section with its conclusion, then the support.
- Use tables for comparisons across more than two criteria.
- Keep the answer section free of hedging beyond one clear confidence statement ("High confidence", "Moderate: based on two vendor reports and no independent benchmark").
- Do not pad. If a sub-question turned out not to matter, drop it or give it one line.
- Write the report into a document (the doc editor or a Markdown file) when it runs longer than a screen; give a short summary in chat with a pointer to it.

## Decision rules

- If the evidence is too thin to answer, say that is the finding, then give the best partial answer and what would settle it.
- If the user's premise is wrong ("why is X deprecated?" when it is not), say so first, with the source.
- If a source is paywalled and you only saw the abstract or snippet, cite it as such and do not claim details you did not read.
- Prefer fewer, stronger sources over many weak ones.

## Before you call it done

- [ ] The first paragraph answers the question that was asked.
- [ ] Every factual claim has a working link to a page that actually supports it.
- [ ] Key claims rest on a primary source or two independent ones.
- [ ] Time-sensitive facts carry a date, and you checked none are stale.
- [ ] Vendor and self-reported claims are labelled as claims.
- [ ] Disagreements between sources are reported, not hidden.
- [ ] Open questions and assumptions are listed.
- [ ] Numbers carry units, dates, and what they compare against.
- [ ] You reread the summary against the body: no claim got stronger on the way up.
