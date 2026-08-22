# Bank arrest cluster — rollout and measurement

Release target: `2026-08-23-bank-arrest-cluster-v1`

## Scope

- 23 bank-specific routes for Kazakhstan second-tier banks.
- One bank-arrest hub: `/arest-scheta-v-bankah-kazahstana`.
- Seven distinct high-intent legal routes for source identification, debited funds, social payments, tax restrictions, bank compliance, enforcement documents and sole-proprietor accounts.
- Existing canonical URLs for Kaspi, Halyk and Freedom remain unchanged.

## Release checks

1. Deploy the latest `main` and restart the Node.js application.
2. Confirm `/health` reports the expected release ID.
3. Confirm the hub, one retail bank route, one business-bank route and all seven legal-intent routes return HTTP 200.
4. Confirm `/sitemap-pages.xml` contains the new routes and does not publish a fabricated current-day `lastmod` for unchanged pages.
5. Confirm WhatsApp and checker links work on desktop and mobile.
6. Submit the sitemap after deployment; do not request indexing for every URL manually.

## Measurement windows

Baseline date: 2026-08-23.

- Day 7: crawl discovery and server errors.
- Day 14: indexed URLs, impressions and query coverage.
- Day 28: CTR, average position and qualified WhatsApp leads.
- Day 60: assisted conversions from bank-directory and legal-intent paths.

## Success metrics

- All 31 new routes discovered without canonical conflicts.
- No increase in 5xx or soft-404 coverage issues.
- At least 70% of the bank cluster indexed within 60 days.
- Bank-cluster CTR above 2.5% after meaningful impressions accumulate.
- Every qualified lead records `source_page`, page type and CTA position.

## Guardrails

- Do not create city-by-bank or bank-by-debt-type combinations until Search Console proves demand.
- Do not promise guaranteed removal or fixed universal timelines.
- Do not publish universal private-enforcement percentages.
- Keep bank trademarks nominative and clearly state that ZakonExpert is independent from the banks.
- Expand the cluster only from verified queries, client cases and official-source changes.
