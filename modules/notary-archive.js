'use strict';

const CHAMBER_IDS = new Map([
  ['акмолинская область', 1],
  ['актюбинская область', 2],
  ['алматинская область', 3],
  ['город алматы', 4],
  ['г. алматы', 4],
  ['город астана', 5],
  ['г. астана', 5],
  ['атырауская область', 6],
  ['восточно-казахстанская область', 7],
  ['жамбылская область', 8],
  ['западно-казахстанская область', 9],
  ['карагандинская область', 10],
  ['кызылординская область', 11],
  ['костанайская область', 12],
  ['мангистауская область', 13],
  ['павлодарская область', 14],
  ['северо-казахстанская область', 15],
  ['город шымкент', 16],
  ['г. шымкент', 16],
  ['туркестанская область', 18],
  ['область абай', 19],
  ['абайская область', 19],
  ['область жетісу', 20],
  ['область жетысу', 20],
  ['жетысуская область', 20],
  ['область ұлытау', 21],
  ['область улытау', 21],
  ['улытауская область', 21],
]);

function clean(value) {
  return String(value || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalizeRegionKey(value) {
  return clean(value).toLocaleLowerCase('ru-RU').replace(/ё/g, 'е');
}

function officialChamberUrl(region) {
  const chamberId = CHAMBER_IDS.get(normalizeRegionKey(region));
  return chamberId ? `https://enis.kz/Notary/NotaryByChamber/${chamberId}` : 'https://enis.kz/NotarySearch';
}

function normalizeName(value) {
  return clean(value)
    .toLocaleUpperCase('ru-RU')
    .replace(/Ё/g, 'Е')
    .replace(/[^0-9A-ZА-ЯӘҒҚҢӨҰҮҺІ\s-]/giu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function nameTokens(value) {
  return normalizeName(value).split(/[\s-]+/).filter(token => token.length >= 3);
}

function tokenLikelyMatches(left, right) {
  const size = Math.min(6, left.length, right.length);
  return size >= 3 && left.slice(0, size) === right.slice(0, size);
}

function nameLikelyMatches(query, candidate) {
  const queryTokens = nameTokens(query);
  const candidateTokens = nameTokens(candidate);
  if (queryTokens.length === 0 || candidateTokens.length === 0) return false;
  return queryTokens.every(queryToken => candidateTokens.some(candidateToken => tokenLikelyMatches(queryToken, candidateToken)));
}

function extractArchiveTransfer(schedule) {
  const value = clean(schedule);
  if (!value || !/архив/i.test(value) || !/(?:передан|принят)/i.test(value)) {
    return { names: [], evidence: '' };
  }

  const match = value.match(
    /((?:передан(?:а|ы)?|принят(?:а|ы)?)\s+(?:на\s+хранение\s+)?(?:архив(?:ный|ные)?\s+(?:материал(?:ы)?|документ(?:ы)?)?|архив)\s+(?:частного\s+)?нотариус(?:а|ов)\s+(.+))$/iu,
  );
  if (!match) return { names: [], evidence: '' };

  const names = match[2]
    .split(/\s*(?:;|\/|,\s*(?=нотариус))\s*|\s+и\s+(?=нотариус)/iu)
    .map(part => clean(part).replace(/^нотариус(?:а|ов)?\s+/iu, '').replace(/[.,;:]+$/g, ''))
    .filter(name => nameTokens(name).length >= 2 && name.length <= 160);

  return {
    names: [...new Map(names.map(name => [normalizeName(name), name])).values()],
    evidence: match[1],
  };
}

function buildArchiveTransfers(rows) {
  const transfers = [];
  const seen = new Set();

  for (const holder of rows) {
    const archiveFor = Array.isArray(holder.archiveFor) ? holder.archiveFor : [];
    for (const sourceName of archiveFor) {
      const sourceNotary = rows.find(item => (
        normalizeRegionKey(item.region) === normalizeRegionKey(holder.region)
        && nameLikelyMatches(sourceName, item.name)
      )) || null;
      const key = `${normalizeName(sourceName)}|${holder.slug || normalizeName(holder.name)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      transfers.push({
        sourceName,
        sourceNotary,
        holder,
        current: holder.active !== false,
        evidence: holder.archiveEvidence || holder.schedule || '',
        sourceUrl: holder.sourceChamberUrl || officialChamberUrl(holder.region),
      });
    }
  }

  transfers.sort((left, right) => Number(right.current) - Number(left.current)
    || normalizeName(left.sourceName).localeCompare(normalizeName(right.sourceName), 'ru'));
  return transfers;
}

function transferBelongsToNotary(transfer, notary) {
  if (!transfer || !notary) return false;
  if (transfer.sourceNotary && transfer.sourceNotary.slug && transfer.sourceNotary.slug === notary.slug) return true;
  return normalizeRegionKey(transfer.holder?.region) === normalizeRegionKey(notary.region)
    && nameLikelyMatches(transfer.sourceName, notary.name);
}

function findArchiveDirectory(notaries, query = '', options = {}) {
  const rows = Array.isArray(notaries) ? notaries : [];
  const normalizedQuery = clean(query);
  const page = Math.max(1, Number.parseInt(options.page, 10) || 1);
  const limit = Math.min(48, Math.max(12, Number.parseInt(options.limit, 10) || 24));
  const allTransfers = buildArchiveTransfers(rows);
  const matchedNotaries = normalizedQuery
    ? rows.filter(item => nameLikelyMatches(normalizedQuery, item.name)).slice(0, 12)
    : [];
  const transfers = normalizedQuery
    ? allTransfers.filter(item => nameLikelyMatches(normalizedQuery, item.sourceName))
    : allTransfers;

  const inactive = rows
    .filter(item => item.active === false)
    .sort((left, right) => normalizeRegionKey(left.region).localeCompare(normalizeRegionKey(right.region), 'ru')
      || normalizeName(left.name).localeCompare(normalizeName(right.name), 'ru'));
  const unpublishedRows = inactive.filter(notary => !allTransfers.some(transfer => transferBelongsToNotary(transfer, notary)));
  const totalPages = Math.max(1, Math.ceil(unpublishedRows.length / limit));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * limit;

  return {
    matchedNotaries,
    transfers,
    summary: {
      totalNotaries: rows.length,
      inactiveTotal: inactive.length,
      confirmedTransferTotal: allTransfers.length,
      currentTransferTotal: allTransfers.filter(item => item.current).length,
      staleTransferTotal: allTransfers.filter(item => !item.current).length,
      unpublishedTotal: unpublishedRows.length,
    },
    unpublished: {
      items: unpublishedRows.slice(start, start + limit),
      total: unpublishedRows.length,
      page: safePage,
      totalPages,
      limit,
    },
  };
}

module.exports = {
  CHAMBER_IDS,
  buildArchiveTransfers,
  clean,
  extractArchiveTransfer,
  findArchiveDirectory,
  nameLikelyMatches,
  normalizeName,
  normalizeRegionKey,
  officialChamberUrl,
  transferBelongsToNotary,
};
