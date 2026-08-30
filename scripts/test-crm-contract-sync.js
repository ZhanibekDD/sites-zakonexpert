'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zke-crm-test-'));
process.env.CRM_DB_PATH = path.join(tmp, 'crm.db');
process.env.CRM_BACKUP_DIR = path.join(tmp, 'backups');
process.env.CRM_BACKUP_KEEP_DAYS = '7';

const crm = require('../modules/crm-db');

(async () => {
  try {
    const first = await crm.upsertContractFromIntegration({
      source: 'dogovora-zakon-Expert',
      externalContractId: 'dogovora:501',
      generatorContractId: 501,
      number: '501',
      amount: 50000,
      service: 'Снятие ареста со счёта',
      paymentStatus: 'pending',
      client: {
        externalClientId: 'dogovora:71',
        name: 'Тестов Тест Тестович',
        iin: '900101300123',
        phone: '+7 700 123 45 67',
        address: 'г. Алматы',
      },
    }, 'contract-generator');

    assert(first.created, 'first contract should be created');
    assert.strictEqual(first.client.status, 'contract');
    assert.strictEqual(first.client.iin, '900101300123');
    assert.strictEqual(first.client.contracts.length, 1);

    const retry = await crm.upsertContractFromIntegration({
      source: 'dogovora-zakon-Expert',
      externalContractId: 'dogovora:501',
      generatorContractId: 501,
      number: '501',
      amount: 55000,
      service: 'Снятие ареста со счёта — уточнено',
      paymentStatus: 'pending',
      client: {
        externalClientId: 'dogovora:71',
        name: 'Тестов Тест Тестович',
        iin: '900101300123',
        phone: '+7 700 123 45 67',
      },
    }, 'contract-generator');

    assert(!retry.created, 'retry must update instead of duplicating');
    assert.strictEqual(retry.client.contracts.length, 1);
    assert.strictEqual(retry.contract.amount, 55000);

    const second = await crm.upsertContractFromIntegration({
      source: 'dogovora-zakon-Expert',
      externalContractId: 'dogovora:502',
      generatorContractId: 502,
      number: '502',
      amount: 25000,
      service: 'Заявление на график',
      paymentStatus: 'paid',
      client: {
        externalClientId: 'dogovora:71',
        name: 'Тестов Тест Тестович',
        iin: '900101300123',
        phone: '+7 700 123 45 67',
      },
    }, 'contract-generator');

    assert.strictEqual(second.client._id, first.client._id, 'IIN/external id should resolve same client');
    assert.strictEqual(second.client.contracts.length, 2);
    assert.strictEqual(second.client.status, 'paid');

    const cancelled = await crm.cancelContract(second.client._id, second.contract.id, 'test');
    assert(cancelled, 'contract cancellation should succeed');
    assert.strictEqual(cancelled.client.status, 'cancelled');
    assert.strictEqual(cancelled.contract.contractStatus, 'cancelled');

    console.log('CRM contract sync: PASS');
  } finally {
    await new Promise(resolve => setTimeout(resolve, 20));
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
