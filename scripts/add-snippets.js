'use strict';
// Migration: adds snippet field (first 300 chars of text) to existing law articles
// Run: node scripts/add-snippets.js

const Datastore = require('nedb-promises');
const path = require('path');

const db = Datastore.create({
  filename: path.join(__dirname, '..', 'data', 'laws.db'),
  autoload: true,
});

async function main() {
  const all = await db.find({});
  console.log(`Total articles: ${all.length}`);
  let updated = 0;
  for (const doc of all) {
    if (doc.text) {
      // Take first 300 chars, collapse newlines to spaces, trim to last full word
      let snippet = doc.text.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300);
      const lastSpace = snippet.lastIndexOf(' ');
      if (lastSpace > 200) snippet = snippet.slice(0, lastSpace);
      await db.update({ _id: doc._id }, { $set: { snippet } });
      updated++;
    }
  }
  console.log(`✅ Обновлено статей: ${updated}`);
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
