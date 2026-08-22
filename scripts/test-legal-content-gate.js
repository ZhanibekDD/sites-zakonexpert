'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

const FILES = Object.freeze({
  home: 'public/index.html',
  kaspi: 'public/arest-kaspi.html',
  halyk: 'public/arest-halyk-bank.html',
  freedom: 'public/arest-freedom-bank.html',
  account: 'public/snyatie-aresta-so-scheta.html',
  travel: 'public/zapret-na-vyezd-iz-kazahstana.html',
  sms: 'public/sms-1414.html',
  chsiCosts: 'public/ubrat-procenty-i-rashody-chsi.html',
  chsiAfterPayment: 'public/chsi-ne-snimaet-arest-posle-oplaty.html',
});

const CANONICALS = Object.freeze({
  home: 'https://zakonexpertt.kz/',
  kaspi: 'https://zakonexpertt.kz/arest-kaspi',
  halyk: 'https://zakonexpertt.kz/arest-halyk-bank',
  freedom: 'https://zakonexpertt.kz/arest-freedom-bank',
  account: 'https://zakonexpertt.kz/snyatie-aresta-so-scheta',
  travel: 'https://zakonexpertt.kz/zapret-na-vyezd-iz-kazahstana',
  sms: 'https://zakonexpertt.kz/sms-1414',
  chsiCosts: 'https://zakonexpertt.kz/ubrat-procenty-i-rashody-chsi',
  chsiAfterPayment: 'https://zakonexpertt.kz/chsi-ne-snimaet-arest-posle-oplaty',
});

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function assertIncludes(text, snippet, label) {
  assert(text.includes(snippet), `${label}: required safe wording is missing`);
}

function assertExcludes(text, snippet, label) {
  assert(!text.includes(snippet), `${label}: obsolete risky wording is still present`);
}

function extractCanonical(html) {
  const match = html.match(/<link\s+rel=["']canonical["']\s+href=["']([^"']+)["']/i);
  return match ? match[1] : '';
}

function validateJsonLd(html, label) {
  const blocks = [...html.matchAll(/<script\s+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  assert(blocks.length > 0, `${label}: no JSON-LD blocks found`);
  blocks.forEach((match, index) => {
    const source = match[1].replace(/^\uFEFF/, '').trim();
    try {
      JSON.parse(source);
    } catch (error) {
      throw new Error(`${label}: invalid JSON-LD block ${index + 1}: ${error.message}`);
    }
  });
}

function assertNoUniversalClaims(text, label) {
  const banned = [
    [/исполнительск(?:ий|ого)\s+сбор[^.!?]{0,80}25\s*%/iu, 'universal 25% ChSI fee'],
    [/ЧСИ\s+бер[её]т[^.!?]{0,80}25\s*%/iu, 'universal 25% ChSI fee'],
    [/исполнительск(?:ий|ого)\s+сбор\s*\(10\s*%\)/iu, 'universal 10% ChSI fee'],
    [/ЧСИ\s+обязан[^.!?]{0,120}в\s+течение\s+1\s+рабочего\s+дня/iu, 'universal one-working-day removal'],
    [/банк[^.!?]{0,120}(?:в\s+течение\s+1[–-]3\s+рабочих\s+дн|1[–-]3\s+дн)/iu, 'fixed bank processing period'],
    [/пограничн[^.!?]{0,120}1[–-]3\s+дн/iu, 'fixed border database period'],
    [/(?:от\s+нескольких\s+дней\s+до\s+)?2[–-]3\s+недел/iu, 'fixed two-to-three-week legal outcome'],
    [/4[–-]8\s+недел/iu, 'fixed four-to-eight-week legal outcome'],
    [/10\s+рабочих\s+дней[^.!?]{0,100}(?:до\s+того|могут\s+наложить|наложат)\s+(?:арест|ограничен)/iu, 'universal ten-day enforcement sequence'],
    [/после\s+этого\s+суд\s+откажет[^.!?]{0,160}восстановлен/iu, 'categorical refusal to restore deadline'],
    [/сумм[аы]\s+прожиточного\s+минимума[^.!?]{0,100}(?:не\s+может\s+быть\s+арестован|должна\s+оставаться\s+доступной)/iu, 'universal living-minimum availability'],
    [/банк\s+(?:обязан\s+)?исполн(?:яет|ить)[^.!?]{0,80}исполнительн(?:ую|ой)\s+надпис/iu, 'bank directly executes notarial writ'],
    [/банк\s+обязан\s+предоставить\s+копи/iu, 'universal bank copy duty'],
    [/банк\s+обязан\s+уведомить[^.!?]{0,80}причин/iu, 'universal bank notice duty'],
    [/все\s+действия\s+вед[её]т\s+адвокат/iu, 'universal lawyer-only service claim'],
    [/долг(?:е|а)?\s+от\s+40\s+МРП/iu, 'universal 40 MRP travel threshold claim'],
    [/ограничений\s+пока\s+нет/iu, 'SMS falsely guarantees no restrictions'],
    [/сч[её]т\s+не\s+заблокирован[^.!?]{0,100}выезд\s+не\s+запрещ[её]н/iu, 'SMS falsely guarantees no restrictions'],
    [/первоначальн(?:ый|ого)\s+взнос[^.!?]{0,80}10[–-]20\s*%[^.!?]{0,120}аресты\s+снимаются\s+сразу/iu, 'universal settlement terms and immediate release'],
    [/снимем\s+(?:арест|ограничен)[^.!?]{0,40}за\s+\d+/iu, 'guaranteed removal deadline'],
  ];

  banned.forEach(([pattern, description]) => {
    assert(!pattern.test(text), `${label}: ${description}: ${pattern}`);
  });
}

function main() {
  const pages = Object.fromEntries(Object.entries(FILES).map(([key, relativePath]) => [key, read(relativePath)]));

  Object.entries(pages).forEach(([key, html]) => {
    assert.strictEqual(extractCanonical(html), CANONICALS[key], `${FILES[key]} canonical changed`);
    validateJsonLd(html, FILES[key]);
    assertNoUniversalClaims(html, FILES[key]);
  });

  const all = Object.values(pages).join('\n');
  [
    'К долгу добавили 25% — хотят слишком много',
    'Убираем 25% сбор ЧСИ',
    'Про 25% — важно знать:',
    'ЧСИ обязан снять ограничения в течение 1 рабочего дня после оплаты',
    'После этого суд откажет в восстановлении срока',
    'У вас есть 10 рабочих дней до того, как наложат аресты',
    'Счёт не заблокирован, выезд не запрещён',
    'Аресты снимаются сразу после подписания',
    'Исполнительский сбор (10%)',
    '"totalTime": "P14D"',
  ].forEach(snippet => assertExcludes(all, snippet, snippet));

  assertIncludes(pages.home, 'договорная', 'homepage structured price range');
  assertIncludes(pages.home, 'Реализуем правовой маршрут', 'homepage process');
  assertIncludes(pages.home, 'риск пропуска процессуального срока', 'homepage deadline warning');
  assertIncludes(pages.kaspi, 'банк обычно исполняет поступившее постановление или распоряжение', 'Kaspi role of bank');
  assertIncludes(pages.halyk, 'может исходить от ЧСИ, суда, КГД либо быть связано с внутренней проверкой банка', 'Halyk source separation');
  assertIncludes(pages.freedom, 'банковский и брокерский счета нельзя автоматически считать одним продуктом', 'Freedom entity separation');
  assertIncludes(pages.account, 'Фактическое обновление доступа зависит от документа', 'account processing qualification');
  assertIncludes(pages.account, 'href="/#checker-section"', 'account checker canonical anchor');
  assertIncludes(pages.travel, 'не подтверждает сама по себе наличие действующего запрета', 'travel verification qualification');
  assertIncludes(pages.sms, 'универсальной ставки 25% нет', 'SMS ChSI fee qualification');
  assertIncludes(pages.sms, 'По одному SMS нельзя определить, какие меры уже действуют', 'SMS restriction qualification');
  assertIncludes(pages.chsiCosts, 'не является универсальными 10%', 'ChSI fee scale qualification');

  console.log('Legal content gate: OK');
}

main();
