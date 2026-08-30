'use strict';

function generatorConnected() {
  return String(process.env.CRM_INTEGRATION_KEY || '').trim().length >= 24;
}

function installCrmUiPolish(app) {
  // crm-routes historically considered the generator connected only when a public
  // CRM_GENERATOR_API_URL existed. Pull mode deliberately has no public generator URL, so
  // correct the view model at render time without coupling the main CRM router to transport.
  app.use((req, res, next) => {
    if (req.path !== '/crm') return next();
    const originalRender = res.render.bind(res);
    res.render = function renderWithPullStatus(view, options, callback) {
      if (view === 'crm/dashboard' && options?.integrations) {
        options.integrations.generator = generatorConnected();
      }
      return originalRender(view, options, callback);
    };
    return next();
  });
}

module.exports = { installCrmUiPolish, generatorConnected };
