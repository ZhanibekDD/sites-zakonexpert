'use strict';

const cheerio = require('cheerio');

const ARTICLE_HEADING = /^Статья\s+(\d+(?:[.-]\d+)?)\.\s*(.+)$/;
const normalize = value => String(value || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();

// Read disjoint blocks, never both a paragraph and its nested <b>/<span>.
// Adilet has used both <h3> and <p><b> article headings. Notes can be loose
// spans/links separated by <br>, so selecting paragraphs alone loses text.
function parseAdiletArticles(html, law) {
  const $ = cheerio.load(html);
  $('script, style, nav, footer').remove();
  const root = $('article').first().length ? $('article').first() : $('body');
  const articles = [];
  const numbers = new Set();
  let current = null;
  let chapter = '';
  let inline = '';

  function finish() {
    if (!current) return;
    current.text = current.lines.join('\n').trim();
    delete current.lines;
    if (!current.text) throw new Error(`Adilet: article ${current.num} has no body`);
    if (numbers.has(current.num)) throw new Error(`Adilet: duplicate article ${current.num}`);
    numbers.add(current.num);
    articles.push(current);
    current = null;
  }

  function emit(value, element) {
    const text = normalize(value);
    if (!text) return;
    const heading = text.match(ARTICLE_HEADING);
    if (heading) {
      finish();
      const anchor = element && ($(element).attr('id') || $(element).find('a[name]').first().attr('name'));
      current = {
        code: law.code, codeName: law.codeName, shortName: law.shortName,
        fullName: law.fullName, chapter, num: heading[1],
        numInt: Number.parseInt(heading[1], 10), title: heading[2],
        slug: `${law.shortName}-${heading[1].replace(/\./g, '-')}`,
        sourceFragment: anchor || null, lines: [],
      };
    } else if (element && /^h[1-6]$/.test(element.tagName || '') && /^(?:Общая|Особенная|РАЗДЕЛ|ГЛАВА|Раздел|Глава)(?:\s|$)/i.test(text)) {
      finish();
      chapter = text;
    } else if (current) {
      current.lines.push(text);
    }
  }

  function flushInline() {
    emit(inline);
    inline = '';
  }

  function walk(node) {
    if (node.type === 'text') { inline += node.data; return; }
    if (node.type !== 'tag') return;
    const tag = node.tagName.toLowerCase();
    if (tag === 'br') { flushInline(); return; }
    if (/^(?:p|h[1-6]|li)$/.test(tag)) {
      flushInline();
      const copy = $(node).clone();
      copy.find('br').replaceWith(' ');
      emit(copy.text(), node);
      return;
    }
    // The UPK's closing table is the presidential signature, outside articles.
    if (tag === 'table') { flushInline(); finish(); return; }
    for (const child of node.children || []) walk(child);
  }

  for (const child of root[0]?.children || []) walk(child);
  flushInline();
  finish();
  return articles;
}

function makeSnippet(text) {
  const value = normalize(text);
  if (value.length <= 300) return value;
  const cut = value.slice(0, 300);
  const space = cut.lastIndexOf(' ');
  return cut.slice(0, space > 200 ? space : 300);
}

module.exports = { ARTICLE_HEADING, parseAdiletArticles, makeSnippet };
