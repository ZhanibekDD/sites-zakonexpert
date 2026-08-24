'use strict';

const assert = require('assert');
const path = require('path');
const ejs = require('ejs');
const { findArchiveDirectory } = require('../modules/notary-archive');

const rows = [
  {
    name: 'ИВАНОВА ИРИНА ИВАНОВНА', slug: 'ivanova-irina', region: 'г. Алматы', active: false,
    archiveFor: [], sourceChamberUrl: 'https://enis.kz/Notary/NotaryByChamber/4',
  },
  {
    name: 'ПЕТРОВА ОЛЬГА СЕРГЕЕВНА', slug: 'petrova-olga', region: 'г. Алматы', active: true,
    archiveFor: ['ИВАНОВОЙ ИРИНЫ ИВАНОВНЫ'], archiveEvidence: 'Передан архив нотариуса ИВАНОВОЙ ИРИНЫ ИВАНОВНЫ',
    sourceChamberUrl: 'https://enis.kz/Notary/NotaryByChamber/4',
  },
  {
    name: 'СИДОРОВ СЕРГЕЙ ПЕТРОВИЧ', slug: 'sidorov-sergey', region: 'Актюбинская область', active: false,
    archiveFor: [], sourceChamberUrl: 'https://enis.kz/Notary/NotaryByChamber/2',
  },
  {
    name: 'КИМ АЛЕКСАНДР ИГОРЕВИЧ', slug: 'kim-alexandr', region: 'Актюбинская область', active: false,
    archiveFor: ['СИДОРОВА СЕРГЕЯ ПЕТРОВИЧА'], archiveEvidence: 'Принят архив нотариуса СИДОРОВА СЕРГЕЯ ПЕТРОВИЧА',
    sourceChamberUrl: 'https://enis.kz/Notary/NotaryByChamber/2',
  },
  {
    name: 'АХМЕТОВА ЖАННА БОЛАТОВНА', slug: 'akhmetova-zhanna', region: 'область Жетысу', active: false,
    archiveFor: [], sourceChamberUrl: 'https://enis.kz/Notary/NotaryByChamber/20',
  },
];

async function main() {
  const directory = findArchiveDirectory(rows, '', { page: 1, limit: 24 });
  assert.strictEqual(directory.summary.totalNotaries, 5);
  assert.strictEqual(directory.summary.inactiveTotal, 4);
  assert.strictEqual(directory.summary.confirmedTransferTotal, 2);
  assert.strictEqual(directory.summary.currentTransferTotal, 1);
  assert.strictEqual(directory.summary.staleTransferTotal, 1);
  assert.strictEqual(directory.summary.unpublishedTotal, 2,
    'inactive archive holder and unrelated inactive notary must remain visible as unpublished');
  assert.deepStrictEqual(directory.unpublished.items.map(item => item.slug).sort(), ['akhmetova-zhanna', 'kim-alexandr']);

  const search = findArchiveDirectory(rows, 'Иванова', { page: 1, limit: 24 });
  assert.strictEqual(search.matchedNotaries.length, 1);
  assert.strictEqual(search.transfers.length, 1);
  assert.strictEqual(search.transfers[0].holder.slug, 'petrova-olga');

  const html = await ejs.renderFile(path.join(__dirname, '..', 'views', 'partials', 'notary-archive-body.ejs'), {
    query: '',
    directory,
    lastUpdated: new Date('2026-08-24T00:00:00+05:00'),
    chambers: [],
  });
  assert(html.includes('Хранитель архива публично не указан'));
  assert(html.includes('Это не подтверждённые «замены»'));
  assert(html.includes('АХМЕТОВА ЖАННА БОЛАТОВНА') || html.includes('Ахметова Жанна Болатовна'));
  assert(html.includes('Палата ЕНИС'));

  console.log('Notary archive directory: OK — confirmed transfers and all inactive unpublished records are separated');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
