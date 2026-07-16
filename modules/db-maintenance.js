'use strict';

const DEFAULT_AUTOCOMPACTION_MS = 6 * 60 * 60 * 1000;
const MIN_AUTOCOMPACTION_MS = 5 * 60 * 1000;

function getAutocompactionInterval() {
  const configured = Number(process.env.DB_AUTOCOMPACTION_MS);
  if (!Number.isFinite(configured) || configured <= 0) {
    return DEFAULT_AUTOCOMPACTION_MS;
  }
  return Math.max(configured, MIN_AUTOCOMPACTION_MS);
}

function enableAutocompaction(datastore) {
  if (!datastore || typeof datastore.setAutocompactionInterval !== 'function') {
    return datastore;
  }

  datastore.setAutocompactionInterval(getAutocompactionInterval());

  // Automatic maintenance must not keep one-off import scripts alive.
  const timer = datastore._autocompactionIntervalId;
  if (timer && typeof timer.unref === 'function') timer.unref();

  return datastore;
}

async function compactDatastore(datastore) {
  if (!datastore) throw new Error('Datastore is required');
  if (typeof datastore.load === 'function') await datastore.load();

  if (typeof datastore.compactDatafileAsync === 'function') {
    await datastore.compactDatafileAsync();
    return;
  }

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Database compaction timed out')), 120000);
    const done = () => {
      clearTimeout(timeout);
      resolve();
    };

    if (typeof datastore.once === 'function') datastore.once('compactionDone', done);
    datastore.persistence.compactDatafile();
  });
}

module.exports = {
  DEFAULT_AUTOCOMPACTION_MS,
  compactDatastore,
  enableAutocompaction,
  getAutocompactionInterval,
};
