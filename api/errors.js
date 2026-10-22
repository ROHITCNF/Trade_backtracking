// Errors the API is willing to show the browser. Anything else becomes a bare
// "Internal error" (NFR-10): messages from pg, Fyers or the SDK can carry
// connection strings, tokens or raw responses.

class HttpError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
    this.expose = true;
  }
}

const httpError = (statusCode, message) => new HttpError(statusCode, message);

// Fastify's own 4xx errors (bad JSON, schema validation, body too large) are
// safe to echo; they describe the request, not the server.
const isClientError = (err) => err.statusCode >= 400 && err.statusCode < 500;

function errorHandler(err, request, reply) {
  const status = err.expose || isClientError(err) ? err.statusCode : 500;
  if (status >= 500) request.log.error({ err }, 'request failed');
  reply.code(status).send({ error: status >= 500 ? 'Internal error' : err.message });
}

function notFoundHandler(request, reply) {
  reply.code(404).send({ error: 'Not found' });
}

module.exports = { HttpError, httpError, errorHandler, notFoundHandler };
