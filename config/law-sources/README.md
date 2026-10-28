# UPK content repair

`upk-rk-repair-2026-10-28.json` is a reviewed snapshot of the Russian UPK
returned by the public API used by Adilet's current website:

- https://adilet.zan.kz/rus/docs/K1400000231
- https://adilet.zan.kz/api/documents/by-ngr/K1400000231?language=rus
- https://adilet.zan.kz/api/documents/3fa92bc8-0760-4b9f-9034-e04b39f0bf41/versions?page=1&page_size=500

The API marked this document `is_actual: true`; its versions endpoint marked
the same document ID `is_current: true`. `endDate` retains the API's `end_date`
and `sourceUpdatedAt` retains its `updated_at` verbatim. API dates are source
metadata, not a claim about the effective date of every provision. Official
amendment notes, including future-effective annotations, remain in the text.

The full downloaded HTML is preserved losslessly in
`scripts/fixtures/adilet-upk-2026-10-28.html.gz`. The snapshot records its SHA256,
retrieval time, document ID and a separate fingerprint of all parsed articles.
The regression test reproduces every bundled article from that HTML.

The current official HTML contains 686 article headings, including 310 missing
from the old database. It omits 448–469 and states that former chapter 50 was
removed; this repair does not create substitute articles for that gap.

On initialization `modules/laws-db.js` uses its own existing NeDB writer to
repair only two observed failure signatures: a body consisting solely of a
different article's heading, and article 674 containing the Adilet page footer.
It inserts missing snapshot articles, preserves existing IDs and unrelated
fields, leaves healthy/manual content and other codes unchanged, and waits
before serving law reads. A second initialization makes no content writes.
All snapshot validation runs before writes. A failure is logged and law reads
reject instead of exposing an incompletely initialized store.

Run `npm run test:laws`. The test uses temporary databases only. Never run a
separate NeDB importer against the live Passenger database. Future explicit
`scrape-laws-upk` imports use the official JSON endpoint and the strict parser;
they must run with the normal application writer stopped, as any offline import.
