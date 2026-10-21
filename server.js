const dotenv = require("dotenv");
dotenv.config();

const app = require("./app");
const connectDB = require("./src/config/db");
const { validateEnv } = require("./src/config/validateEnv");

const PORT = process.env.PORT || 5000;

try {
  validateEnv();
} catch (err) {
  console.error("Configuration error:", err.message);
  process.exit(1);
}

connectDB()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error("DB connection failed:", err.message);
    // a server that cannot reach its database must not look healthy to a
    // process manager or CI job
    process.exit(1);
  });
