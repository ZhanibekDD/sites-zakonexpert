'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ejs = require('ejs');

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zke-crm-'));
  process.env.CRM_DB_PATH = path.join(dir, 'crm.db');
  process.env.CRM_META_DB_PATH = path.join(dir, 'crm-meta.db');
  process.env.CRM_BACKUP_DIR = path.join(dir, 'backups');
  process.env.CRM_BACKUP_KEEP_DAYS = '7';
  process.env.DB_AUTOCOMPACTION_MS = String(60 * 60 * 1000);
  process.env.CRM_CONTRACT_START_NUMBER = '200';

  const crm = require('../modules/crm-db');
  const contracts = require('../modules/crm-contracts');

  assert.equal(crm.normalizePhone('8 (700) 123-45-67'), '77001234567');
  assert.equal(crm.normalizePhone('+7 700 123 45 67'), '77001234567');
  assert.equal(crm.normalizeIin('980 210 350 175'), '980210350175');

  const created = await crm.createClient({
    name: 'Тест Клиент',
    iin: '980210350175',
    phone: '8 700 123 45 67',
    issue: 'Арест счёта',
    source: 'test',
  });
  assert.ok(created._id);
  assert.equal(created.status, 'new');

  const duplicate = await crm.createClient({ name: 'Дубликат', iin: '980210350175' });
  assert.equal(duplicate._id, created._id, 'IIN should deduplicate clients');

  const agreed = await crm.setStatus(created._id, 'agreed', 'test');
  assert.equal(agreed.status, 'agreed');

  const promised = await crm.addPromise(created._id, { amount: 100000, date: '2026-09-05', note: 'после зарплаты' }, 'test');
  assert.equal(promised.promiseAmount, 100000);

  const partial = await crm.addPayment(created._id, { amount: 40000 }, 'test');
  assert.equal(partial.paymentStatus, 'partial');
  const paid = await crm.addPayment(created._id, { amount: 60000 }, 'test');
  assert.equal(paid.paidAmount, 100000);
  assert.equal(paid.paymentStatus, 'paid');

  const firstNumber = await crm.nextContractNumber();
  assert.equal(firstNumber, '200');
  const secondNumber = await crm.nextContractNumber();
  assert.equal(secondNumber, '201');

  const token = contracts.signToken();
  const contractResult = await crm.addContract(created._id, {
    title: 'Договор на услуги', number: firstNumber, amount: 100000, date: '2026-08-31', status: 'waiting_payment', signTokenHash: token.hash,
  }, 'test');
  assert.equal(crm.activeContracts(contractResult.client).length, 1);
  assert.equal(contractResult.contract.number, '200');

  const foundByToken = await crm.findContractBySignTokenHash(token.hash);
  assert.equal(foundByToken.contract.id, contractResult.contract.id);

  const removed = await crm.deleteContract(created._id, contractResult.contract.id, 'Клиент не оплатил', 'test');
  assert.equal(crm.activeContracts(removed.client).length, 0);
  const restored = await crm.restoreContract(created._id, contractResult.contract.id, 'test');
  assert.equal(crm.activeContracts(restored.client).length, 1);

  const messaged = await crm.recordMessageByPhone({
    phone: '+77001234567', channel: 'whatsapp', direction: 'in', text: 'Здравствуйте', messageId: 'wamid.test',
  });
  assert.equal(messaged.messages.length, 1);
  const deduped = await crm.recordMessageByPhone({
    phone: '+77001234567', channel: 'whatsapp', direction: 'in', text: 'Здравствуйте', messageId: 'wamid.test',
  });
  assert.equal(deduped.messages.length, 1, 'message id should deduplicate webhooks');

  const leadOnly = await crm.upsertFromLead({ _id: 'lead-2', name: 'Сайт Лид', phone: '+77009999999', issue: 'debt', source: 'website', ts: Date.now() });
  assert.equal(crm.isWebsiteOnly(leadOnly), true, 'raw website lead should not pollute clients list');
  const visibleBefore = await crm.listClients({ limit: 100 });
  assert.equal(visibleBefore.some(x => x._id === leadOnly._id), false);
  const promoted = await crm.upsertFromLead({ _id: 'lead-2', name: 'Сайт Лид', phone: '+77009999999', issue: 'debt', source: 'website', ts: Date.now() }, { promote: true });
  assert.ok(promoted.promotedAt);
  const visibleAfter = await crm.listClients({ limit: 100 });
  assert.equal(visibleAfter.some(x => x._id === leadOnly._id), true);

  const parsed = contracts.parseLegacyContractText(`\nДОГОВОР ОКАЗАНИЯ УСЛУГ № 88\nКЛИЕНТ\nФРИЗЕН СЕРГЕЙ ПЕТРОВИЧ\nИИН: 680713300422\nТел./WhatsApp: +7 705 605 1120\nСТОИМОСТЬ 80 000 тенге\nСРОК РАБОТЫ 30 календарных дней\n`);
  assert.equal(parsed.number, '88');
  assert.equal(parsed.iin, '680713300422');
  assert.ok(parsed.phone.includes('705'));
  assert.equal(parsed.amount, 80000);

  const summary = await crm.summary();
  assert.equal(summary.total, 2);
  assert.equal(summary.paidTotal, 100000);
  assert.ok(summary.contractsTotal >= 1);

  await crm.scheduleBackup();
  const backups = fs.readdirSync(process.env.CRM_BACKUP_DIR).filter(name => name.endsWith('.json'));
  assert.ok(backups.length >= 1, 'backup should be generated');

  for (const template of ['views/crm/login.ejs', 'views/crm/dashboard.ejs', 'views/crm/sign.ejs']) {
    const source = fs.readFileSync(path.join(__dirname, '..', template), 'utf8');
    ejs.compile(source, { filename: template });
  }

  console.log('CRM tests PASS');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
