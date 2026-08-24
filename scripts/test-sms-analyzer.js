'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const analyzer = require('../public/js/sms-analyzer');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'public', 'sms-1414.html'), 'utf8');
const script = fs.readFileSync(path.join(root, 'public', 'js', 'sms-analyzer.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'public', 'css', 'sms-analyzer.css'), 'utf8');

const cases = [
  ['На вас совершена исполнительная надпись нотариуса', 'notary'],
  ['Возбуждено исполнительное производство. ЧСИ сообщает об исполнительной надписи', 'notary_enforcement'],
  ['ЧСИ возбудил исполнительное производство № 123', 'enforcement'],
  ['Установлено временное ограничение на выезд из Республики Казахстан', 'travel'],
  ['Исполнительный лист выдан на основании решения суда', 'court'],
  ['Ваша заявка на получение справки готова', 'unknown'],
];

for (const [message, expected] of cases) {
  assert.strictEqual(analyzer.classifySms(message).id, expected, `Wrong route for: ${message}`);
}
assert.strictEqual(analyzer.classifySms('   ').id, 'empty', 'Empty input must not create a route');
assert.strictEqual(Object.keys(analyzer.routes).length, 6, 'Six safe fixed routes are required');

assert(html.includes('data-sms-analyzer'), 'Analyzer container is missing');
assert(html.includes('data-sms-input'), 'SMS input is missing');
assert(html.includes('/css/sms-analyzer.css?v=20260824-1'), 'Dedicated stylesheet is missing');
assert(html.includes('/js/sms-analyzer.js?v=20260824-1'), 'Dedicated analyzer script is missing');
assert(html.includes('не отправляется на сервер'), 'Browser-only privacy notice is missing');
assert(html.includes('https://adilet.zan.kz/rus/docs/Z100000261_'), 'Official enforcement law source is missing');
assert(html.includes('https://adilet.zan.kz/rus/docs/Z970000155_'), 'Official notary law source is missing');
assert(html.includes('от 3% до 25%'), 'Accurate ChSI fee range is missing');
assert(!html.includes('Через 10 рабочих дней — могут наложить ограничения'), 'False ten-day restriction claim remains');
assert(!html.includes('Пока ещё ничего плохого не произошло'), 'False no-restrictions claim remains');
assert(!html.includes('ЧСИ берёт исполнительский сбор — 25%'), 'False universal 25% claim remains');

assert(!/fetch\s*\(|XMLHttpRequest|sendBeacon|localStorage|sessionStorage/.test(script), 'SMS text must remain browser-only and ephemeral');
assert(!/input\.value[^\n]*(?:trackEvent|wa\.me)|encodeURIComponent\(input\.value\)/.test(script), 'Raw SMS text must not enter analytics or WhatsApp');
assert(script.includes("'calculator_completed'"), 'Anonymous completion event is missing');
assert(script.includes("document_type: match.id"), 'Only the fixed route id should be measured');
assert(css.includes('@media (max-width: 560px)'), 'Mobile layout is missing');
assert(css.includes('@media (prefers-reduced-motion: reduce)'), 'Reduced-motion support is missing');

console.log('SMS 1414 analyzer OK: six routes, browser-only text, accurate legal guardrails and measurable completion.');
