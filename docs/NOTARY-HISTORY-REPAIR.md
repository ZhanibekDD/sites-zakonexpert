# Reviewed historical notary profiles

The ENIS snapshot was checked on 2026-10-28 at 18:53 UTC against all 20
notarial chambers. All responses succeeded; the parsed snapshot contains 6,409
records, 20 regions, 4,740 records without an explicit termination marker,
5,861 phone fields and 5,898 email fields. The snapshot in
`registry/notaries.json.gz` includes the source check time and these counts.

Compared with the 6,320-record snapshot generated on 2026-07-19, 68 former
names/licences were not found in the current chamber lists. This is not evidence
that all 68 people stopped practising. A registry refresh previously replaced
the database wholesale, so a disappeared row also removed its public profile.

Five reported broken URLs were reviewed individually. None was present in the
current chamber lists or the official all-region licence search:

| Preserved URL slug | Historical licence | Official chamber |
| --- | --- | --- |
| `balganbaev-erlan-maratovich` | 24034335 | <https://enis.kz/Notary/NotaryByChamber/5> |
| `ismaganbetov-maksut-irguzhaevich` | 24029558 | <https://enis.kz/Notary/NotaryByChamber/5> |
| `fathutdinova-zarina-petrovna` | 24032739 | <https://enis.kz/Notary/NotaryByChamber/7> |
| `bajmuratov-bagdat-karnakbaevich` | 24033404 | <https://enis.kz/Notary/NotaryByChamber/18> |
| `abdihanov-ajdos-nurbolovich` | 24027588 | <https://enis.kz/Notary/NotaryByChamber/9> |

Licence-search pattern:
`https://enis.kz/NotarySearch/Details/?fio=&region=0&city=&phoneNumber=&licenseNumber=24034335`.
The five corresponding searches explicitly returned no matching notary. The
repository's privacy-removal configuration and notary override history contained
no removal instructions for these five entries. Existing company/collector
privacy rules are unchanged.

`config/notary-history.json` retains only the reviewed historical identity,
region, licence number/date, source snapshot time and latest check time. It
does not retain old phone numbers, addresses, email or schedules. The five
fallback pages return 200 with a self-referencing canonical and `noindex,follow`;
they state that the current status is unconfirmed. They do not assert active
practice, termination or an archive successor, and their JSON-LD describes a
historical web page/person rather than an operating LegalService.

A real current database record always takes precedence over a historical
fallback, including a confirmed termination or a noindex record. Explicit
privacy removal suppresses the fallback too. Historical entries are not inserted
into the active directory or sitemap. Other missing names are not automatically
republished.

Public reads and imports now share `modules/notaries-store.js`. This prevents
two independent NeDB instances from retaining different in-memory copies of the
same file. Imported records retain `sourceGeneratedAt`; an older source snapshot
cannot overwrite a datastore with a newer verified source date. Filesystem mtime
is not used to determine freshness. The first deployment contains the freshly
validated snapshot, so it does not restore the old July directory.

Validation: `node scripts/test-notary-history.js` exercises real NeDB import,
already-loaded public reads, stale-snapshot protection, all five HTTP responses,
unknown URL 404, current-record priority, noindex semantics and privacy removal.
It is also run by `npm run test:notaries`.
