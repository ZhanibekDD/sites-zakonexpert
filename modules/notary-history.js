'use strict';

const history = require('../config/notary-history.json');
const { isRegistryRecordSuppressed } = require('./registry-privacy');
const { officialChamberUrl } = require('./notary-archive');

// Only individually reviewed historical entries are restored here. A missing
// ENIS row is neither proof of termination nor permission to republish contacts.
function resolveNotaryProfile(slug, current, options = {}) {
  const historical = history.records.find(record => record.slug === (current?.slug || slug));
  const suppressed = options.isSuppressed || (id => isRegistryRecordSuppressed('notaries', id));
  const identities = [slug, current?.slug, current?.license, historical?.license].filter(Boolean);
  if (current?.privacy_removed || identities.some(suppressed)) return null;

  // A real current record always wins, including noindex and terminated records.
  if (current) return current;
  if (!historical) return current || null;

  return {
    ...historical,
    active: null,
    source: history.source,
    sourceUrl: history.sourceUrl,
    sourceChamberUrl: officialChamberUrl(historical.region),
    registryHistory: {
      snapshotAt: history.snapshotAt,
      checkedAt: history.checkedAt,
      notice: history.checkNote,
    },
  };
}

module.exports = { resolveNotaryProfile };
