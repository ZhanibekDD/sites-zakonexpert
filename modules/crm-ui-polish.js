'use strict';

function generatorConnected() {
  return String(process.env.CRM_INTEGRATION_KEY || '').trim().length >= 24;
}

function injectReferenceAssets(html) {
  let out = String(html || '');
  if (!out.includes('/css/crm-reference.css')) {
    out = out.replace('</head>', '<link rel="stylesheet" href="/css/crm-reference.css?v=20260831b"></head>');
  }
  const scripts = [
    '<script src="/js/crm-reference-ui.js?v=20260831b"></script>',
    '<script src="/js/crm-reference-archive.js?v=20260831b"></script>',
  ];
  for (const script of scripts) {
    const src = script.match(/src="([^"]+)/)?.[1] || '';
    if (src && !out.includes(src)) out = out.replace('</body>', `${script}</body>`);
  }
  return out;
}

function installCrmUiPolish(app) {
  // Pull mode deliberately has no public generator URL. Correct that status and then apply
  // the approved reference UI at response time. This keeps the large dashboard template and
  // its working CRM logic untouched while allowing the presentation layer to evolve safely.
  app.use((req, res, next) => {
    if (req.path !== '/crm') return next();

    const originalRender = res.render.bind(res);
    res.render = function renderWithPullStatus(view, options, callback) {
      if (view === 'crm/dashboard' && options?.integrations) {
        options.integrations.generator = generatorConnected();
      }
      return originalRender(view, options, callback);
    };

    const originalSend = res.send.bind(res);
    res.send = function sendWithReferenceUi(body) {
      if (typeof body === 'string' && body.includes('<title>ZakonExpert CRM</title>')) {
        return originalSend(injectReferenceAssets(body));
      }
      return originalSend(body);
    };
    return next();
  });
}

module.exports = { installCrmUiPolish, generatorConnected, injectReferenceAssets };
