
require("dotenv").config();

const app = require("./app");
const connectDB = require("./src/config/db");
const { validateEnv } = require("./src/config/validateEnv");

const PORT = process.env.PORT || 5000;

async function startServer() {
  try {
    // Validate required environment variables first.
    validateEnv();

    // Connect to MongoDB before accepting requests.
    await connectDB();

    // Start the server only after a successful database connection.
    const server = app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });

    // Handle unexpected server errors.
    server.on("error", (error) => {
      console.error("HTTP server error:", error.message);
      process.exit(1);
    });
  } catch (error) {
    console.error("Server startup failed:", error.message);
    process.exit(1);
  }
}

startServer();
