// Symbol search for the launcher and watchlists (FR-11).

const { httpError } = require('../errors');

async function symbolRoutes(app, { symbols }) {
  app.get(
    '/api/symbols',
    { schema: { querystring: { type: 'object', required: ['q'], properties: { q: { type: 'string', minLength: 1, maxLength: 50 } } } } },
    async (request) => {
      if (!symbols.ready()) throw httpError(503, 'Symbol list is still loading. Try again in a minute.');
      return { results: symbols.search(request.query.q) };
    }
  );
}

module.exports = { symbolRoutes };
