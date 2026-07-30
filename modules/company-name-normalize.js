'use strict';

// Shared normalizer for matching a company name across sources that format
// the legal-form prefix differently (ТОО vs spelled out, quote styles, etc.).
// Strips wrapping punctuation/legal-form words and lowercases, so
// 'ТОО "Ромашка"' and 'Товарищество с ограниченной ответственностью Ромашка'
// both reduce to 'ромашка' for comparison. Not for display — display the
// original field, only use this for matching.
function normalizeCompanyName(raw) {
  return String(raw || '')
    .trim()
    .replace(/^[«»"'“”]+/, '')
    .replace(/^(товарищество с ограниченной ответственностью|акционерное общество|производственный кооператив|крестьянское хозяйство|индивидуальный предприниматель|тоо|ао|пк|ип|гкп|ккп)\s+/i, '')
    .replace(/^[«»"'“”]+/, '')
    .replace(/[«»"'“”]+$/, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

module.exports = { normalizeCompanyName };
