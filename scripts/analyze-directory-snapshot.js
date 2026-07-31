'use strict';

// Full source-quality inventory for the compact business-directory snapshot.
// This is an offline/dev audit: it deliberately keeps aggregate key sets in
// memory, while the production importer remains strictly batch-streaming.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { normalizeCompanyName } = require('../modules/company-name-normalize');
const { normalizeDirectoryRow } = require('../modules/company-details-normalize');
const { detectRegionFromParts } = require('../modules/company-region');
const {
  readSnapshotRows,
  verifySnapshot,
} = require('./import-directory-contacts');

const ROOT = path.join(__dirname, '..');
const DEFAULT_SNAPSHOT = path.join(ROOT, 'registry', 'companies-directory-contacts.ndjson.gz');
const DEFAULT_MANIFEST = path.join(ROOT, 'registry', 'companies-directory-contacts.manifest.json');

function parseArgs(argv) {
  const value = prefix => argv.find(argument => argument.startsWith(prefix))?.slice(prefix.length);
  return {
    snapshot: value('--snapshot=') || DEFAULT_SNAPSHOT,
    out: value('--out=') || DEFAULT_MANIFEST,
  };
}

function increment(object, key, amount = 1) {
  object[key] = (object[key] || 0) + amount;
}

function topEntries(object, limit = 25) {
  return Object.fromEntries(
    Object.entries(object)
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], 'ru'))
      .slice(0, limit)
  );
}

async function run(options = parseArgs(process.argv.slice(2))) {
  const snapshot = await verifySnapshot(options.snapshot, '/nonexistent-manifest');
  const fieldCounts = {};
  const contactTypeCounts = {};
  const rawContactFieldCounts = {};
  const invalidContactFieldCounts = {};
  const regions = {};
  const categories = {};
  const sourceIds = new Map();
  const nameRegionCounts = new Map();
  const exactRows = new Set();
  let recordCount = 0;
  let invalidJsonCount = 0;
  let missingNameCount = 0;
  let duplicateSourceIdCount = 0;
  let inconsistentSourceIdCount = 0;
  let exactDuplicateCount = 0;
  let addressCount = 0;
  let addressWithEmbeddedContactCount = 0;
  let decompressedSizeBytes = 0;
  let invalidCoordinateCount = 0;

  for await (const record of readSnapshotRows(options.snapshot)) {
    recordCount += 1;
    decompressedSizeBytes += Buffer.byteLength(record.line, 'utf8') + 1;
    if (record.error || !record.row) {
      invalidJsonCount += 1;
      continue;
    }

    for (const [key, value] of Object.entries(record.row)) {
      if (value !== null && value !== undefined && value !== '') increment(fieldCounts, key);
    }
    const normalized = normalizeDirectoryRow(record.row);
    if (!normalized.name) missingNameCount += 1;
    if (normalized.address) addressCount += 1;
    if (/(?:тел(?:ефон)?|факс)\s*[:.]?/iu.test(String(record.row.address || ''))) {
      addressWithEmbeddedContactCount += 1;
    }
    if ((record.row.lat && normalized.latitude === null)
        || (record.row.lon && normalized.longitude === null)) {
      invalidCoordinateCount += 1;
    }

    for (const type of [
      'phone', 'mobile_phone', 'email', 'website', 'whatsapp', 'viber', 'telegram', 'fax',
      'vkontakte', 'odnoklassniki', 'youtube', 'rutube', 'yandex_zen',
    ]) {
      if (!record.row[type]) continue;
      increment(rawContactFieldCounts, type);
      if (!normalized.contacts.some(contact => contact.type === type)) {
        increment(invalidContactFieldCounts, type);
      }
    }
    for (const contact of normalized.contacts) increment(contactTypeCounts, contact.type);

    const regionSlug = detectRegionFromParts({
      region: normalized.region,
      city: normalized.city,
      address: normalized.address,
    }) || 'unknown';
    increment(regions, regionSlug);
    if (normalized.category) increment(categories, normalized.category);

    const normalizedName = normalizeCompanyName(normalized.name);
    const nameRegionKey = `${normalizedName}|${regionSlug}`;
    nameRegionCounts.set(nameRegionKey, (nameRegionCounts.get(nameRegionKey) || 0) + 1);

    const shortHash = crypto.createHash('sha256').update(record.line).digest('hex').slice(0, 20);
    if (exactRows.has(shortHash)) exactDuplicateCount += 1;
    else exactRows.add(shortHash);

    const externalId = normalized.externalId || `sha256:${shortHash}`;
    const signature = `${normalizedName}|${regionSlug}`;
    const previous = sourceIds.get(externalId);
    if (previous) {
      duplicateSourceIdCount += 1;
      if (previous !== signature) inconsistentSourceIdCount += 1;
    } else {
      sourceIds.set(externalId, signature);
    }
  }

  let duplicateNameRegionGroupCount = 0;
  let duplicateNameRegionRowCount = 0;
  for (const count of nameRegionCounts.values()) {
    if (count <= 1) continue;
    duplicateNameRegionGroupCount += 1;
    duplicateNameRegionRowCount += count - 1;
  }

  const report = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    source: {
      source_key: 'business_directory_kz_2026',
      type: 'user_supplied_business_directory_export',
      rights_status: 'user_supplied_underlying_provider_license_not_recorded',
      original_archives: [
        {
          name: 'Казахстан.zip',
          reported_size: 'approximately 88 MiB',
          sha256: null,
          retained: false,
          note: 'Raw archive was intentionally excluded from Git and production hosting.',
        },
        {
          name: 'Казахстан.rar',
          reported_size: 'approximately 59 MiB',
          sha256: null,
          retained: false,
          note: 'Alternative packaging of the same supplied dataset; raw checksum is unavailable.',
        },
      ],
    },
    snapshot: {
      path: path.relative(ROOT, options.snapshot),
      format: 'ndjson+gzip',
      sha256: snapshot.checksum,
      compressed_size_bytes: fs.statSync(options.snapshot).size,
      uncompressed_size_bytes: decompressedSizeBytes,
      record_count: recordCount,
      invalid_json_count: invalidJsonCount,
      missing_name_count: missingNameCount,
      unique_source_id_count: sourceIds.size,
      duplicate_source_id_row_count: duplicateSourceIdCount,
      inconsistent_source_id_row_count: inconsistentSourceIdCount,
      exact_duplicate_row_count: exactDuplicateCount,
      duplicate_name_region_group_count: duplicateNameRegionGroupCount,
      duplicate_name_region_row_count: duplicateNameRegionRowCount,
      address_count: addressCount,
      address_with_embedded_contact_count: addressWithEmbeddedContactCount,
      invalid_coordinate_row_count: invalidCoordinateCount,
      non_empty_field_counts: Object.fromEntries(
        Object.entries(fieldCounts).sort((left, right) => left[0].localeCompare(right[0], 'en'))
      ),
      normalized_contact_counts: Object.fromEntries(
        Object.entries(contactTypeCounts).sort((left, right) => left[0].localeCompare(right[0], 'en'))
      ),
      raw_contact_field_counts: rawContactFieldCounts,
      invalid_contact_field_counts: invalidContactFieldCounts,
      region_counts: topEntries(regions, 30),
      unique_category_count: Object.keys(categories).length,
      top_categories: topEntries(categories, 40),
    },
    import_policy: {
      primary_match: 'exact official BIN when available, then stable source ID',
      secondary_match: 'exact normalized name plus compatible region/address',
      fuzzy_matching: 'review candidates only; never auto-merged',
      source_priority: [
        'verified_override',
        'official_registry',
        'official_organization_website',
        'business_directory_export',
      ],
      directory_only_records_indexable: false,
      rating_fields_retained: false,
      note: 'Unattributed ratings are removed; no contact, address, translation, or identifier is invented.',
    },
  };
  fs.writeFileSync(options.out, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(report.snapshot, null, 2));
  console.log(`[Audit] Manifest written to ${options.out}`);
  return report;
}

if (require.main === module) {
  run().catch(error => {
    console.error('[Audit] Failed:', error.message);
    process.exitCode = 1;
  });
}

module.exports = { parseArgs, run };
