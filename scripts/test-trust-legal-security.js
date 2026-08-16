'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const FORBIDDEN_PAYMENT_PROMISES = [
  /без\s+предоплат/iu,
  /оплат\w*\s+после\s+результат/iu,
  /плат\w*\s+только\s+после\s+результат/iu,
  /сначала\s+(?:снима\w*|результат)[\s\S]{0,80}потом\s+(?:вы\s+)?плат/iu,
];

const userFacingFiles = [];
function collect(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ['node_modules', 'data', 'docs', '.git'].includes(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) collect(absolute);
    else if (/\.(?:html|ejs|js|svg)$/i.test(entry.name)) userFacingFiles.push(absolute);
  }
}
collect(PUBLIC);
collect(path.join(ROOT, 'views'));

const stale = [];
for (const filename of userFacingFiles) {
  const source = fs.readFileSync(filename, 'utf8');
  if (FORBIDDEN_PAYMENT_PROMISES.some(pattern => pattern.test(source))) {
    stale.push(path.relative(ROOT, filename));
  }
}
assert.deepStrictEqual(stale, [], `stale payment promises remain in: ${stale.join(', ')}`);

const privacy = fs.readFileSync(path.join(PUBLIC, 'privacy.html'), 'utf8');
for (const required of [
  'ТОО «ZakonExpert»', '260740044168', 'Кияшев Жанибек Даулетович',
  'Яндекс.Метрика', 'Webvisor', 'Telegram', '24 месяцев', '13 месяцев',
]) assert.ok(privacy.includes(required), `privacy policy is missing: ${required}`);

const consentScript = fs.readFileSync(path.join(PUBLIC, 'js', 'privacy-consent.js'), 'utf8');
assert.match(consentScript, /analyticsAllowed/);
assert.doesNotMatch(consentScript, /data-ze-consent="ads"/);
assert.doesNotMatch(consentScript, /реклам/iu);
assert.match(consentScript, /Только необходимое/);

const siteScript = fs.readFileSync(path.join(PUBLIC, 'js', 'site.js'), 'utf8');
assert.doesNotMatch(siteScript, /stickyWa\.style\.position\s*=\s*['"]relative['"]/,
  'site.js must not override the fixed WhatsApp button positioning');
assert.match(siteScript, /querySelectorAll\('\.sticky-wa, \.company-desktop-cta'\)/,
  'site.js must remove legacy round WhatsApp buttons');
assert.doesNotMatch(siteScript, /announce-bar|guarantee-pill|article-cta-guarantee|Разбор бесплатно/,
  'site.js must not inject promotional banners into pages or printed reports');

const chatbotScript = fs.readFileSync(path.join(PUBLIC, 'js', 'chatbot.js'), 'utf8');
assert.match(chatbotScript, /const ENABLE_CHAT_WIDGET = false/,
  'the floating chat bubble must stay disabled');

const publicPages = fs.readdirSync(PUBLIC)
  .filter(name => name.endsWith('.html'))
  .filter(name => name !== '404.html')
  .filter(name => !/^(?:yandex_|google)[a-z0-9]+\.html$/i.test(name));
for (const name of publicPages) {
  const source = fs.readFileSync(path.join(PUBLIC, name), 'utf8');
  assert.match(source, /privacy-consent\.js/, `${name} must expose the privacy choice before optional processing`);
  assert.doesNotMatch(source, /<script(?=[^>]*\ssrc="https:\/\/mc\.yandex\.ru)[^>]*>/i,
    `${name} loads optional analytics without consent`);
}

const staleSiteScriptRefs = userFacingFiles
  .filter(filename => /\.(?:html|ejs)$/i.test(filename))
  .filter(filename => {
    const source = fs.readFileSync(filename, 'utf8');
    return /(?:^|\/)js\/site\.js\?v=/.test(source)
      && !/(?:^|\/)js\/site\.js\?v=20260815-2/.test(source);
  })
  .map(filename => path.relative(ROOT, filename));
assert.deepStrictEqual(staleSiteScriptRefs, [],
  `stale site.js cache keys remain in: ${staleSiteScriptRefs.join(', ')}`);

const staleChatbotScriptRefs = userFacingFiles
  .filter(filename => /\.(?:html|ejs)$/i.test(filename))
  .filter(filename => {
    const source = fs.readFileSync(filename, 'utf8');
    return /(?:^|\/)js\/chatbot\.js/.test(source)
      && !/(?:^|\/)js\/chatbot\.js\?v=20260815-1/.test(source);
  })
  .map(filename => path.relative(ROOT, filename));
assert.deepStrictEqual(staleChatbotScriptRefs, [],
  `stale chatbot.js cache keys remain in: ${staleChatbotScriptRefs.join(', ')}`);

const floatingButtonMarkup = userFacingFiles
  .filter(filename => /\.(?:html|ejs)$/i.test(filename))
  .filter(filename => /class="(?:sticky-wa|company-desktop-cta)"/.test(fs.readFileSync(filename, 'utf8')))
  .map(filename => path.relative(ROOT, filename));
assert.deepStrictEqual(floatingButtonMarkup, [],
  `floating round WhatsApp buttons remain in: ${floatingButtonMarkup.join(', ')}`);

const home = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');
const contact = fs.readFileSync(path.join(PUBLIC, 'contact.html'), 'utf8');
const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
assert.match(home, /class="ze-home-company-check" href="\/proverka-kontragenta"/,
  'homepage must expose the company BIN checker above the fold');
assert.match(home, /href="\/proverka-bankrotstva"[\s\S]{0,420}Проверить статус банкротства по ИИН/,
  'homepage must expose the bankruptcy checker below the company checker');
assert.match(home, /data-nav-kgd><a class="nav-link" href="\/proverka-kontragenta"/,
  'homepage navigation must expose the KGD company check');
assert.doesNotMatch(home, /class="sticky-wa"/,
  'homepage must not render a floating round WhatsApp button');
assert.match(home, /home-hero-v2\.css\?v=20260816-11/,
  'homepage company-check entry styles must use the current cache key');
assert.match(home, /hero-woman-zakonexpert-v6\.webp[^>]*width="466"[^>]*height="1496"/,
  'homepage must use the approved high-resolution Kazakh lawyer portrait');
const homePortrait = path.join(PUBLIC, 'img', 'hero', 'hero-woman-zakonexpert-v6.webp');
assert(fs.existsSync(homePortrait), 'approved homepage lawyer portrait is missing');
assert(fs.statSync(homePortrait).size <= 500 * 1024,
  'homepage lawyer portrait is too large');
assert.doesNotMatch(home, /ze-home-specialist-card|Специалист по снятию арестов/,
  'homepage must not render the removed specialist badge');
const resultsPage = fs.readFileSync(path.join(PUBLIC, 'rezultaty.html'), 'utf8');
for (const source of [home, resultsPage]) {
  assert(source.includes('43 408 585,56 ₸'), 'results must show the combined amount across all cancellations');
  assert(source.includes('79'), 'results must show the full cancellation count');
  assert(!source.includes('79 300 ₸'), 'the old low-value featured result must be removed');
}
for (const filename of [
  'cancellation-3780371.webp',
  'cancellation-4091645.webp',
  'cancellation-6047478.webp',
  'cancellation-6942105.webp',
]) {
  assert(home.includes(`/img/rezultaty/${filename}`), `${filename} is not used on the homepage`);
  assert(resultsPage.includes(`/img/rezultaty/${filename}`), `${filename} is not used on the results page`);
  const imagePath = path.join(PUBLIC, 'img', 'rezultaty', filename);
  assert(fs.existsSync(imagePath), `${filename} is missing`);
  assert(fs.statSync(imagePath).size <= 100 * 1024, `${filename} is too large`);
}
assert.match(resultsPage, /results-v2\.css\?v=20260816-4/,
  'results page must use the redesigned results stylesheet');
assert.match(resultsPage, /results-archive-data\.js\?v=20260816-2/,
  'results page must load the additional rulings archive');
assert.match(resultsPage, /results-v2\.js\?v=20260816-4/,
  'results page must load the interactive document viewer');
assert.match(resultsPage, /101 постановление можно прочитать и открыть в полном размере/,
  'results archive must explain that the documents are readable');
assert.match(resultsPage, /Открыть документ отдельно и увеличить/,
  'results lightbox must provide a direct high-resolution document link');
const resultsArchiveSource = fs.readFileSync(path.join(PUBLIC, 'js', 'results-archive-data.js'), 'utf8');
const resultsArchiveSandbox = { window: {} };
vm.runInNewContext(resultsArchiveSource, resultsArchiveSandbox);
const resultsArchive = resultsArchiveSandbox.window.ZAKONEXPERT_RESULTS_ARCHIVE;
assert.strictEqual(resultsArchive.length, 101,
  'results archive must expose 101 unique additional documents');
assert.strictEqual(new Set(resultsArchive.map(item => item.id)).size, resultsArchive.length,
  'results archive document IDs must be unique');
const cancellationArchive = resultsArchive.filter(item => item.category === 'cancellation');
assert.strictEqual(cancellationArchive.length + 4, 79,
  'results archive plus four featured rulings must expose 79 cancellations');
const amountToCents = label => Math.round(Number(label.replace(/₸/g, '').replace(/\s/g, '').replace(',', '.')) * 100);
const archiveCancellationCents = cancellationArchive.reduce((total, item) => total + amountToCents(item.amountLabel), 0);
assert.strictEqual(archiveCancellationCents + 2086159933, 4340858556,
  'all published cancellations must total 43 408 585,56 tenge');
for (const item of resultsArchive) {
  assert.match(item.src, /^\/img\/rezultaty\/archive\/[a-z0-9-]+\.webp$/,
    `invalid archive preview path: ${item.src}`);
  const imagePath = path.join(PUBLIC, item.src);
  assert(fs.existsSync(imagePath), `archive preview is missing: ${item.src}`);
  assert(fs.statSync(imagePath).size <= 520 * 1024, `readable archive preview is too large: ${item.src}`);
  assert.match(item.thumbSrc, /^\/img\/rezultaty\/archive\/thumbs\/[a-z0-9-]+\.webp$/,
    `invalid archive thumbnail path: ${item.thumbSrc}`);
  const thumbPath = path.join(PUBLIC, item.thumbSrc);
  assert(fs.existsSync(thumbPath), `archive thumbnail is missing: ${item.thumbSrc}`);
  assert(fs.statSync(thumbPath).size <= 95 * 1024, `archive thumbnail is too large: ${item.thumbSrc}`);
}
assert.match(home, /data-result-viewer[\s\S]{0,1200}data-result-option/,
  'homepage must expose a large interactive result viewer');
assert.doesNotMatch(resultsPage, /Наша команда|komanda-0[12]\.jpeg|rez-v2-team/,
  'results page must not render the removed team section');
const bankruptcyPage = fs.readFileSync(path.join(ROOT, 'views', 'partials', 'bankruptcy-check-body.ejs'), 'utf8');
assert.match(bankruptcyPage, /id="bc-consent"[^>]*privacyConsent[^>]*required/,
  'bankruptcy checker must require consent before processing IIN');
assert.doesNotMatch(bankruptcyPage, /bankruptcy-check\?iin=/,
  'bankruptcy checker must not send IIN in a URL query string');
const homeServiceImages = [
  'arrest-accounts.webp',
  'vehicle-restriction.webp',
  'property-arrest.webp',
  'travel-ban.webp',
  'enforcement-notification.webp',
  'enforcement-fees.webp',
  'notary-writ.webp',
  'salary-withholding.webp',
  'paid-debt-restriction.webp',
];
for (const filename of homeServiceImages) {
  assert(home.includes(`/img/services/${filename}`), `${filename} is not used by a homepage service card`);
  const imagePath = path.join(PUBLIC, 'img', 'services', filename);
  assert(fs.existsSync(imagePath), `${filename} is missing`);
  assert(fs.statSync(imagePath).size <= 120 * 1024, `${filename} is too large for a homepage card`);
}
assert.match(home, /id="iin-consent"[^>]*required/);
assert.match(contact, /name="privacyConsent"[^>]*required/);
assert.match(server, /Необходимо согласие на разовую обработку ИИН/);
assert.match(server, /purgeOlderThan/);

const lock = require(path.join(ROOT, 'package-lock.json'));
assert.strictEqual(lock.packages['node_modules/undici']?.version, '7.29.0', 'undici security override is not locked');

console.log(`Trust/legal/security OK: ${userFacingFiles.length} user-facing assets and ${publicPages.length} pages checked.`);
