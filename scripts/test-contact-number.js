'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SEARCH_ROOTS = ['public', 'views', 'modules', 'docs'];
const TEXT_EXTENSIONS = new Set(['.css', '.ejs', '.html', '.js', '.json', '.md', '.svg', '.txt', '.xml']);
const EXPECTED_RAW = '77058762795';
const EXPECTED_DISPLAY = '+7 (705) 876-27-95';
const OFFICIAL_WHATSAPP_LINK = 'https://wa.me/77058762795';
const RETIRED_NUMBER = /(?:\+?7[ ()-]*)?(?:747[ ()-]*995[ ()-]*76[ ()-]*35|775[ ()-]*299[ ()-]*87[ ()-]*38|700[ ()-]*311[ ()-]*06[ ()-]*38|700[ ()-]*030[ ()-]*00[ ()-]*24|700[ ()-]*309[ ()-]*75[ ()-]*66)/g;

function listTextFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return listTextFiles(fullPath);
    return TEXT_EXTENSIONS.has(path.extname(entry.name).toLowerCase()) ? [fullPath] : [];
  });
}

const files = SEARCH_ROOTS.flatMap((directory) => listTextFiles(path.join(ROOT, directory)));
let rawCount = 0;
let displayCount = 0;
const staleFiles = [];

for (const file of files) {
  const source = fs.readFileSync(file, 'utf8');
  if (RETIRED_NUMBER.test(source)) staleFiles.push(path.relative(ROOT, file));
  RETIRED_NUMBER.lastIndex = 0;
  rawCount += source.split(EXPECTED_RAW).length - 1;
  displayCount += source.split(EXPECTED_DISPLAY).length - 1;
}

if (staleFiles.length) {
  throw new Error(`Old contact number remains in: ${staleFiles.join(', ')}`);
}
if (rawCount < 1 || displayCount < 1) {
  throw new Error('The current contact number is missing from public source files.');
}

const siteScript = fs.readFileSync(path.join(ROOT, 'public', 'js', 'site.js'), 'utf8');
const chatbotScript = fs.readFileSync(path.join(ROOT, 'public', 'js', 'chatbot.js'), 'utf8');
const contactRu = fs.readFileSync(path.join(ROOT, 'public', 'contact.html'), 'utf8');
const contactKk = fs.readFileSync(path.join(ROOT, 'public', 'contact_kz.html'), 'utf8');
const qrPath = path.join(ROOT, 'public', 'img', 'contact', 'whatsapp-zakonexpert-qr.svg');
if (!siteScript.includes(OFFICIAL_WHATSAPP_LINK)
  || !contactRu.includes(OFFICIAL_WHATSAPP_LINK)
  || !contactKk.includes(OFFICIAL_WHATSAPP_LINK)) {
  throw new Error('The official WhatsApp Business link is missing from the site-wide QR experience.');
}
if (!fs.existsSync(qrPath) || fs.statSync(qrPath).size < 1000) {
  throw new Error('The local WhatsApp QR asset is missing or invalid.');
}
if (!fs.readFileSync(qrPath, 'utf8').includes(OFFICIAL_WHATSAPP_LINK)) {
  throw new Error('The local WhatsApp QR asset does not identify the current direct link.');
}
if (!siteScript.includes("fetch('/api/lead'") || !siteScript.includes('consent: true')) {
  throw new Error('The contact form does not persist consented leads before offering WhatsApp.');
}
if (!siteScript.includes('ZE_getLeadAttribution') || !chatbotScript.includes('ZE_getLeadAttribution')) {
  throw new Error('Lead forms do not preserve consented first-touch attribution.');
}
for (const [locale, source] of [['ru', contactRu], ['kk', contactKk]]) {
  if (!/name="phone"[^>]*required/.test(source)) {
    throw new Error(`${locale} contact form must require a callback phone number.`);
  }
}

console.log(`Contact number and WhatsApp QR OK: ${rawCount} links/values and ${displayCount} formatted labels.`);
