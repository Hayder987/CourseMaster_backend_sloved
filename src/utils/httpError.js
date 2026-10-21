// helpers for HTTP-aware errors
//
// Services still throw plain Error objects with a human readable message.
// These helpers only attach the HTTP status the controller wants to use, so the
// central error middleware can apply the correct status without losing the
// domain message.

const httpError = (status, message) => {
  const err = new Error(message);
  err.status = status;
  return err;
};

// Errors raised by the runtime/driver, not by our domain logic. A controller
// fallback status must never be attached to these: the error middleware
// classifies them itself so a database outage cannot become a 400.
const INFRASTRUCTURE_ERROR_NAMES = new Set([
  "CastError",
  "ValidationError",
  "ValidatorError",
  "MongoServerError",
  "MongoNetworkError",
  "MongoTimeoutError",
  "MongooseServerSelectionError",
  "MongooseError",
]);

const isInfrastructureError = (err) =>
  Boolean(err) &&
  typeof err === "object" &&
  (INFRASTRUCTURE_ERROR_NAMES.has(err.name) ||
    err.code === 11000 ||
    err.type === "entity.parse.failed" ||
    Array.isArray(err.issues));

// Only used for errors that do not already carry an HTTP status.
const attachStatus = (err, fallbackStatus) => {
  if (!err || typeof err !== "object") return err;
  if (err.status || err.statusCode) return err;
  if (isInfrastructureError(err)) return err;
  err.status = fallbackStatus;
  return err;
};

module.exports = { httpError, attachStatus, isInfrastructureError };
