'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function write(relativePath, content) {
  const file = path.join(ROOT, relativePath);
  const current = fs.readFileSync(file, 'utf8');
  if (current === content) return false;
  fs.writeFileSync(file, content, 'utf8');
  console.log('updated', relativePath);
  return true;
}

function replaceOnce(content, from, to, label) {
  if (content.includes(to)) return content;
  const index = content.indexOf(from);
  if (index === -1) throw new Error('Marker not found: ' + label);
  return content.slice(0, index) + to + content.slice(index + from.length);
}

let companiesDb = read('modules/companies-db.js');
companiesDb = replaceOnce(
  companiesDb,
  "const { evaluateCompany, QUALITY_VERSION } = require('./company-quality');",
  "const { evaluateCompany, QUALITY_VERSION } = require('./company-quality');\nconst { applyCompanyCorrection } = require('./company-corrections');",
  'company corrections import'
);
companiesDb = replaceOnce(
  companiesDb,
  "function decorateCompany(company) {\n  if (!company) return null;\n  const sanitized = sanitizeCompanyContactFields(\n    applyRegistryPrivacyOverride('companies', company)\n  );",
  "function decorateCompany(company) {\n  if (!company) return null;\n  const corrected = applyCompanyCorrection(company);\n  const sanitized = sanitizeCompanyContactFields(\n    applyRegistryPrivacyOverride('companies', corrected)\n  );",
  'apply company correction before public decoration'
);
write('modules/companies-db.js', companiesDb);

let item = read('views/companies/item.ejs');
item = replaceOnce(
  item,
  "  foundingDate: company.registration_date || undefined,\n  address: schemaAddresses.length ? schemaAddresses : undefined,",
  "  foundingDate: company.registration_date || undefined,\n  dissolutionDate: company.dissolution_date || undefined,\n  address: schemaAddresses.length ? schemaAddresses : undefined,",
  'organization dissolution date schema'
);
item = replaceOnce(
  item,
  "    ['bi-person-badge', copy.leader, company.leader],",
  "    ['bi-person-badge', copy.leader, company.leader_display || company.leader],",
  'current leader presentation'
);
item = replaceOnce(
  item,
  "const statusRaw = String(company.status_ru || '');\nconst statusState = /ликвид/i.test(statusRaw) ? 'liquidated' : (statusRaw ? 'active' : 'unknown');",
  "const statusRaw = String(company.status_ru || '');\nconst statusState = /(ликвид|прекращ|реорганиз|исключен|недейств)/i.test(statusRaw)\n  ? 'liquidated'\n  : (statusRaw ? 'active' : 'unknown');\nconst correction = company.correction || null;\nconst statusNote = correction && correction.statusNote\n  ? correction.statusNote\n  : (official ? copy.officialStatusNote : copy.directoryStatusNote);\nconst correctionHtml = correction\n  ? '<section style=\"margin:0 0 18px;padding:18px 20px;border:1px solid #f0c36b;border-left:5px solid #c88712;border-radius:14px;background:#fff9e9;color:#5d410b;\">'\n    + '<div style=\"display:flex;gap:11px;align-items:flex-start;\"><i class=\"bi bi-patch-check-fill\" style=\"font-size:1.25rem;color:#b7790b;margin-top:1px;\"></i><div>'\n    + '<h2 style=\"margin:0 0 7px;font-size:1rem;color:#4b3308;\">' + esc(correction.title || 'Сведения актуализированы') + '</h2>'\n    + '<p style=\"margin:0;color:#6f5118;font-size:.84rem;line-height:1.62;\">' + esc(correction.summary || '') + '</p>'\n    + '<p style=\"margin:9px 0 0;color:#8a6a2d;font-size:.72rem;line-height:1.5;\"><strong>Основание:</strong> ' + esc(correction.sourceLabel || '')\n    + (correction.sourceDate ? ' от ' + esc(formatDate(correction.sourceDate)) : '')\n    + (correction.verifiedAt ? '. Проверено ZakonExpert: ' + esc(formatDate(correction.verifiedAt)) : '') + '.</p>'\n    + '</div></div></section>'\n  : '';",
  'status classifier and correction banner'
);
item = replaceOnce(
  item,
  "  + (company.bin ? '<p style=\"font-size:1.08rem;color:#1a56db;font-weight:700;margin-top:10px;\">' + esc(copy.bin) + ' ' + esc(company.bin) + '</p>' : '') + '</section>'\n  + '<div class=\"company-item-grid\">'",
  "  + (company.bin ? '<p style=\"font-size:1.08rem;color:#1a56db;font-weight:700;margin-top:10px;\">' + esc(copy.bin) + ' ' + esc(company.bin) + '</p>' : '') + '</section>'\n  + correctionHtml\n  + '<div class=\"company-item-grid\">'",
  'insert correction banner'
);
item = replaceOnce(
  item,
  "  + '<p style=\"margin:8px 0 0;color:#475569;font-size:.79rem;line-height:1.5;\">' + esc(official ? copy.officialStatusNote : copy.directoryStatusNote) + '</p></div>'",
  "  + '<p style=\"margin:8px 0 0;color:#475569;font-size:.79rem;line-height:1.5;\">' + esc(statusNote) + '</p></div>'",
  'status note from correction'
);
write('views/companies/item.ejs', item);

const packagePath = 'package.json';
const pkg = JSON.parse(read(packagePath));
pkg.scripts['test:company-corrections'] = 'node scripts/test-company-corrections.js';
if (!pkg.scripts['check:js'].includes('modules/company-corrections.js')) {
  pkg.scripts['check:js'] += ' && node --check modules/company-corrections.js && node --check scripts/test-company-corrections.js';
}
if (!pkg.scripts.test.includes('test:company-corrections')) {
  pkg.scripts.test = pkg.scripts.test.replace('npm run test:companies &&', 'npm run test:companies && npm run test:company-corrections &&');
}
write(packagePath, JSON.stringify(pkg, null, 2) + '\n');

console.log('ALИАСКАР-2005 correction migration completed.');
