/* ZakonExpert Chat Widget — click tracking + lead collection */
(function () {
  'use strict';

  // ── Click tracking ───────────────────────────────────────────────────────
  // Только наши номера — нотариусы, ЧСИ и другие чужие номера не трекаем
  var OWN_NUMBERS = {
    '77058762795': 'main',
    '77777457577': 'advocate',
    '77479641306': 'mediator',
  };
  document.addEventListener('click', function (e) {
    const link = e.target.closest('a[href^="tel:"], a[href*="wa.me"]');
    if (!link) return;
    const href = link.href || '';
    // Только цифры из ссылки — игнорируем +, -, пробелы
    const digits = href.replace(/\D/g, '');
    // Определяем target только по нашим номерам
    let target = null;
    for (var num in OWN_NUMBERS) {
      if (digits.indexOf(num) !== -1) { target = OWN_NUMBERS[num]; break; }
    }
    // Чужой номер (нотариус, ЧСИ) — не трекаем
    if (!target) return;
    if (!window.ZEPrivacy || !window.ZEPrivacy.analyticsAllowed()) return;
    const type = href.startsWith('tel:') ? 'phone' : 'whatsapp';
    const payload = JSON.stringify({ type, target, page: location.pathname });
    if (navigator.sendBeacon) {
      navigator.sendBeacon('/api/track-click', new Blob([payload], { type: 'application/json' }));
    } else {
      fetch('/api/track-click', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload, keepalive: true }).catch(() => {});
    }
    if (window.ZE_sendYandexGoal) {
      window.ZE_sendYandexGoal('click_' + type, { page_path: location.pathname, source_entity_type: target });
    }
  }, true);

  // Lead capture is available as a compact rectangular button. The legacy
  // round WhatsApp bubble remains removed.
  const ENABLE_CHAT_WIDGET = true;
  if (!ENABLE_CHAT_WIDGET) return;

  // ── Chatbot widget ────────────────────────────────────────────────────────
  const CSS = `
  #zke-chat-btn{position:fixed;bottom:18px;right:18px;width:auto;min-width:178px;height:52px;padding:0 18px;border-radius:14px;background:linear-gradient(135deg,#0d1f3c,#1a3460);color:#fff;border:1px solid rgba(255,255,255,.2);cursor:pointer;box-shadow:0 8px 24px rgba(13,31,60,.28);z-index:9998;display:flex;gap:9px;align-items:center;justify-content:center;transition:transform .2s,box-shadow .2s;font-size:15px;font-weight:800;}
  #zke-chat-btn:hover{transform:translateY(-2px);box-shadow:0 12px 30px rgba(13,31,60,.35);}
  #zke-chat-btn .zke-label{white-space:nowrap;}
  #zke-chat-btn .zke-badge{position:absolute;top:-3px;right:-3px;width:18px;height:18px;background:#ef4444;border-radius:50%;font-size:10px;font-weight:700;display:flex;align-items:center;justify-content:center;color:#fff;border:2px solid #fff;animation:zke-pulse 2s infinite;}
  @keyframes zke-pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.2)}}
  #zke-chat-box{position:fixed;bottom:88px;right:20px;width:330px;max-width:calc(100vw - 40px);background:#fff;border-radius:18px;box-shadow:0 8px 40px rgba(0,0,0,.18);z-index:9999;overflow:hidden;display:none;flex-direction:column;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;}
  #zke-chat-box.open{display:flex;}
  .zke-header{background:linear-gradient(135deg,#0d1f3c,#1a3460);color:#fff;padding:14px 16px;display:flex;align-items:center;gap:10px;}
  .zke-avatar{width:40px;height:40px;border-radius:50%;background:rgba(255,255,255,.15);display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0;}
  .zke-header-text strong{display:block;font-size:15px;}
  .zke-header-text span{font-size:12px;color:rgba(255,255,255,.6);}
  .zke-close{margin-left:auto;background:none;border:none;color:#fff;opacity:.7;cursor:pointer;font-size:18px;line-height:1;padding:2px 4px;}
  .zke-close:hover{opacity:1;}
  .zke-messages{padding:14px 12px;display:flex;flex-direction:column;gap:10px;max-height:320px;overflow-y:auto;}
  .zke-msg{max-width:88%;padding:10px 13px;border-radius:14px;font-size:14px;line-height:1.5;}
  .zke-msg.bot{background:#f1f5f9;color:#1e293b;border-bottom-left-radius:4px;align-self:flex-start;}
  .zke-msg.user{background:#0d1f3c;color:#fff;border-bottom-right-radius:4px;align-self:flex-end;}
  .zke-btns{display:flex;flex-wrap:wrap;gap:7px;padding:0 12px 12px;}
  .zke-btn{background:#f1f5f9;border:1.5px solid #e2e8f0;border-radius:10px;padding:8px 13px;font-size:13px;font-weight:600;color:#0d1f3c;cursor:pointer;transition:background .15s,border-color .15s;text-align:left;}
  .zke-btn:hover{background:#e2e8f0;border-color:#cbd5e1;}
  .zke-btn.accent{background:#0d1f3c;color:#fff;border-color:#0d1f3c;}
  .zke-btn.accent:hover{background:#1a3460;}
  .zke-input-row{display:flex;gap:8px;padding:10px 12px 14px;border-top:1px solid #f1f5f9;}
  .zke-input{flex:1;border:1.5px solid #e2e8f0;border-radius:10px;padding:9px 12px;font-size:14px;outline:none;}
  .zke-input:focus{border-color:#0d1f3c;}
  .zke-send{background:#0d1f3c;color:#fff;border:none;border-radius:10px;padding:9px 16px;font-size:14px;font-weight:700;cursor:pointer;}
  .zke-send:hover{background:#1a3460;}
  .zke-success{padding:18px 16px;text-align:center;color:#0d1f3c;}
  @media(max-width:720px){#zke-chat-btn{right:10px;bottom:10px;left:10px;width:auto;min-width:0;height:50px;border-radius:12px}html.zke-has-page-cta #zke-chat-btn{display:none}#zke-chat-box{right:10px;bottom:70px;max-width:calc(100vw - 20px)}}
  .zke-success strong{display:block;font-size:16px;margin-bottom:6px;}
  .zke-success span{font-size:13px;color:#64748b;}
  .zke-consent{display:flex;align-items:flex-start;gap:7px;font-size:11px;line-height:1.35;color:#64748b;padding:0 2px;text-align:left;}.zke-consent input{margin-top:2px;flex:0 0 auto}.zke-consent a{color:#1a56db;}
  .zke-typing{display:flex;gap:4px;padding:10px 13px;background:#f1f5f9;border-radius:14px;align-self:flex-start;width:48px;}
  .zke-typing span{width:7px;height:7px;background:#94a3b8;border-radius:50%;animation:zke-dot .8s infinite;}
  .zke-typing span:nth-child(2){animation-delay:.15s;}
  .zke-typing span:nth-child(3){animation-delay:.3s;}
  @keyframes zke-dot{0%,80%,100%{transform:scale(1)}40%{transform:scale(1.4)}}
  `;

  const STEPS = {
    start: {
      msg: 'Здравствуйте! 👋 Чем могу помочь?',
      btns: [
        { label: '💳 Арест счёта / карты', next: 'collect', issue: 'arrest' },
        { label: '🚗 Запрет на авто',       next: 'collect', issue: 'auto'   },
        { label: '📄 Долг / ЧСИ / надпись', next: 'collect', issue: 'debt'   },
        { label: '⚖️ Нужен адвокат',         next: 'advocate'                 },
        { label: '🕊 Медиатор',              next: 'collect', issue: 'mediator'},
        { label: '📅 График платежей',       next: 'collect', issue: 'grafik' },
      ],
    },
    advocate: {
      msg: 'Адвокат Маулен Ержанов — по какому вопросу?',
      btns: [
        { label: '🔒 Уголовное дело',         next: 'collect', issue: 'advocate' },
        { label: '⚖️ Гражданский спор',        next: 'collect', issue: 'advocate' },
        { label: '👨‍👩‍👧 Развод / алименты',   next: 'collect', issue: 'advocate' },
        { label: '📋 Административное дело',   next: 'collect', issue: 'advocate' },
      ],
    },
    collect: {
      msg: 'Отлично! Оставьте номер телефона — перезвоним в течение 30 минут.',
    },
  };

  let state = { step: 'start', issue: null, name: null, phone: null };

  function buildWidget() {
    if (document.querySelector('.ze-mobile-cta, .zg-mobile-actions, [data-cta-position="mobile-sticky"], .company-mobile-cta')) {
      document.documentElement.classList.add('zke-has-page-cta');
    }
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    const btn = document.createElement('button');
    btn.id = 'zke-chat-btn';
    btn.title = 'Чат с консультантом';
    btn.innerHTML = `<svg width="21" height="21" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M20 2H4a2 2 0 0 0-2 2v18l4-4h14a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2zm-2 10H6V8h12v4z"/></svg><span class="zke-label">Оставить заявку</span><span class="zke-badge">!</span>`;
    document.body.appendChild(btn);

    const box = document.createElement('div');
    box.id = 'zke-chat-box';
    box.innerHTML = `
      <div class="zke-header">
        <div class="zke-avatar">⚖️</div>
        <div class="zke-header-text">
          <strong>ZakonExpert</strong>
          <span>Онлайн консультация</span>
        </div>
        <button class="zke-close" id="zke-close">✕</button>
      </div>
      <div class="zke-messages" id="zke-messages"></div>
      <div class="zke-btns" id="zke-btns"></div>
      <div class="zke-input-row" id="zke-live-row">
        <input class="zke-input" id="zke-live-input" type="text" placeholder="Напишите сообщение…" maxlength="1000" aria-label="Сообщение">
        <button class="zke-send" id="zke-live-send" aria-label="Отправить сообщение">→</button>
      </div>
      <label class="zke-consent" style="padding:0 14px 12px;"><input id="zke-live-consent" type="checkbox"><span>Согласен(на) на обработку сообщения согласно <a href="/privacy">политике</a>.</span></label>
    `;
    document.body.appendChild(box);

    btn.addEventListener('click', () => {
      const isOpen = box.classList.toggle('open');
      if (isOpen) {
        btn.querySelector('.zke-badge').style.display = 'none';
        if (!document.getElementById('zke-messages').children.length) showStep('start');
        startChatPolling();
      } else {
        stopChatPolling();
      }
    });
    document.getElementById('zke-close').addEventListener('click', () => {
      box.classList.remove('open');
      stopChatPolling();
    });

    const liveInput = document.getElementById('zke-live-input');
    document.getElementById('zke-live-send').addEventListener('click', sendLiveMessage);
    liveInput.addEventListener('keydown', e => { if (e.key === 'Enter') sendLiveMessage(); });
  }

  // ── Live chat (free text → Telegram → owner replies there) ─────────────────
  function getSessionId() {
    let id = localStorage.getItem('zke_chat_session');
    if (!id) {
      id = (window.crypto?.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(36).slice(2));
      localStorage.setItem('zke_chat_session', id);
    }
    return id;
  }

  let _pollTimer = null;
  let _lastMsgTs = Number(localStorage.getItem('zke_chat_last_ts') || 0);

  async function sendLiveMessage() {
    const input = document.getElementById('zke-live-input');
    const text = (input.value || '').trim();
    if (!text) return;
    const consent = document.getElementById('zke-live-consent');
    if (!consent?.checked) { consent?.focus(); return; }
    addMsg(text, 'user');
    input.value = '';
    try {
      const response = await fetch('/api/chat/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: getSessionId(), text, page: location.pathname, consent: true }),
      });
      if (!response.ok) throw new Error('chat rejected');
    } catch (_) {
      addMsg('Сообщение не доставлено. Оставьте телефон в форме ниже или напишите в WhatsApp: +7 705 876-27-95.', 'bot');
    }
  }

  function pollChat() {
    fetch(`/api/chat/poll?session=${encodeURIComponent(getSessionId())}&since=${_lastMsgTs}`)
      .then(r => r.json())
      .then(data => {
        (data.messages || []).forEach(m => {
          if (m.from === 'admin') addMsg(m.text, 'bot');
          if (m.ts > _lastMsgTs) _lastMsgTs = m.ts;
        });
        if (data.messages && data.messages.length) {
          localStorage.setItem('zke_chat_last_ts', String(_lastMsgTs));
        }
      })
      .catch(() => {});
  }

  function startChatPolling() {
    if (_pollTimer) return;
    pollChat();
    _pollTimer = setInterval(pollChat, 3500);
  }

  function stopChatPolling() {
    if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
  }

  function addMsg(text, who) {
    const msgs = document.getElementById('zke-messages');
    const m = document.createElement('div');
    m.className = `zke-msg ${who}`;
    m.textContent = text;
    msgs.appendChild(m);
    msgs.scrollTop = msgs.scrollHeight;
    return m;
  }

  function showTyping(cb) {
    const msgs = document.getElementById('zke-messages');
    const t = document.createElement('div');
    t.className = 'zke-typing';
    t.innerHTML = '<span></span><span></span><span></span>';
    msgs.appendChild(t);
    msgs.scrollTop = msgs.scrollHeight;
    setTimeout(() => { t.remove(); cb(); }, 700);
  }

  function clearBtns() {
    document.getElementById('zke-btns').innerHTML = '';
  }

  function showCollectForm() {
    const btns = document.getElementById('zke-btns');
    btns.innerHTML = `
      <div class="zke-input-row" style="width:100%;padding:0;">
        <input class="zke-input" id="zke-phone" type="tel" placeholder="+7 (___) ___-__-__" maxlength="18" aria-label="Номер телефона">
        <button class="zke-send" id="zke-send-btn" aria-label="Отправить номер телефона">→</button>
      </div>
      <label class="zke-consent"><input id="zke-phone-consent" type="checkbox"><span>Согласен(на) на обработку телефона согласно <a href="/privacy">политике</a>.</span></label>`;
    const inp = document.getElementById('zke-phone');
    inp.focus();
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') submitPhone(); });
    document.getElementById('zke-send-btn').addEventListener('click', submitPhone);
  }

  function showStep(stepName) {
    const step = STEPS[stepName];
    if (!step) return;
    showTyping(() => {
      addMsg(step.msg, 'bot');
      clearBtns();
      if (step.btns) {
        const btns = document.getElementById('zke-btns');
        step.btns.forEach(b => {
          const el = document.createElement('button');
          el.className = 'zke-btn';
          el.textContent = b.label;
          el.addEventListener('click', () => {
            addMsg(b.label, 'user');
            clearBtns();
            if (b.issue) state.issue = b.issue;
            showStep(b.next || 'collect');
          });
          btns.appendChild(el);
        });
      }
      if (stepName === 'collect') showCollectForm();
    });
  }

  async function submitPhone() {
    const phone = (document.getElementById('zke-phone')?.value || '').trim();
    if (phone.length < 6) {
      document.getElementById('zke-phone').style.borderColor = '#ef4444';
      return;
    }
    const consent = document.getElementById('zke-phone-consent');
    if (!consent?.checked) { consent?.focus(); return; }
    addMsg(phone, 'user');
    clearBtns();
    try {
      const attribution = window.ZE_getLeadAttribution ? window.ZE_getLeadAttribution() : {};
      const response = await fetch('/api/lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone,
          issue: state.issue || 'other',
          page: location.pathname,
          source: attribution.source || '',
          campaign: attribution.campaign || '',
          consent: true,
        }),
      });
      if (!response.ok) throw new Error('lead rejected');
      showTyping(() => {
        const msgs = document.getElementById('zke-messages');
        const s = document.createElement('div');
        s.className = 'zke-success';
        s.innerHTML = `<strong>✅ Заявка принята!</strong><span>Специалист свяжется с вами<br>в течение 30 минут.</span>`;
        msgs.appendChild(s);
        msgs.scrollTop = msgs.scrollHeight;
      });
    } catch (_) {
      const msgs = document.getElementById('zke-messages');
      const s = document.createElement('div');
      s.className = 'zke-success';
      s.innerHTML = `<strong>Не удалось сохранить заявку</strong><span><a href="https://wa.me/77058762795" target="_blank" rel="noopener">Напишите в WhatsApp</a> или позвоните: +7 705 876-27-95.</span>`;
      msgs.appendChild(s);
      msgs.scrollTop = msgs.scrollHeight;
    }
  }

  // Show badge after 8 seconds to attract attention
  setTimeout(() => {
    const btn = document.getElementById('zke-chat-btn');
    if (btn) {
      const badge = btn.querySelector('.zke-badge');
      if (badge) badge.style.display = 'flex';
    }
  }, 8000);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', buildWidget);
  } else {
    buildWidget();
  }
})();
