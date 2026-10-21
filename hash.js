const bcrypt = require("bcrypt");

// Small developer helper: prints a bcrypt hash for a password supplied on the
// command line. It must never contain a real password in source control.
//   node hash.js "<password>"

const KNOWN_PUBLISHED_PASSWORDS = [
  "admin123",
  "student123",
  "password",
  "12345678",
  "qwerty123",
];

(async () => {
  const password = process.argv[2];

  if (!password) {
    console.error('Usage: node hash.js "<password>"');
    process.exit(1);
  }

  if (KNOWN_PUBLISHED_PASSWORDS.includes(password)) {
    console.error(
      "Refusing to hash a published/default password. Choose a unique password."
    );
    process.exit(1);
  }

  const hash = await bcrypt.hash(password, 10);
  console.log(hash);
})();
