'use strict';

(() => {
  if (location.pathname !== '/crm') return;
  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];
  const ACTIVE = ['new','contacted','agreed','contract','waiting_payment','paid','in_work','done'];
  const TERMINAL = ['declined','cancelled','lost'];
  let clients = [];
  let clientMap = new Map();
  let managerFilter = '';
  let serviceFilter = '';
  let periodFilter = 'all';
  let showArchive = false;
  let decorateTimer = 0;

  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const money = value => `${Number(value || 0).toLocaleString('ru-RU')} ₸`;
  const dateOnly = value => {
    if (!value) return '';
    const d = new Date(value.length === 10 ? `${value}T12:00:00` : value);
    return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleDateString('ru-RU');
  };
  const shortTime = value => {
    if (!value) return '';
    const d = new Date(Number(value) || value);
    if (Number.isNaN(d.getTime())) return '';
    const today = new Date();
    const same = d.toDateString() === today.toDateString();
    return `${same ? 'Сегодня' : d.toLocaleDateString('ru-RU')} ${d.toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})}`;
  };
  const initials = value => {
    const parts = String(value || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '—';
    return parts.slice(0,2).map(x => x[0]).join('').toUpperCase();
  };
  const latestContract = c => (c.contracts || []).filter(x => !x.deletedAt && x.status !== 'cancelled' && x.contractStatus !== 'cancelled').sort((a,b) => Number(b.updatedAt || b.createdAt || 0) - Number(a.updatedAt || a.createdAt || 0))[0] || null;
  const serviceOf = c => latestContract(c)?.serviceSubject || latestContract(c)?.service || c.work || c.issue || c.question || '';
  const isOverdue = c => Boolean(c.promiseDate && c.paymentStatus !== 'paid' && c.promiseDate < new Date().toISOString().slice(0,10));
  const dueSoon = c => {
    if (!c.promiseDate || c.paymentStatus === 'paid') return false;
    const due = new Date(`${c.promiseDate}T23:59:59`);
    const diff = due.getTime() - Date.now();
    return diff >= 0 && diff <= 2 * 86400000;
  };
  const priority = c => isOverdue(c) || dueSoon(c) ? 'Срочно' : 'Обычный';

  function toast(text) {
    const t = $('#toast');
    if (!t) return;
    t.textContent = text;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 2600);
  }

  function icon(name) {
    const paths = {
      calendar:'<path d="M7 3v3M17 3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v14H4V6a1 1 0 0 1 1-1Z"/>',
      wa:'<path d="M12 3a8 8 0 0 0-6.9 12l-1 4 4.1-1A8 8 0 1 0 12 3Zm4.4 11.2c-.2.6-1.2 1.1-1.8 1.2-.5.1-1.2.2-3.6-.8-3-1.2-4.9-4.3-5-4.5-.1-.2-1.2-1.6-1.2-3 0-1.5.8-2.2 1-2.5.3-.3.6-.3.8-.3h.6c.2 0 .5 0 .7.6.2.6.8 2 .9 2.1.1.2.1.4 0 .6-.1.2-.2.4-.4.6l-.6.7c-.2.2-.4.4-.2.8.2.4.8 1.3 1.8 2.1 1.2 1.1 2.2 1.4 2.6 1.6.4.2.6.2.8-.1l1.1-1.3c.2-.3.5-.3.8-.2.3.1 1.8.8 2.1 1 .3.2.5.2.6.4.1.1.1.7-.1 1.3Z"/>',
      bell:'<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/>'
    };
    return `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || ''}</svg>`;
  }

  function addHeaderControls() {
    const actions = $('.top-actions');
    if (!actions || $('#crmCalendarBtn')) return;
    const csv = actions.querySelector('a[href*="export.csv"]');
    if (csv) csv.innerHTML = 'CSV&nbsp; ↓';

    const calendar = document.createElement('button');
    calendar.type = 'button'; calendar.id = 'crmCalendarBtn'; calendar.className = 'crm-header-action';
    calendar.innerHTML = `${icon('calendar')}<span>Календарь</span>`;
    calendar.onclick = openCalendar;

    const waStatus = $$('.integration').find(x => x.textContent.includes('WhatsApp'));
    const whatsapp = document.createElement('button');
    whatsapp.type = 'button'; whatsapp.className = 'crm-header-action whatsapp';
    whatsapp.innerHTML = `${icon('wa')}<span>WhatsApp</span>`;
    whatsapp.title = waStatus?.querySelector('.dot.on') ? 'WhatsApp API подключён' : 'WhatsApp API ещё не подключён';
    whatsapp.onclick = () => toast(waStatus?.querySelector('.dot.on') ? 'WhatsApp подключён. Откройте карточку клиента для переписки.' : 'WhatsApp API ещё не подключён.');

    const bell = document.createElement('button');
    bell.type = 'button'; bell.className = 'crm-header-action icon-only'; bell.id = 'crmBell'; bell.innerHTML = icon('bell');
    bell.onclick = () => {
      const overdue = clients.filter(isOverdue);
      toast(overdue.length ? `Просроченных обещаний оплаты: ${overdue.length}` : 'Просроченных обещаний оплаты нет');
    };
    const avatar = document.createElement('span'); avatar.className = 'crm-avatar'; avatar.textContent = 'ZE'; avatar.title = 'ZakonExpert';

    actions.insertBefore(calendar, csv || actions.firstChild);
    actions.insertBefore(whatsapp, csv || actions.firstChild);
    const logout = actions.querySelector('form');
    actions.insertBefore(bell, logout || null); actions.insertBefore(avatar, logout || null);
  }

  function addToolbar() {
    const toolbar = $('.toolbar');
    if (!toolbar || $('#crmManagerFilter')) return;
    const refresh = $('#refresh');
    const divider = document.createElement('span'); divider.className = 'crm-divider';
    const manager = filterWrap('manager','crmManagerFilter','Ответственный: Все');
    const service = filterWrap('service','crmServiceFilter','Услуга: Все');
    const period = filterWrap('period','crmPeriodFilter','Период: Все время');
    period.querySelector('select').innerHTML = '<option value="all">Период: Все время</option><option value="today">Обновлено сегодня</option><option value="week">Последние 7 дней</option><option value="overdue">Есть просрочка</option>';
    const archive = document.createElement('button'); archive.type='button'; archive.className='btn crm-filter-btn'; archive.id='crmArchiveToggle'; archive.textContent='Фильтры'; archive.title='Показать отказанные / отменённые / потерянные сделки';
    archive.onclick=()=>{showArchive=!showArchive;document.body.classList.toggle('crm-show-archive',showArchive);archive.textContent=showArchive?'Скрыть архив':'Фильтры';decorateBoard();};
    toolbar.insertBefore(manager, refresh); toolbar.insertBefore(service, refresh); toolbar.insertBefore(period, refresh); toolbar.insertBefore(divider, refresh); toolbar.insertBefore(archive, refresh);
    $('#crmManagerFilter').onchange=e=>{managerFilter=e.target.value;applyFilters();};
    $('#crmServiceFilter').onchange=e=>{serviceFilter=e.target.value;applyFilters();};
    $('#crmPeriodFilter').onchange=e=>{periodFilter=e.target.value;applyFilters();};
  }

  function filterWrap(kind,id,label) {
    const wrap=document.createElement('label');wrap.className=`crm-filter-wrap ${kind}`;
    const select=document.createElement('select');select.id=id;select.className='crm-toolbar-filter';select.innerHTML=`<option value="">${esc(label)}</option>`;wrap.appendChild(select);return wrap;
  }

  function populateFilters() {
    const managers=[...new Set(clients.map(c=>String(c.manager||'').trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ru'));
    const services=[...new Set(clients.map(c=>serviceOf(c).trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ru')).slice(0,40);
    fillSelect($('#crmManagerFilter'),'Ответственный: Все',managers,managerFilter);
    fillSelect($('#crmServiceFilter'),'Услуга: Все',services,serviceFilter);
  }
  function fillSelect(select,label,items,current){if(!select)return;select.innerHTML=`<option value="">${esc(label)}</option>`+items.map(v=>`<option value="${esc(v)}" ${v===current?'selected':''}>${esc(v.length>30?v.slice(0,30)+'…':v)}</option>`).join('');}

  function passPeriod(c) {
    if (periodFilter==='all') return true;
    if (periodFilter==='overdue') return isOverdue(c);
    const ts=Number(c.updatedAt||0);if(!ts)return false;
    const age=Date.now()-ts;
    return periodFilter==='today'?age<=86400000:periodFilter==='week'?age<=7*86400000:true;
  }
  function applyFilters() {
    $$('.deal').forEach(card=>{
      const c=clientMap.get(card.dataset.id);if(!c)return;
      const okManager=!managerFilter||String(c.manager||'')===managerFilter;
      const okService=!serviceFilter||serviceOf(c)===serviceFilter;
      card.style.display=okManager&&okService&&passPeriod(c)?'':'none';
    });
    $$('.column').forEach(col=>{
      const visible=$$('.deal',col).filter(x=>x.style.display!=='none').length;
      const count=$('.column-count',col);if(count)count.textContent=visible;
    });
  }

  function stageSpecific(c,stage) {
    const contract=latestContract(c);
    if(stage==='contract'&&contract){return `<div class="crm-contract-line">№ ${esc(contract.number||'без номера')}${contract.date?` от ${esc(dateOnly(contract.date))}`:''}</div>`;}
    if(stage==='waiting_payment'){const amount=Number(c.promiseAmount||contract?.amount||0);return `<div class="crm-payment-line">${amount?`Сумма: <b>${esc(money(amount))}</b>`:''}${c.promiseDate?`<br>Срок: ${esc(dateOnly(c.promiseDate))}`:''}</div>`;}
    if(stage==='paid'){const amount=Number(c.paidAmount||contract?.amount||0);return `<div class="crm-payment-line">${amount?`Сумма: <b>${esc(money(amount))}</b>`:''}${c.paidAt?`<br>Оплачено: ${esc(dateOnly(c.paidAt))}`:''}</div>`;}
    if(stage==='in_work'){return `<div class="crm-case-line">${c.work?`Работа: ${esc(c.work.slice(0,55))}`:'Работа ведётся'}${c.nextAction?`<br>След. шаг: ${esc(c.nextAction.slice(0,50))}`:''}</div>`;}
    if(stage==='done'){return `<div class="crm-case-line">Завершено: ${esc(dateOnly(c.updatedAt))}</div>`;}
    return '';
  }

  function decorateCard(card,c) {
    card.querySelector('.crm-card-extra')?.remove();
    const stage=card.closest('.column')?.dataset.stage||c.status;
    const extra=document.createElement('div');extra.className='crm-card-extra';
    const next=c.nextAction||c.promiseNote||'';
    extra.innerHTML=`${stageSpecific(c,stage)}${next&&['new','contacted','agreed'].includes(stage)?`<div class="crm-next-label">Следующий шаг</div><div class="crm-next-value">${esc(next)}</div>`:''}<div class="crm-card-bottom"><div class="crm-manager"><span class="crm-manager-avatar">${esc(initials(c.manager||c.name))}</span><span>${esc(c.manager||'Не назначен')}</span></div><span class="crm-priority ${priority(c)==='Срочно'?'hot':''}">${priority(c)}</span></div>`;
    card.appendChild(extra);
    const oldTime=card.querySelector('.deal-foot .tiny');if(oldTime)oldTime.textContent=shortTime(c.updatedAt);
  }

  function decorateBoard() {
    const board=$('#board');if(!board)return;
    $$('.deal',board).forEach(card=>{const c=clientMap.get(card.dataset.id);if(c)decorateCard(card,c);});
    $$('.column',board).forEach(col=>{
      if(!col.querySelector('.crm-add-stage')){
        const btn=document.createElement('button');btn.type='button';btn.className='crm-add-stage';btn.innerHTML='+&nbsp; Добавить сделку';btn.onclick=()=>$('#addClient')?.click();col.appendChild(btn);
      }
    });
    let hint=$('.crm-drop-hint');if(!hint){hint=document.createElement('div');hint.className='crm-drop-hint';hint.textContent='Перетащите сделку между колонками';$('.board-wrap')?.after(hint);}
    document.body.classList.toggle('crm-show-archive',showArchive);
    applyFilters();
  }

  function updateStats() {
    const stats=$$('.stat');
    if(stats[0]) appendTrend(stats[0],'Активная база клиентов');
    if(stats[1]) appendTrend(stats[1],'Требуют первого контакта');
    if(stats[2]) appendTrend(stats[2],'Сформированные договоры');
    if(stats[3]) appendTrend(stats[3],'Активная работа');
    if(stats[4]) appendTrend(stats[4],'Фактически получено');
    if(stats[5]){
      const overdue=clients.filter(isOverdue);const total=overdue.reduce((s,c)=>s+Number(c.promiseAmount||0),0);
      const k=$('.k',stats[5]);if(k)k.textContent='Просрочено';const v=$('[data-k="promiseTotal"]',stats[5]);if(v)v.textContent=money(total);const s=$('[data-k="overdue"]',stats[5]);if(s)s.textContent=`${overdue.length} ${overdue.length===1?'сделка':'сделки'}`;appendTrend(stats[5],'Требуют внимания');
    }
  }
  function appendTrend(stat,text){let el=$('.crm-trend',stat);if(!el){el=document.createElement('div');el.className='crm-trend';stat.appendChild(el);}el.textContent=text;}

  async function fetchClients() {
    try{
      const r=await fetch('/api/crm/clients?limit=5000',{credentials:'same-origin',headers:{Accept:'application/json'}});if(!r.ok)return;
      const data=await r.json();clients=data.clients||[];clientMap=new Map(clients.map(c=>[c._id,c]));populateFilters();updateStats();decorateBoard();
    }catch(_){/* visual enhancement must never break CRM */}
  }

  function openCalendar() {
    let modal=$('#crmCalendarModal');
    if(!modal){modal=document.createElement('div');modal.id='crmCalendarModal';modal.className='modal';modal.innerHTML='<div class="modal-card"><h2>Календарь задач и оплат</h2><p>Ближайшие действия, обещания оплаты и просрочки из CRM.</p><div id="crmCalendarList"></div><div class="actions" style="margin-top:12px"><button class="btn" id="crmCalendarClose">Закрыть</button></div></div>';document.body.appendChild(modal);$('#crmCalendarClose').onclick=()=>modal.classList.remove('show');modal.onclick=e=>{if(e.target===modal)modal.classList.remove('show');};}
    const rows=clients.map(c=>{const date=c.nextActionDate||c.promiseDate||'';if(!date)return null;return{c,date,late:isOverdue(c)};}).filter(Boolean).sort((a,b)=>a.date.localeCompare(b.date)).slice(0,80);
    $('#crmCalendarList').innerHTML=rows.length?rows.map(x=>`<div class="event" style="margin-bottom:6px;border-left-color:${x.late?'#e65151':'#2962ff'}"><div class="date">${esc(dateOnly(x.date))}${x.late?' · ПРОСРОЧЕНО':''}</div><div class="text"><b>${esc(x.c.name||x.c.phone||'Клиент')}</b> — ${esc(x.c.nextAction||x.c.promiseNote||'Оплата / действие')}</div></div>`).join(''):'<div class="tiny">Запланированных действий пока нет</div>';
    modal.classList.add('show');
  }

  function boot() {
    addHeaderControls();addToolbar();fetchClients();
    const board=$('#board');if(board)new MutationObserver(()=>{clearTimeout(decorateTimer);decorateTimer=setTimeout(()=>{decorateBoard();fetchClients();},80);}).observe(board,{childList:true,subtree:true});
    $('#refresh')?.addEventListener('click',()=>setTimeout(fetchClients,250));
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();
