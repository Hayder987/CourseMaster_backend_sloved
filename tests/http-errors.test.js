/*
 * HTTP error-handling regression tests (BUG-006.2, BUG-006.3, BUG-006.4).
 *
 * The real Express app is booted; only the database module and the Mongoose
 * model boundary are stubbed, so status codes and response bodies are genuine.
 * Run with: npm test
 */

const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");
const bcrypt = require("bcrypt");

process.env.JWT_SECRET = "http-errors-test-secret";
process.env.NODE_ENV = "test";

let dbUp = true;

const dbPath = require.resolve("../src/config/db");
require.cache[dbPath] = {
  id: dbPath,
  filename: dbPath,
  loaded: true,
  exports: async () => {
    if (!dbUp) {
      const err = new Error(
        "connect ECONNREFUSED acme-shard-00-00.example.mongodb.net:27017"
      );
      err.name = "MongooseServerSelectionError";
      throw err;
    }
    return { connection: {} };
  },
};

const app = require("../app");
const User = require("../src/models/User");
const Course = require("../src/models/Course");

let server;
let port;

before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  port = server.address().port;
});

after(() => new Promise((resolve) => server.close(resolve)));

beforeEach(() => {
  dbUp = true;
  User.findOne = async () => null;
  Course.findById = async () => null;
  Course.find = () => ({
    sort: () => ({
      skip: () => ({
        limit: async () => [],
      }),
    }),
  });
  Course.countDocuments = async () => 0;
});

const request = (method, urlPath, body) => new Promise((resolve, reject) => {
  const payload = body === undefined
    ? null
    : (typeof body === "string" ? body : JSON.stringify(body));
  const headers = { "Content-Type": "application/json" };
  if (payload) headers["Content-Length"] = Buffer.byteLength(payload);

  const req = http.request(
    { host: "127.0.0.1", port, path: urlPath, method, headers },
    (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => resolve({ status: res.statusCode, body: data }));
    }
  );
  req.on("error", reject);
  if (payload) req.write(payload);
  req.end();
});

test("BUG-006.4: the health check does not depend on the database", async () => {
  dbUp = false;

  const res = await request("GET", "/");

  assert.equal(res.status, 200);
  assert.match(res.body, /Backend Running/);
});

test("BUG-006.4: a database outage returns 503 without host details", async () => {
  dbUp = false;

  const res = await request("GET", "/api/courses");
  const body = JSON.parse(res.body);

  assert.equal(res.status, 503);
  assert.equal(body.message, "Service temporarily unavailable");
  assert.equal(res.body.includes("mongodb.net"), false);
  assert.equal(res.body.includes("ECONNREFUSED"), false);
});

test("BUG-006.2: a malformed id is a 400 without Mongoose internals", async () => {
  Course.findById = async () => {
    const err = new Error(
      'Cast to ObjectId failed for value "not-an-id" (type string) at path "_id" for model "Course"'
    );
    err.name = "CastError";
    err.path = "_id";
    throw err;
  };

  const res = await request("GET", "/api/courses/not-an-id");
  const body = JSON.parse(res.body);

  assert.equal(res.status, 400);
  assert.equal(body.message, "Invalid id");
  assert.equal(res.body.includes("Cast to ObjectId"), false);
});

test("BUG-006.3: malformed JSON is rejected without the parser message", async () => {
  const res = await request("POST", "/api/auth/login", '{"email":');
  const body = JSON.parse(res.body);

  assert.equal(res.status, 400);
  assert.equal(body.message, "Malformed JSON in request body");
  assert.equal(res.body.includes("Unexpected end of JSON input"), false);
});

test("BUG-006.3: invalid credentials return 401, a banned account 403", async () => {
  const passwordHash = await bcrypt.hash("Correct#123", 4);
  User.findOne = async () => ({
    _id: "3".repeat(24),
    name: "S",
    email: "s@example.com",
    passwordHash,
    role: "student",
    isBanned: false,
  });

  const wrong = await request("POST", "/api/auth/login", {
    email: "s@example.com",
    password: "Wrong#123",
  });
  assert.equal(wrong.status, 401);
  assert.equal(JSON.parse(wrong.body).message, "Invalid email or password");

  User.findOne = async () => ({
    _id: "3".repeat(24),
    name: "S",
    email: "s@example.com",
    passwordHash,
    role: "student",
    isBanned: true,
  });

  const banned = await request("POST", "/api/auth/login", {
    email: "s@example.com",
    password: "Correct#123",
  });
  assert.equal(banned.status, 403);
  assert.equal(JSON.parse(banned.body).message, "Account is banned");
});

test("BUG-006.3: a driver failure is a 503, not a 400 with internals", async () => {
  Course.find = () => {
    const err = new Error(
      "connection to acme-shard-00-00.example.mongodb.net:27017 closed"
    );
    err.name = "MongoServerError";
    err.code = 91;
    throw err;
  };

  const res = await request("GET", "/api/courses");
  const body = JSON.parse(res.body);

  assert.equal(res.status, 503);
  assert.equal(body.message, "Service temporarily unavailable");
  assert.equal(res.body.includes("mongodb.net"), false);
});
