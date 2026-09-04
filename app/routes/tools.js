'use strict';

const { TOOLS, findTool } = require('../../modules/tools-catalog');
const { validateBin } = require('../../modules/kgd-counterparty');

function registerToolRoutes(app, dependencies) {
  const { sendNotFound } = dependencies;

  // ===== КАЛЬКУЛЯТОР =====
  app.get('/calculator', (req, res) => res.render('calculator/index', {}));
  app.get('/marshrut-dolzhnika', (req, res) => res.render('debt-route'));
  app.get('/diagnostika-aresta', (req, res) => res.render('arrest-diagnostic'));
  app.get('/proverka-kompanii-po-bin', (req, res) => res.redirect(301, '/proverka-kontragenta'));
  app.get('/proverka-kontragenta', (req, res) => {
    if (Object.keys(req.query || {}).length) {
      const bin = validateBin(req.query.bin);
      return res.redirect(301, bin ? `/proverka-kontragenta#bin=${bin}` : '/proverka-kontragenta');
    }
    return res.render('company-check');
  });
  app.get('/proverka-bankrotstva', (req, res) => res.render('bankruptcy-check'));

  app.get('/tools', (req, res) => res.render('tools/index', { tools: TOOLS }));
  app.get('/tools/:slug', (req, res) => {
    const tool = findTool(req.params.slug);
    if (!tool) return sendNotFound(res);
    res.render('tools/tool', { tool, tools: TOOLS });
  });

}

module.exports = { registerToolRoutes };
