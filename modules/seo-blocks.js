// Shared HTML fragments reused across low-content registry item pages
// (banks, mfo, lombards, collectors, insurance, gsi) to add genuine,
// useful educational content and reduce thin-content pages.

const { escapeHtml } = require('./html');

function lowContentBoost(opts) {
  opts = opts || {};
  var entityLabel = escapeHtml(opts.entityLabel || 'эта организация');
  var entityLabelGenitive = escapeHtml(opts.entityLabelGenitive || opts.entityLabel || 'эта организация');
  return ''
    + '<div class="law-faq mt-4" style="max-width:720px;">'
    + '<h2 style="font-size:1.05rem;font-weight:800;margin-bottom:14px;color:#0f2044;">Что делать, если по вам есть взыскание</h2>'
    + '<div style="display:grid;gap:14px;margin-bottom:1.2rem;">'
    + '<div><strong style="font-size:.9rem;color:#0d1f3c;">Что делать, если наложен арест</strong>'
    + '<p style="font-size:.87rem;color:#475569;line-height:1.6;margin:4px 0 0;">Не платите сразу всю сумму. Сначала проверьте по ИИН, кто именно наложил арест — ЧСИ, суд или нотариус — и на каком основании. Это определяет дальнейшие шаги.</p></div>'
    + '<div><strong style="font-size:.9rem;color:#0d1f3c;">Как проверить основание взыскания</strong>'
    + '<p style="font-size:.87rem;color:#475569;line-height:1.6;margin:4px 0 0;">Запросите у ' + entityLabelGenitive + ' или у ЧСИ копию исполнительного документа: решение суда, исполнительную надпись нотариуса или постановление. Без этого документа сложно оценить законность требования.</p></div>'
    + '<div><strong style="font-size:.9rem;color:#0d1f3c;">Когда можно обжаловать</strong>'
    + '<p style="font-size:.87rem;color:#475569;line-height:1.6;margin:4px 0 0;">Постановление ЧСИ можно обжаловать в течение 10 рабочих дней. Исполнительную надпись нотариуса — возражением в те же сроки с момента, когда вы узнали о ней. После истечения срока обжаловать сложнее.</p></div>'
    + '<div><strong style="font-size:.9rem;color:#0d1f3c;">Что отправить юристу</strong>'
    + '<p style="font-size:.87rem;color:#475569;line-height:1.6;margin:4px 0 0;">ИИН, скрин уведомления об аресте, постановление ЧСИ (если есть), название банка или организации-взыскателя и номер телефона для связи. Это позволяет разобраться в ситуации без личной встречи.</p></div>'
    + '</div>'
    + '<div class="law-faq-item"><button class="law-faq-question" aria-expanded="false">Может ли ' + entityLabel + ' самостоятельно арестовать счёт?'
    + '<span class="law-faq-question-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg></span></button>'
    + '<div class="law-faq-answer"><p>Нет. Арестовать счёт может только ЧСИ на основании исполнительного документа (решения суда, исполнительной надписи нотариуса) или сам суд. Организация-взыскатель только инициирует процесс.</p></div></div>'
    + '<div class="law-faq-item"><button class="law-faq-question" aria-expanded="false">Сколько времени есть на обжалование?'
    + '<span class="law-faq-question-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg></span></button>'
    + '<div class="law-faq-answer"><p>Как правило, 10 рабочих дней — и для постановления ЧСИ, и для возражения на исполнительную надпись нотариуса. Не затягивайте с обращением, если не согласны с суммой или основанием.</p></div></div>'
    + '</div>'
    + '<script>document.querySelectorAll(".law-faq-question").forEach(function(btn){btn.addEventListener("click",function(){var item=btn.closest(".law-faq-item");var isOpen=item.classList.contains("open");document.querySelectorAll(".law-faq-item.open").forEach(function(i){i.classList.remove("open");});if(!isOpen)item.classList.add("open");btn.setAttribute("aria-expanded",!isOpen);});});</script>';
}

module.exports = { lowContentBoost };
