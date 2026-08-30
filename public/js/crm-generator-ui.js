'use strict';

(() => {
  if (!location.pathname.startsWith('/crm')) return;

  const qs = selector => document.querySelector(selector);
  const csrf = qs('form[action="/crm/logout"] input[name="_csrf"]')?.value || '';
  let boundClientId = '';

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function toast(text) {
    const existing = qs('#toast');
    if (existing) {
      existing.textContent = text;
      existing.classList.add('show');
      setTimeout(() => existing.classList.remove('show'), 3200);
      return;
    }
    alert(text);
  }

  const style = document.createElement('style');
  style.textContent = `
    #crmGenModal{position:fixed;inset:0;background:rgba(15,23,42,.52);display:none;place-items:center;z-index:120;padding:18px}
    #crmGenModal.show{display:grid}
    .crm-gen-card{width:min(860px,100%);max-height:94vh;overflow:auto;background:#fff;border-radius:16px;padding:20px;box-shadow:0 30px 90px rgba(15,23,42,.30)}
    .crm-gen-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;margin-bottom:14px}
    .crm-gen-head h2{margin:0;font-size:21px}.crm-gen-head p{margin:4px 0 0;color:#6c788b;font-size:12px}
    .crm-gen-grid{display:grid;grid-template-columns:1fr 1fr;gap:9px}.crm-gen-grid.three{grid-template-columns:repeat(3,1fr)}
    .crm-gen-label{display:block;font-size:10px;color:#6c788b;font-weight:800;margin:0 0 4px}
    .crm-gen-field{width:100%;border:1px solid #cfd8e6;border-radius:9px;background:#fff;padding:9px 10px;outline:none;font:inherit}
    textarea.crm-gen-field{min-height:78px;resize:vertical}
    .crm-gen-field:focus{border-color:#5bb6b0;box-shadow:0 0 0 3px rgba(15,118,110,.10)}
    .crm-gen-section{border-top:1px solid #e5eaf1;padding-top:12px;margin-top:12px}
    .crm-gen-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:14px}
    .crm-gen-note{font-size:11px;color:#6c788b;line-height:1.45}.crm-gen-progress{display:none;font-size:12px;color:#0f766e;font-weight:800}
    @media(max-width:720px){.crm-gen-grid,.crm-gen-grid.three{grid-template-columns:1fr}}
  `;
  document.head.appendChild(style);

  const modal = document.createElement('div');
  modal.id = 'crmGenModal';
  modal.innerHTML = `
    <div class="crm-gen-card">
      <div class="crm-gen-head">
        <div><h2>Сформировать договор</h2><p>Тот же генератор ZakonExpert: итоговый PDF + DOCX и автоматическая карточка в CRM.</p></div>
        <button class="btn small" type="button" id="crmGenClose">Закрыть</button>
      </div>
      <div class="crm-gen-grid">
        <div><label class="crm-gen-label">ФИО клиента *</label><input class="crm-gen-field" id="crmGenName"></div>
        <div><label class="crm-gen-label">ИИН *</label><input class="crm-gen-field" id="crmGenIin" maxlength="12" inputmode="numeric"></div>
        <div><label class="crm-gen-label">Телефон</label><input class="crm-gen-field" id="crmGenPhone" placeholder="+7 700 000 00 00"></div>
        <div><label class="crm-gen-label">Адрес</label><input class="crm-gen-field" id="crmGenAddress"></div>
      </div>
      <div class="crm-gen-section">
        <label class="crm-gen-label">Услуга / что нужно сделать *</label>
        <textarea class="crm-gen-field" id="crmGenService" placeholder="Например: отмена исполнительной надписи и снятие ограничений ЧСИ"></textarea>
      </div>
      <div class="crm-gen-grid three" style="margin-top:9px">
        <div><label class="crm-gen-label">Стоимость, ₸ *</label><input class="crm-gen-field" id="crmGenAmount" type="number" min="1" step="1"></div>
        <div><label class="crm-gen-label">Порядок оплаты</label><select class="crm-gen-field" id="crmGenPayment"><option value="prepayment">Предоплата до начала работ</option><option value="after_result">После результата</option><option value="split">50/50 / двумя платежами</option><option value="already_paid">Уже оплачено</option></select></div>
        <div><label class="crm-gen-label">Срок работы</label><input class="crm-gen-field" id="crmGenPeriod" value="до 30 календарных дней"></div>
      </div>
      <div class="crm-gen-grid" id="crmGenSplit" style="margin-top:9px;display:none">
        <div><label class="crm-gen-label">Первый платёж, ₸</label><input class="crm-gen-field" id="crmGenFirst" type="number" min="0"></div>
        <div><label class="crm-gen-label">Второй платёж, ₸</label><input class="crm-gen-field" id="crmGenSecond" type="number" min="0"></div>
      </div>
      <div class="crm-gen-grid crm-gen-section">
        <div><label class="crm-gen-label">Что входит в работу / детали</label><textarea class="crm-gen-field" id="crmGenDetails" placeholder="Можно перечислить через новую строку"></textarea></div>
        <div><label class="crm-gen-label">Результат договора</label><textarea class="crm-gen-field" id="crmGenResult" placeholder="Необязательно — если пусто, генератор подберёт формулировку"></textarea></div>
      </div>
      <div class="crm-gen-actions">
        <button class="btn primary" type="button" id="crmGenSubmit">Создать PDF + DOCX</button>
        <button class="btn" type="button" id="crmGenCancel">Отмена</button>
        <span class="crm-gen-progress" id="crmGenProgress">Формирую договор… это может занять до минуты.</span>
      </div>
      <div class="crm-gen-note" style="margin-top:10px">После создания договор автоматически появится в этой сделке и в стадии «Договор создан». Повторно вручную добавлять его не нужно.</div>
    </div>`;
  document.body.appendChild(modal);

  function field(id) { return qs(`#${id}`); }
  function closeModal() { modal.classList.remove('show'); }

  function drawerClientId() {
    const card = qs('.deal.dragging');
    if (card?.dataset?.id) return card.dataset.id;
    return boundClientId;
  }

  function readDrawer() {
    return {
      name: field('cName')?.value || '',
      iin: field('cIin')?.value || '',
      phone: field('cPhone')?.value || '',
      address: field('cAddress')?.value || '',
      service: field('dService')?.value || field('cWork')?.value || field('cIssue')?.value || '',
      amount: field('dAmount')?.value || '',
    };
  }

  function clearGenerator() {
    ['crmGenName','crmGenIin','crmGenPhone','crmGenAddress','crmGenService','crmGenAmount','crmGenDetails','crmGenResult','crmGenFirst','crmGenSecond']
      .forEach(id => { if (field(id)) field(id).value = ''; });
    field('crmGenPayment').value = 'prepayment';
    field('crmGenPeriod').value = 'до 30 календарных дней';
    field('crmGenSplit').style.display = 'none';
  }

  function openGenerator(fromDrawer = false) {
    clearGenerator();
    boundClientId = '';
    if (fromDrawer) {
      const data = readDrawer();
      field('crmGenName').value = data.name;
      field('crmGenIin').value = data.iin;
      field('crmGenPhone').value = data.phone;
      field('crmGenAddress').value = data.address;
      field('crmGenService').value = data.service;
      field('crmGenAmount').value = data.amount;
      const title = qs('#drawerTitle')?.textContent || '';
      const match = [...document.querySelectorAll('.deal')].find(el => (el.querySelector('.deal-name')?.textContent || '') === title);
      boundClientId = match?.dataset?.id || '';
    }
    modal.classList.add('show');
    setTimeout(() => field(fromDrawer && field('crmGenIin').value ? 'crmGenService' : 'crmGenName')?.focus(), 50);
  }

  async function submitContract() {
    const payload = {
      clientId: boundClientId,
      name: field('crmGenName').value.trim(),
      iin: field('crmGenIin').value.replace(/\D/g, ''),
      phone: field('crmGenPhone').value.trim(),
      address: field('crmGenAddress').value.trim(),
      service: field('crmGenService').value.trim(),
      amount: field('crmGenAmount').value,
      paymentType: field('crmGenPayment').value,
      firstPayment: field('crmGenFirst').value,
      secondPayment: field('crmGenSecond').value,
      workPeriod: field('crmGenPeriod').value.trim(),
      serviceDetails: field('crmGenDetails').value,
      resultDefinition: field('crmGenResult').value.trim(),
    };
    if (payload.name.length < 3) return toast('Укажите ФИО клиента');
    if (payload.iin.length !== 12) return toast('ИИН должен содержать 12 цифр');
    if (!payload.service) return toast('Укажите услугу');
    if (!Number(payload.amount)) return toast('Укажите стоимость договора');

    field('crmGenSubmit').disabled = true;
    field('crmGenProgress').style.display = 'inline';
    try {
      const response = await fetch('/api/crm/generator/create', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'X-CSRF-Token': csrf,
        },
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => ({}));
      if (response.status === 401) {
        location.href = '/crm/login';
        return;
      }
      if (!response.ok) throw new Error(data.error || 'Не удалось сформировать договор');
      closeModal();
      toast(`Договор${data.number ? ` №${data.number}` : ''} создан. Обновляю CRM…`);
      setTimeout(() => location.reload(), 900);
    } catch (error) {
      toast(error.message || 'Ошибка создания договора');
    } finally {
      field('crmGenSubmit').disabled = false;
      field('crmGenProgress').style.display = 'none';
    }
  }

  function addTopButton() {
    if (qs('#crmGenTop')) return;
    const actions = qs('.top-actions');
    if (!actions) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.id = 'crmGenTop';
    button.className = 'btn primary';
    button.textContent = '✦ Создать договор';
    button.onclick = () => openGenerator(false);
    const importButton = qs('#importContract');
    actions.insertBefore(button, importButton || actions.firstChild);
  }

  function addDrawerButton() {
    const manual = qs('#addContract');
    if (!manual || qs('#crmGenDrawer')) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.id = 'crmGenDrawer';
    button.className = 'btn primary';
    button.textContent = '✦ Сформировать PDF + DOCX';
    button.onclick = () => openGenerator(true);
    manual.parentElement?.insertBefore(button, manual);
  }

  field('crmGenClose').onclick = closeModal;
  field('crmGenCancel').onclick = closeModal;
  field('crmGenSubmit').onclick = submitContract;
  field('crmGenPayment').onchange = () => {
    field('crmGenSplit').style.display = field('crmGenPayment').value === 'split' ? 'grid' : 'none';
  };
  modal.addEventListener('click', event => { if (event.target === modal) closeModal(); });

  addTopButton();
  addDrawerButton();
  const observer = new MutationObserver(() => addDrawerButton());
  const drawer = qs('#drawerBody');
  if (drawer) observer.observe(drawer, { childList: true, subtree: true });
})();
