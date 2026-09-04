'use strict';



function registerAdminMethods(app, dependencies) {
  const { telegram } = dependencies;

  const ADMIN_MUTATION_PATHS = [
    '/api/notaries/import',
    '/api/notaries/refresh',
    '/api/bailiffs/import',
    '/api/news/import',
    '/api/news/clear',
    '/api/news/reset',
    '/api/news/fix-images',
    '/api/telegram/setup',
  ];
  app.get(ADMIN_MUTATION_PATHS, (req, res) => {
    res.set('Allow', 'POST');
    res.status(405).json({ error: 'Method Not Allowed — use POST with x-admin-key' });
  });

}

module.exports = { registerAdminMethods };
