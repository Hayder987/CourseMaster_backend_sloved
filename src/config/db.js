// database connection configuration

const mongoose = require("mongoose");
const dns = require("dns");

// Ensure IPv4 first to resolve MongoDB Atlas SRV query issues on Windows
if (dns.setDefaultResultOrder) {
  dns.setDefaultResultOrder("ipv4first");
}

// Cache the connection to reuse in serverless environments
let cachedConnection = null;

// Returns true when the connection string names a database, e.g.
// mongodb+srv://host/coursemaster. Without it the driver uses "test".
const hasExplicitDatabaseName = (uri) => {
  try {
    return new URL(uri).pathname.replace(/\//g, "").length > 0;
  } catch {
    return true; // let the driver report malformed URIs
  }
};

const connectDB = async () => {
  // If already connected, return the cached connection
  if (cachedConnection && mongoose.connection.readyState === 1) {
    return cachedConnection;
  }

  const uri = process.env.MONGODB_URI || process.env.MONGO_URI; // Support both
  if (!uri) throw new Error("MONGODB_URI or MONGO_URI missing in .env");

  // If connection is in progress, wait for it
  if (mongoose.connection.readyState === 2) {
    await new Promise((resolve) => {
      mongoose.connection.once("connected", resolve);
      mongoose.connection.once("error", resolve);
    });
    if (mongoose.connection.readyState === 1) {
      cachedConnection = mongoose.connection;
      return cachedConnection;
    }
  }

  try {
    // Connect with options optimized for serverless
    const connection = await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 5000, // Timeout after 5s instead of 30s
      socketTimeoutMS: 45000, // Close sockets after 45s of inactivity
    });
    
    cachedConnection = connection;
    console.log(`MongoDB Connected ✅ (db: ${connection.connection.name})`);
    // a URI without a database path silently falls back to the "test" database
    if (!hasExplicitDatabaseName(uri)) {
      console.warn(
        'MongoDB URI has no database name; using the default "test" database. ' +
        "Add a database name (for example /coursemaster) to MONGODB_URI."
      );
    }
    return connection;
  } catch (error) {
    console.error("MongoDB connection error:", error.message);
    throw error;
  }
};

module.exports = connectDB;
