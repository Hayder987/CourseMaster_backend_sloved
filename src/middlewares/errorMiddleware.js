const errorHandler = (err, req, res, next) => {
  const isProduction = process.env.NODE_ENV === "production";

  let status = 500;
  let message = "Internal server error";
  let details;

  if (!err) {
    res.status(status).json({ message });
    return;
  }

  // body-parser: the request body is not valid JSON
  if (err.type === "entity.parse.failed") {
    status = 400;
    message = "Malformed JSON in request body";
  } else if (err.name === "CastError") {
    // a malformed id / value must be a client error, never a 404 or 500
    status = 400;
    message = !err.path || err.path === "_id"
      ? "Invalid id"
      : `Invalid value for ${err.path}`;
  } else if (err.name === "ValidationError" && err.errors) {
    status = 400;
    message = "Validation error";
    details = Object.keys(err.errors).map((key) => ({
      field: err.errors[key].path || key,
      message: err.errors[key].message,
    }));
  } else if (err.code === 11000) {
    // unique index race; the affected service may translate this earlier
    status = 409;
    message = "Duplicate value";
  } else if (err.name === "ZodError" || Array.isArray(err.issues)) {
    status = 400;
    message = "Validation error";
    details = err.issues;
  } else if (
    err.name === "MongoServerError" ||
    err.name === "MongoNetworkError" ||
    err.name === "MongoTimeoutError" ||
    err.name === "MongoBulkWriteError" ||
    err.name === "MongooseError" ||
    err.name === "MongooseServerSelectionError"
  ) {
    // database/driver failures are never the client's fault and must not
    // expose host names, connection strings or driver internals
    status = 503;
    message = "Service temporarily unavailable";
  } else {
    const requestedStatus = Number(err.status || err.statusCode);
    status = Number.isInteger(requestedStatus) && requestedStatus >= 400 && requestedStatus <= 599
      ? requestedStatus
      : 500;

    if (status >= 500) {
      // keep the message only where it helps local debugging
      message = isProduction ? "Internal server error" : (err.message || message);
    } else {
      message = err.message || "Request failed";
    }
  }

  if (status >= 500) {
    console.error(err);
  }

  const response = { message };
  if (details) response.errors = details;
  if (process.env.NODE_ENV === "development" && err.stack) {
    response.stack = err.stack;
  }

  res.status(status).json(response);
};

module.exports = errorHandler;
