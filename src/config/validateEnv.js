// Validates the environment configuration before the server starts.
// Throwing here turns a misconfigured deploy into a fast, obvious failure
// instead of a running process that answers every request with 401/500.

const REQUIRED_VARIABLES = ["MONGODB_URI", "JWT_SECRET"];

const validateEnv = (env = process.env) => {
  const missing = [];

  // src/config/db.js accepts either name
  const hasDatabaseUri = ["MONGODB_URI", "MONGO_URI"].some(
    (name) => env[name] && String(env[name]).trim()
  );
  if (!hasDatabaseUri) missing.push("MONGODB_URI (or MONGO_URI)");

  if (!env.JWT_SECRET || !String(env.JWT_SECRET).trim()) {
    missing.push("JWT_SECRET");
  }

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}`
    );
  }

  if (env.NODE_ENV === "production" && String(env.JWT_SECRET).length < 32) {
    throw new Error("JWT_SECRET must be at least 32 characters in production");
  }
};

module.exports = { validateEnv, REQUIRED_VARIABLES };
