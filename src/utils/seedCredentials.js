// seed-only credential validation
//
// The seed script creates an administrator, so it must never fall back to a
// well-known password. Requiring explicit environment values keeps demo
// credentials out of the repository and out of deployment logs.

const MIN_ADMIN_PASSWORD_LENGTH = 12;

const WEAK_ADMIN_PASSWORDS = new Set([
  "admin",
  "admin123",
  "administrator",
  "changeme",
  "password",
  "password123",
  "qwerty123",
  "12345678",
  "123456789",
  "your-app-password",
]);

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const getSeedAdminCredentials = (env = process.env) => {
  const email = String(env.ADMIN_EMAIL || "").trim().toLowerCase();
  const password = String(env.ADMIN_PASSWORD || "");

  if (!email) {
    throw new Error("ADMIN_EMAIL is required to seed the admin account");
  }
  if (!EMAIL_PATTERN.test(email)) {
    throw new Error("ADMIN_EMAIL must be a valid email address");
  }
  if (!password) {
    throw new Error("ADMIN_PASSWORD is required to seed the admin account");
  }
  if (WEAK_ADMIN_PASSWORDS.has(password.toLowerCase())) {
    throw new Error("ADMIN_PASSWORD must not be a known default password");
  }
  if (password.length < MIN_ADMIN_PASSWORD_LENGTH) {
    throw new Error(
      `ADMIN_PASSWORD must be at least ${MIN_ADMIN_PASSWORD_LENGTH} characters`
    );
  }
  if (password.toLowerCase() === email) {
    throw new Error("ADMIN_PASSWORD must not equal ADMIN_EMAIL");
  }

  return { email, password };
};

module.exports = { getSeedAdminCredentials, MIN_ADMIN_PASSWORD_LENGTH };
