'use strict';

function createNewsFormat() {
  function cleanNewsText(value = '') {
    return String(value)
      .replace(/[\u00a0\u2007\u202f]/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/\s+(?:[\w-]+\.)+(?:kz|ru|com|org|net)$/iu, '')
      .trim();
  }

  function newsDisplayTitle(article) {
    return cleanNewsText(article.original_title || article.title || 'Новости ZakonExpert');
  }

  function newsDisplayExcerpt(article) {
    const value = cleanNewsText(article.excerpt || article.original_excerpt || '');
    return value.length >= 45
      ? value
      : 'Разбираем событие, объясняем правовые последствия и даём понятный алгоритм действий.';
  }

  function xmlCdata(value = '') {
    return String(value).replace(/\]\]>/g, ']]]]><![CDATA[>');
  }

  function xmlEscape(value = '') {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  function newsCoverLines(value, maxChars = 34, maxLines = 3) {
    const words = cleanNewsText(value).split(' ').filter(Boolean);
    const lines = [];
    let line = '';
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (next.length > maxChars && line) {
        lines.push(line);
        line = word;
        if (lines.length === maxLines - 1) break;
      } else {
        line = next;
      }
    }
    if (line && lines.length < maxLines) lines.push(line);
    const used = lines.join(' ').length;
    if (used < cleanNewsText(value).length && lines.length) {
      lines[lines.length - 1] = `${lines[lines.length - 1].replace(/[.,:;!?—-]+$/u, '')}…`;
    }
    return lines;
  }

  function newsCoverTheme(article) {
    const text = `${article.category || ''} ${article.tags || ''} ${newsDisplayTitle(article)}`.toLowerCase();
    if (/чси|исполнител/.test(text)) return { label: 'ЧСИ И ВЗЫСКАНИЕ', accent: '#e4b64d', symbol: '§' };
    if (/нотари|надпис/.test(text)) return { label: 'НОТАРИАТ', accent: '#77b7ff', symbol: 'N' };
    if (/авто|транспорт/.test(text)) return { label: 'АВТО И ОГРАНИЧЕНИЯ', accent: '#65d1b4', symbol: 'A' };
    if (/суд|апелляц/.test(text)) return { label: 'СУДЕБНАЯ ПРАКТИКА', accent: '#caa7ff', symbol: '⚖' };
    if (/банк|кредит|мфо|долг/.test(text)) return { label: 'ФИНАНСЫ И ДОЛГИ', accent: '#e4b64d', symbol: '₸' };
    return { label: 'НОВОСТИ И ПРАВО', accent: '#e4b64d', symbol: 'ZE' };
  }

  function buildNewsCoverSvg(article) {
    const title = newsDisplayTitle(article);
    const theme = newsCoverTheme(article);
    const lines = newsCoverLines(title);
    const tspans = lines.map((line, index) =>
      `<tspan x="88" dy="${index === 0 ? 0 : 67}">${xmlEscape(line)}</tspan>`
    ).join('');
    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" role="img" aria-labelledby="title desc">
  <title id="title">${xmlEscape(title)}</title>
  <desc id="desc">Редакционная обложка ZakonExpert</desc>
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#06172d"/><stop offset="0.58" stop-color="#0d2f58"/><stop offset="1" stop-color="#174e7d"/></linearGradient>
    <radialGradient id="glow" cx="80%" cy="20%" r="70%"><stop stop-color="${theme.accent}" stop-opacity=".24"/><stop offset="1" stop-color="${theme.accent}" stop-opacity="0"/></radialGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <rect width="1200" height="630" fill="url(#glow)"/>
  <g fill="none" stroke="${theme.accent}" stroke-opacity=".16"><circle cx="1010" cy="205" r="178" stroke-width="2"/><circle cx="1010" cy="205" r="132"/><path d="M1010 58l126 70v142l-126 76-126-76V128z" stroke-width="3"/></g>
  <g transform="translate(910 105)"><rect width="200" height="200" rx="100" fill="#06172d" fill-opacity=".58" stroke="${theme.accent}" stroke-width="3"/><text x="100" y="125" text-anchor="middle" fill="${theme.accent}" font-family="Arial, sans-serif" font-size="72" font-weight="700">${xmlEscape(theme.symbol)}</text></g>
  <rect x="88" y="72" width="74" height="4" rx="2" fill="${theme.accent}"/>
  <text x="88" y="113" fill="${theme.accent}" font-family="Arial, sans-serif" font-size="21" font-weight="700" letter-spacing="2">${xmlEscape(theme.label)}</text>
  <text x="88" y="218" fill="#ffffff" font-family="Arial, sans-serif" font-size="53" font-weight="700">${tspans}</text>
  <line x1="88" y1="525" x2="1112" y2="525" stroke="#ffffff" stroke-opacity=".18"/>
  <text x="88" y="574" fill="#ffffff" font-family="Arial, sans-serif" font-size="26" font-weight="700" letter-spacing="2">ZAKONEXPERT</text>
  <text x="1112" y="574" text-anchor="end" fill="#ffffff" fill-opacity=".62" font-family="Arial, sans-serif" font-size="19">Юридический разбор · Казахстан</text>
</svg>`;
  }

  const NEWS_CATEGORY_SLUGS = new Set([
    'аресты', 'finance', 'chsi', 'notarius', 'sud', 'alimenty', 'shtrafy', 'avto', 'laws',
  ]);

  function newsCategoryPath(category, page = 1) {
    const base = category ? `/news/category/${encodeURIComponent(category)}` : '/news';
    return page > 1 ? `${base}?page=${page}` : base;
  }

  return { xmlEscape, xmlCdata, NEWS_CATEGORY_SLUGS, newsCategoryPath, newsDisplayTitle, newsDisplayExcerpt, buildNewsCoverSvg };
}

module.exports = { createNewsFormat };
