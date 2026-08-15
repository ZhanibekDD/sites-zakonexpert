'use strict';

const assert = require('assert');
const path = require('path');
const ejs = require('ejs');
const { TOOLS, findTool } = require('../modules/tools-catalog');
const { parseArgs } = require('./submit-indexnow');

const root = path.join(__dirname, '..');

async function run() {
  const hub = await ejs.renderFile(path.join(root, 'views', 'tools', 'index.ejs'), { tools: TOOLS });
  assert(hub.includes('Проверки и юридические калькуляторы'));
  assert(hub.includes('https://zakonexpertt.kz/tools'));
  assert(hub.includes('/tools/payment-plan'));
  assert(hub.includes('/calculator'));
  assert(hub.includes('/proverka-kontragenta'));
  assert.strictEqual(parseArgs([]).all, false, 'IndexNow full submission must be opt-in');
  assert.strictEqual(parseArgs(['--all']).all, true);
  assert.strictEqual(parseArgs(['--sitemap=sitemap-laws.xml']).sitemap, 'sitemap-laws.xml');

  for (const slug of ['payment-plan', 'mrp', 'state-duty', 'deadline']) {
    const tool = findTool(slug);
    assert(tool, `${slug}: config missing`);
    const html = await ejs.renderFile(path.join(root, 'views', 'tools', 'tool.ejs'), { tool, tools: TOOLS });
    assert(html.includes(tool.title), `${slug}: title missing`);
    assert(html.includes(`https://zakonexpertt.kz${tool.href}`), `${slug}: canonical missing`);
    assert(html.includes('calculator_completed'), `${slug}: analytics missing`);
    assert(html.includes('index, follow'), `${slug}: tool must be indexable`);
    const inline = html.match(/<script>\(function\(\)\{([\s\S]*?)<\/script>/);
    assert(inline, `${slug}: calculator script missing`);
    assert.doesNotThrow(() => new Function(`(function(){${inline[1]}`), `${slug}: invalid calculator JavaScript`);
  }
  console.log('Tools OK: hub, four calculators, SEO metadata and client formulas');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
