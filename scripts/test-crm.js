'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ejs = require('ejs');

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zke-crm-'));
  process.env.CRM_DB_PATH = path.join(dir, 'crm.db');
  process.env.CRM_BACKUP_DIR = path.join(dir, 'backups');
  process.env.CRM_BACKUP_KEEP_DAYS = '7';
  process.env.DB_AUTOCOMPACTION_MS = String(60 * 60 * 1000);

  const crm = require('../modules/crm-db');

  assert.equal(crm.normalizePhone('8 (700) 123-45-67'), '77001234567');
  assert.equal(crm.normalizePhone('+7 700 123 45 67'), '77001234567');

  const created = await crm.createClient({
    name: 'Тест Клиент',
    phone: '8 700 123 45 67',
    issue: 'Арест счёта',
    source: 'test',
  });
  assert.ok(created._id);
  assert.equal(created.status, 'new');

  const duplicate = await crm.createClient({ name: 'Дубликат', phone: '+7 700 123 45 67' });
  assert.equal(duplicate._id, created._id, 'phone should deduplicate clients');

  const agreed = await crm.setStatus(created._id, 'agreed', 'test');
  assert.equal(agreed.status, 'agreed');

  const promised = await crm.addPromise(created._id, { amount: 100000, date: '2026-09-05', note: 'после зарплаты' }, 'test');
  assert.equal(promised.promiseAmount, 100000);
  assert.equal(promised.promiseDate, '2026-09-05');

  const partial = await crm.addPayment(created._id, { amount: 40000 }, 'test');
  assert.equal(partial.paidAmount, 40000);
  assert.equal(partial.paymentStatus, 'partial');

  const paid = await crm.addPayment(created._id, { amount: 60000 }, 'test');
  assert.equal(paid.paidAmount, 100000);
  assert.equal(paid.paymentStatus, 'paid');

  const contractResult = await crm.addContract(created._id, {
    title: 'Договор на услуги', number: 'ZE-TEST', amount: 100000, date: '2026-08-31',
  }, 'test');
  assert.equal(contractResult.client.contracts.length, 1);
  assert.equal(contractResult.contract.number, 'ZE-TEST');

  const messaged = await crm.recordMessageByPhone({
    phone: '+77001234567', channel: 'whatsapp', direction: 'in', text: 'Здравствуйте', messageId: 'wamid.test',
  });
  assert.equal(messaged.messages.length, 1);
  const deduped = await crm.recordMessageByPhone({
    phone: '+77001234567', channel: 'whatsapp', direction: 'in', text: 'Здравствуйте', messageId: 'wamid.test',
  });
  assert.equal(deduped.messages.length, 1, 'message id should deduplicate webhooks');

  await crm.upsertFromLead({
    _id: 'lead-1', name: 'Тест Клиент', phone: '+77001234567', issue: 'debt', source: 'website', ts: Date.now(),
  });
  const linked = await crm.findByPhone('+77001234567');
  assert.ok(linked.sourceLeadIds.includes('lead-1'));

  const summary = await crm.summary();
  assert.equal(summary.total, 1);
  assert.equal(summary.paidTotal, 100000);
  assert.equal(summary.promiseTotal, 100000);

  await crm.scheduleBackup();
  const backups = fs.readdirSync(process.env.CRM_BACKUP_DIR).filter(name => name.endsWith('.json'));
  assert.ok(backups.length >= 1, 'backup should be generated');

  for (const template of ['views/crm/login.ejs', 'views/crm/dashboard.ejs']) {
    const source = fs.readFileSync(path.join(__dirname, '..', template), 'utf8');
    ejs.compile(source, { filename: template });
  }

  console.log('CRM tests PASS');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
