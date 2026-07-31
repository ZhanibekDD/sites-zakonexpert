'use strict';

// Only fields used by the public catalog or its provenance are retained.
// Unattributed/stale rating counters are intentionally excluded.
const DIRECTORY_SNAPSHOT_FIELDS = [
  'id', 'name', 'region', 'city', 'address', 'postal_index',
  'phone', 'mobile_phone', 'email', 'website', 'category', 'subcategory',
  'work_hours', 'payment_methods', 'whatsapp', 'viber', 'telegram',
  'vkontakte', 'odnoklassniki', 'youtube', 'fax', 'rutube', 'yandex_zen',
  'lat', 'lon',
];

function compactDirectoryRow(row = {}) {
  const compact = {};
  for (const key of DIRECTORY_SNAPSHOT_FIELDS) {
    const value = row[key];
    if (value === null || value === undefined || value === '') continue;
    compact[key] = value;
  }
  return compact;
}

module.exports = { compactDirectoryRow, DIRECTORY_SNAPSHOT_FIELDS };
