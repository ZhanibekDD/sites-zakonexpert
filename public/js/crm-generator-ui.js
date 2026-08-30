'use strict';

(() => {
  if (!location.pathname.startsWith('/crm')) return;

  const $ = s => document.querySelector(s);
  const csrf = $('form[action="/crm/logout"] input[name="_csrf"]')?.value || '';
  let boundClientId = '';
  let activeJobId = '';
  let pollTimer = null;

  function toast(text, ms = 3500) {
    const el = $('#toast');
    if (!el) return alert(text);
    el.textContent = text;
    el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), ms);
  }

  async function jsonFetch(url, options = {}) {
    const response = await fetch(url, { credentials: 'same-origin', ...options });
    if (response.status === 401) {
      location.href = '/crm/login';
      throw new Error('Сессия завершена');
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Ошибка запроса');
    return data;
  }

  const style = document.createElement('style');
  style.textContent = `
    #crmGenModal{position:fixed;inset:0;background:rgba(15,23,42,.52);display:none;place-items:center;z-index:120;padding:18px}
    #crmGenModal.show{display:grid}.crm-gen-card{width:min(860px,100%);max-height:94vh;overflow:auto;background:#fff;border-radius:16px;padding:20px;box-shadow:0 30px 90px rgba(15,23,42,.30)}
    .crm-gen-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;margin-bottom:14px}.crm-gen-head h2{margin:0;font-size:21px}.crm-gen-head p{margin:4px 0 0;color:#6c788b;font-size:12px}
    .crm-gen-grid{display:grid;grid-template-columns:1fr 1fr;gap:9px}.crm-gen-grid.three{grid-template-columns:repeat(3,1fr)}.crm-gen-label{display:block;font-size:10px;color:#6c788b;font-weight:800;margin:0 0 4px}
    .crm-gen-field{width:100%;border:1px solid #cfd8e6;border-radius:9px;background:#fff;padding:9px 10px;outline:none;font:inherit}textarea.crm-gen-field{min-height:78px;resize:vertical}.crm-gen-field:focus{border-color:#5bb6b0;box-shadow:0 0 0 3px rgba(15,118,110,.10)}
    .crm-gen-section{border-top:1px solid #e5eaf1;padding-top:12px;margin-top:12px}.crm-gen-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:14px}.crm-gen-note{font-size:11px;color:#6c788b;line-height:1.45}
    .crm-gen-progress{display:none;font-size:12px;color:#0f766e;font-weight:800}.crm-gen-progress.show{display:inline}.crm-gen-job{display:none;margin-top:12px;border:1px solid #cfe7e4;background:#f0fdfa;border-radius:10px;padding:10px;font-size:12px}.crm-gen-job.show{display:block}
    @media(max-width:720px){.crm-gen-grid,.crm-gen-grid.three{grid-template-columns:1fr}}
  `;
  document.head.appendChild(style);

  const modal = document.createElement('div');
  modal.id = 'crmGenModal';
  modal.innerHTML = `
    <div class="crm-gen-card">
      <div class="crm-gen-head"><div><h2>Сформировать договор</h2><p>Используется единый генератор ZakonExpert. PDF и DOCX автоматически вернутся в CRM.</p></div><button class="btn small" type="button" id="crmGenClose">Закрыть</button></div>
      <div class="crm-gen-grid">
        <div><label class="crm-gen-label">ФИО клиента *</label><input class="crm-gen-field" id="crmGenName"></div>
        <div><label class="crm-gen-label">ИИН *</label><input class="crm-gen-field" id="crmGenIin" maxlength="12" inputmode="numeric"></div>
        <div><label class="crm-gen-label">Телефон</label><input class="crm-gen-field" id="crmGenPhone" placeholder="+7 700 000 00 00"></div>
        <div><label class="crm-gen-label">Адрес</label><input class="crm-gen-field" id="crmGenAddress"></div>
      </div>
      <div class="crm-gen-section"><label class="crm-gen-label">Услуга / что нужно сделать *</label><textarea class="crm-gen-field" id="crmGenService"></textarea></div>
      <div class="crm-gen-grid three" style="margin-top:9px">
        <div><label class="crm-gen-label">Стоимость, ₸ *</label><input class="crm-gen-field" id="crmGenAmount" type="number" min="1"></div>
        <div><label class="crm-gen-label">Порядок оплаты</label><select class="crm-gen-field" id="crmGenPayment"><option value="prepayment">Предоплата до начала работ</option><option value="after_result">После результата</option><option value="split">Двумя платежами</option><option value="already_paid">Уже оплачено</option></select></div>
        <div><label class="crm-gen-label">Срок работы</label><input class="crm-gen-field" id="crmGenPeriod" value="до 30 календарных дней"></div>
      </div>
      <div class="crm-gen-grid" id="crmGenSplit" style="margin-top:9px;display:none"><div><label class="crm-gen-label">Первый платёж, ₸</label><input class="crm-gen-field" id="crmGenFirst" type="number" min="0"></div><div><label class="crm-gen-label">Второй платёж, ₸</label><input class="crm-gen-field" id="crmGenSecond" type="number" min="0"></div></div>
      <div class="crm-gen-grid crm-gen-section"><div><label class="crm-gen-label">Что входит в работу / детали</label><textarea class="crm-gen-field" id="crmGenDetails"></textarea></div><div><label class="crm-gen-label">Результат договора</label><textarea class="crm-gen-field" id="crmGenResult" placeholder="Можно оставить пустым"></textarea></div></div>
      <div class="crm-gen-actions"><button class="btn primary" type="button" id="crmGenSubmit">Создать PDF + DOCX</button><button class="btn" type="button" id="crmGenCancel">Отмена</button><span class="crm-gen-progress" id="crmGenProgress">Задание передано генератору…</span></div>
      <div class="crm-gen-job" id="crmGenJob"></div>
      <div class="crm-gen-note" style="margin-top:10px">Генератор подключается к CRM исходящим HTTPS-запросом. Открывать его порт или публиковать отдельный API-домен не требуется.</div>
    </div>`;
  document.body.appendChild(modal);

  const f = id => $(`#${id}`);
  function closeModal() { if (!activeJobId) modal.classList.remove('show'); }

  function clearForm() {
    ['crmGenName','crmGenIin','crmGenPhone','crmGenAddress','crmGenService','crmGenAmount','crmGenDetails','crmGenResult','crmGenFirst','crmGenSecond'].forEach(id => { if (f(id)) f(id).value = ''; });
    f('crmGenPayment').value = 'prepayment';
    f('crmGenPeriod').value = 'до 30 календарных дней';
    f('crmGenSplit').style.display = 'none';
    f('crmGenJob').classList.remove('show');
    f('crmGenJob').textContent = '';
  }

  function readDrawer() {
    return {
      name: $('#cName')?.value || '', iin: $('#cIin')?.value || '', phone: $('#cPhone')?.value || '', address: $('#cAddress')?.value || '',
      service: $('#dService')?.value || $('#cWork')?.value || $('#cIssue')?.value || '', amount: $('#dAmount')?.value || '',
    };
  }

  function openGenerator(fromDrawer = false) {
    if (activeJobId) return toast('Сначала дождитесь завершения текущего договора');
    clearForm();
    boundClientId = '';
    if (fromDrawer) {
      const d = readDrawer();
      f('crmGenName').value = d.name; f('crmGenIin').value = d.iin; f('crmGenPhone').value = d.phone; f('crmGenAddress').value = d.address; f('crmGenService').value = d.service; f('crmGenAmount').value = d.amount;
      const title = $('#drawerTitle')?.textContent || '';
      const card = [...document.querySelectorAll('.deal')].find(el => (el.querySelector('.deal-name')?.textContent || '') === title);
      boundClientId = card?.dataset?.id || '';
    }
    modal.classList.add('show');
  }

  function setBusy(busy, text = '') {
    f('crmGenSubmit').disabled = busy;
    f('crmGenCancel').disabled = busy;
    f('crmGenClose').disabled = busy;
    f('crmGenProgress').classList.toggle('show', busy);
    if (text) f('crmGenProgress').textContent = text;
  }

  function stopPolling() {
    if (pollTimer) clearTimeout(pollTimer);
    pollTimer = null;
    activeJobId = '';
  }

  async function pollJob(jobId) {
    try {
      const data = await jsonFetch(`/api/crm/generator/jobs/${encodeURIComponent(jobId)}`);
      const job = data.job || {};
      const box = f('crmGenJob');
      box.classList.add('show');
      if (job.status === 'pending') {
        box.textContent = 'Ожидает генератор. Обычно стартует в течение нескольких секунд.';
        setBusy(true, 'Ожидаю генератор…');
      } else if (job.status === 'claimed') {
        box.textContent = 'Генератор получил задание и формирует DOCX/PDF.';
        setBusy(true, 'Формирую договор…');
      } else if (job.status === 'complete') {
        stopPolling();
        setBusy(false);
        box.textContent = `Готово${job.result?.number ? `: договор №${job.result.number}` : ''}. Карточка обновлена.`;
        toast(`Договор${job.result?.number ? ` №${job.result.number}` : ''} создан`);
        setTimeout(() => location.reload(), 900);
        return;
      } else if (job.status === 'failed') {
        stopPolling();
        setBusy(false);
        box.innerHTML = '';
        box.append(document.createTextNode(`Ошибка: ${job.error || 'генерация не выполнена'} `));
        const retry = document.createElement('button');
        retry.className = 'btn small'; retry.type = 'button'; retry.textContent = 'Повторить';
        retry.onclick = async () => {
          try {
            await jsonFetch(`/api/crm/generator/jobs/${encodeURIComponent(jobId)}/retry`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: '{}' });
            activeJobId = jobId; setBusy(true, 'Повторяю…'); pollJob(jobId);
          } catch (e) { toast(e.message); }
        };
        box.appendChild(retry);
        return;
      }
      pollTimer = setTimeout(() => pollJob(jobId), 1800);
    } catch (error) {
      pollTimer = setTimeout(() => pollJob(jobId), 3000);
    }
  }

  async function submitContract() {
    const payload = {
      clientId: boundClientId,
      name: f('crmGenName').value.trim(), iin: f('crmGenIin').value.replace(/\D/g, ''), phone: f('crmGenPhone').value.trim(), address: f('crmGenAddress').value.trim(),
      service: f('crmGenService').value.trim(), amount: f('crmGenAmount').value, paymentType: f('crmGenPayment').value, firstPayment: f('crmGenFirst').value, secondPayment: f('crmGenSecond').value,
      workPeriod: f('crmGenPeriod').value.trim(), serviceDetails: f('crmGenDetails').value, resultDefinition: f('crmGenResult').value.trim(),
    };
    if (payload.name.length < 3) return toast('Укажите ФИО клиента');
    if (payload.iin.length !== 12) return toast('ИИН должен содержать 12 цифр');
    if (!payload.service) return toast('Укажите услугу');
    if (!Number(payload.amount)) return toast('Укажите стоимость договора');

    setBusy(true, 'Передаю задание…');
    try {
      const data = await jsonFetch('/api/crm/generator/create', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: JSON.stringify(payload) });
      if (data.queued && data.jobId) {
        activeJobId = data.jobId;
        f('crmGenJob').classList.add('show');
        f('crmGenJob').textContent = 'Задание сохранено. Жду, когда генератор его заберёт.';
        return pollJob(data.jobId);
      }
      setBusy(false);
      toast(`Договор${data.number ? ` №${data.number}` : ''} создан`);
      setTimeout(() => location.reload(), 700);
    } catch (error) {
      setBusy(false);
      toast(error.message || 'Ошибка создания договора');
    }
  }

  function addTopButton() {
    if ($('#crmGenTop')) return;
    const actions = $('.top-actions'); if (!actions) return;
    const b = document.createElement('button'); b.type = 'button'; b.id = 'crmGenTop'; b.className = 'btn primary'; b.textContent = '✦ Создать договор'; b.onclick = () => openGenerator(false);
    actions.insertBefore(b, $('#importContract') || actions.firstChild);
  }

  function addDrawerButton() {
    const manual = $('#addContract'); if (!manual || $('#crmGenDrawer')) return;
    const b = document.createElement('button'); b.type = 'button'; b.id = 'crmGenDrawer'; b.className = 'btn primary'; b.textContent = '✦ Сформировать PDF + DOCX'; b.onclick = () => openGenerator(true);
    manual.parentElement?.insertBefore(b, manual);
  }

  f('crmGenClose').onclick = closeModal; f('crmGenCancel').onclick = closeModal; f('crmGenSubmit').onclick = submitContract;
  f('crmGenPayment').onchange = () => { f('crmGenSplit').style.display = f('crmGenPayment').value === 'split' ? 'grid' : 'none'; };
  modal.onclick = e => { if (e.target === modal) closeModal(); };
  addTopButton(); addDrawerButton();
  const drawer = $('#drawerBody'); if (drawer) new MutationObserver(addDrawerButton).observe(drawer, { childList: true, subtree: true });
})();
