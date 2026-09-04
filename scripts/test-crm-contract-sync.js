'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zke-crm-test-'));
process.env.CRM_DB_PATH = path.join(tmp, 'crm.db');
process.env.CRM_META_DB_PATH = path.join(tmp, 'crm-meta.db');
process.env.CRM_JOB_DB_PATH = path.join(tmp, 'crm-jobs.db');
process.env.CRM_BACKUP_DIR = path.join(tmp, 'backups');
process.env.CRM_CONTRACT_UPLOAD_DIR = path.join(tmp, 'contract-uploads');
process.env.CRM_BACKUP_KEEP_DAYS = '7';

const crm = require('../modules/crm-db');
const jobs = require('../modules/crm-generation-jobs');
const contractImport = require('../modules/crm-contract-import');

(async () => {
  try {
    const first = await crm.upsertContractFromIntegration({
      source: 'dogovora-zakon-Expert', externalContractId: 'dogovora:501', generatorContractId: 501,
      number: '501', amount: 50000, service: 'Снятие ареста со счёта', paymentStatus: 'pending',
      client: { externalClientId: 'dogovora:71', name: 'Тестов Тест Тестович', iin: '900101300123', phone: '+7 700 123 45 67', address: 'г. Алматы' },
    }, 'contract-generator');
    assert(first.created, 'first contract should be created');
    assert.strictEqual(first.client.status, 'contract');
    assert.strictEqual(first.client.iin, '900101300123');
    assert.strictEqual(first.client.contracts.length, 1);

    const retry = await crm.upsertContractFromIntegration({
      source: 'dogovora-zakon-Expert', externalContractId: 'dogovora:501', generatorContractId: 501,
      number: '501', amount: 55000, service: 'Снятие ареста со счёта — уточнено', paymentStatus: 'pending',
      client: { externalClientId: 'dogovora:71', name: 'Тестов Тест Тестович', iin: '900101300123', phone: '+7 700 123 45 67' },
    }, 'contract-generator');
    assert(!retry.created, 'retry must update instead of duplicating');
    assert.strictEqual(retry.client.contracts.length, 1);
    assert.strictEqual(retry.contract.amount, 55000);

    const second = await crm.upsertContractFromIntegration({
      source: 'dogovora-zakon-Expert', externalContractId: 'dogovora:502', generatorContractId: 502,
      number: '502', amount: 25000, service: 'Заявление на график', paymentStatus: 'paid',
      client: { externalClientId: 'dogovora:71', name: 'Тестов Тест Тестович', iin: '900101300123', phone: '+7 700 123 45 67' },
    }, 'contract-generator');
    assert.strictEqual(second.client._id, first.client._id, 'IIN/external id should resolve same client');
    assert.strictEqual(second.client.contracts.length, 2);
    assert.strictEqual(second.client.status, 'paid');

    const cancelled = await crm.cancelContract(second.client._id, second.contract.id, 'test');
    assert(cancelled, 'contract cancellation should succeed');
    assert.strictEqual(cancelled.client.status, 'cancelled');
    assert.strictEqual(cancelled.contract.contractStatus, 'cancelled');

    const queued = await jobs.createJob({
      clientId: first.client._id,
      name: 'Тестов Тест Тестович', iin: '900101300123', phone: '+7 700 123 45 67',
      service: 'Отмена исполнительной надписи', amount: 60000, paymentType: 'prepayment',
    }, 'test');
    assert.strictEqual(queued.kind, jobs.KINDS.CREATE);
    assert.strictEqual(queued.status, 'pending');
    assert.strictEqual(queued.payload.iin, '900101300123');

    const claimed = await jobs.claimNext('worker-test');
    assert(claimed, 'job should be claimed');
    assert.strictEqual(claimed.id, queued.id);
    assert.strictEqual(claimed.status, 'claimed');
    assert.strictEqual(claimed.attempts, 1);

    const heartbeat = await jobs.heartbeat(queued.id, 'worker-test');
    assert(heartbeat, 'heartbeat should extend lease');

    const completed = await jobs.complete(queued.id, { clientId: first.client._id, contractId: 'crm-contract-1', number: '503', generatorContractId: '503' });
    assert.strictEqual(completed.status, 'complete');
    assert.strictEqual(completed.result.number, '503');

    const noMore = await jobs.claimNext('worker-test');
    assert.strictEqual(noMore, null, 'completed jobs must not be claimed again');

    const failed = await jobs.createJob({ name: 'Другой Клиент', iin: '900101300124', service: 'График', amount: 10000 }, 'test');
    await jobs.claimNext('worker-test');
    await jobs.fail(failed.id, 'TEST_FAILURE');
    const failedRead = await jobs.getJob(failed.id);
    assert.strictEqual(failedRead.status, 'failed');
    const retried = await jobs.retry(failed.id);
    assert.strictEqual(retried.status, 'pending');
    const reclaimed = await jobs.claimNext('worker-test');
    assert.strictEqual(reclaimed.id, failed.id);
    await jobs.complete(failed.id, { number: 'retry-ok' });

    const fakePdf = Buffer.from('%PDF-1.4\nZakonExpert integration test\n%%EOF\n', 'utf8');
    const stored = contractImport.storeUpload(fakePdf, 'Старый договор №77.pdf');
    assert(fs.existsSync(stored.storedFile), 'private uploaded file should be stored');
    const importJob = await jobs.createImportJob({
      filename: 'Старый договор №77.pdf',
      mimeType: 'application/pdf',
      sha256: stored.sha256,
      storedFile: stored.storedFile,
    }, 'test');
    assert.strictEqual(importJob.kind, jobs.KINDS.PARSE);
    const importClaim = await jobs.claimNext('worker-import');
    assert.strictEqual(importClaim.id, importJob.id);
    assert.strictEqual(importClaim.kind, jobs.KINDS.PARSE);
    assert.strictEqual(importClaim.payload.sha256, stored.sha256);

    const imported = await contractImport.saveParsedImport({
      parsed: {
        name: 'Тестов Тест Тестович',
        iin: '900101300123',
        phone: '+7 700 123 45 67',
        address: 'г. Алматы, ул. Тестовая 1',
        number: '77',
        date: '2026-08-30',
        amount: 70000,
        currency: 'KZT',
        service: 'Снятие ограничений ЧСИ',
        paymentType: 'prepayment',
      },
      storedFile: stored.storedFile,
      filename: 'Старый договор №77.pdf',
      mimeType: 'application/pdf',
      sha256: stored.sha256,
    });
    assert.strictEqual(imported.client._id, first.client._id, 'uploaded contract should attach by IIN');
    assert.strictEqual(imported.contract.number, '77');
    assert.strictEqual(imported.contract.amount, 70000);
    assert.strictEqual(imported.contract.storedFile, stored.storedFile);

    const importCompleted = await jobs.complete(importJob.id, {
      clientId: imported.client._id,
      contractId: imported.contract.id,
      number: imported.contract.number,
      filename: 'Старый договор №77.pdf',
      imported: true,
    });
    assert.strictEqual(importCompleted.status, 'complete');
    assert.strictEqual(importCompleted.result.imported, true);

    console.log('CRM contract sync + create/import pull queues: PASS');
  } finally {
    await new Promise(resolve => setTimeout(resolve, 60));
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
