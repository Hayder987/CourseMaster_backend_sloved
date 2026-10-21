/*
 * Regression tests for BUG-001.6.
 *
 * The seed script creates an administrator. It must never fall back to a
 * published/default password, and the old demo credentials must not return to
 * the documentation.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const {
  getSeedAdminCredentials,
  MIN_ADMIN_PASSWORD_LENGTH,
} = require("../src/utils/seedCredentials");

test("BUG-001.6: seed refuses a missing admin email or password", () => {
  assert.throws(() => getSeedAdminCredentials({}), /ADMIN_EMAIL is required/);
  assert.throws(
    () => getSeedAdminCredentials({ ADMIN_EMAIL: "admin@example.com" }),
    /ADMIN_PASSWORD is required/
  );
});

test("BUG-001.6: seed refuses an invalid admin email", () => {
  assert.throws(
    () => getSeedAdminCredentials({ ADMIN_EMAIL: "not-an-email", ADMIN_PASSWORD: "Strong#Passw0rd!" }),
    /valid email address/
  );
});

test("BUG-001.6: seed refuses short and known default admin passwords", () => {
  const email = "admin@example.com";

  assert.throws(
    () => getSeedAdminCredentials({ ADMIN_EMAIL: email, ADMIN_PASSWORD: "short" }),
    new RegExp(`at least ${MIN_ADMIN_PASSWORD_LENGTH} characters`)
  );

  for (const password of ["admin123", "Admin123", "password", "changeme", "12345678"]) {
    assert.throws(
      () => getSeedAdminCredentials({ ADMIN_EMAIL: email, ADMIN_PASSWORD: password }),
      /known default password/,
      `password ${password} should be rejected`
    );
  }

  assert.throws(
    () => getSeedAdminCredentials({ ADMIN_EMAIL: email, ADMIN_PASSWORD: email }),
    /must not equal ADMIN_EMAIL/
  );
});

test("BUG-001.6: seed accepts and normalizes a strong env-supplied credential", () => {
  const credentials = getSeedAdminCredentials({
    ADMIN_EMAIL: "  Admin@Example.COM ",
    ADMIN_PASSWORD: "Strong#Passw0rd!2026",
  });

  assert.deepEqual(credentials, {
    email: "admin@example.com",
    password: "Strong#Passw0rd!2026",
  });
});

test("BUG-001.6: seed.js no longer hardcodes the published admin credentials", () => {
  const root = path.join(__dirname, "..");
  const seedSource = fs.readFileSync(path.join(root, "seed.js"), "utf8");
  const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
  const envExample = fs.readFileSync(path.join(root, ".env.example"), "utf8");

  assert.equal(seedSource.includes("admin123"), false, "seed.js must not contain the old password");
  assert.equal(
    seedSource.includes("process.env.ADMIN_EMAIL ||"),
    false,
    "seed.js must not fall back to a default admin email"
  );
  assert.match(seedSource, /getSeedAdminCredentials/);
  assert.equal(readme.includes("admin123"), false, "README must not publish the old password");
  assert.match(readme, /ADMIN_PASSWORD/);
  assert.match(envExample, /ADMIN_EMAIL/);
  assert.match(envExample, /ADMIN_PASSWORD/);
});

test("BUG-001.6: seed validates admin credentials before deleting data", () => {
  const seedSource = fs.readFileSync(path.join(__dirname, "..", "seed.js"), "utf8");
  const validationIndex = seedSource.indexOf("getSeedAdminCredentials()");
  const firstDeleteIndex = seedSource.indexOf("deleteMany(");

  assert.ok(validationIndex > -1, "seed must validate credentials");
  assert.ok(firstDeleteIndex > -1, "seed must contain the destructive deletes");
  assert.ok(
    validationIndex < firstDeleteIndex,
    "credential validation must run before any deleteMany call"
  );
});
