/*
 * BUG-007.2 — CORS must honour FRONTEND_URL instead of allowing every origin.
 * FRONTEND_URL is set before the app is loaded, exactly like a real deploy.
 */

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");

process.env.JWT_SECRET = "cors-test-secret";
process.env.NODE_ENV = "test";
process.env.FRONTEND_URL = "https://app.example.com,https://admin.example.com";

const dbPath = require.resolve("../src/config/db");
require.cache[dbPath] = {
  id: dbPath,
  filename: dbPath,
  loaded: true,
  exports: async () => ({ connection: {} }),
};

const app = require("../app");

let server;
let port;

before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  port = server.address().port;
});

after(() => new Promise((resolve) => server.close(resolve)));

const request = (method, origin) => new Promise((resolve, reject) => {
  const headers = {};
  if (origin) {
    headers.Origin = origin;
    headers["Access-Control-Request-Method"] = "PUT";
  }
  const req = http.request(
    { host: "127.0.0.1", port, path: "/api/auth/me", method, headers },
    (res) => {
      res.resume();
      res.on("end", () => resolve({
        status: res.statusCode,
        allowOrigin: res.headers["access-control-allow-origin"],
        allowMethods: res.headers["access-control-allow-methods"],
      }));
    }
  );
  req.on("error", reject);
  req.end();
});

test("BUG-007.2: a configured origin is allowed", async () => {
  const res = await request("GET", "https://app.example.com");
  assert.equal(res.allowOrigin, "https://app.example.com");
});

test("BUG-007.2: an unlisted origin receives no allow-origin header", async () => {
  const res = await request("GET", "https://evil.example");
  assert.equal(res.allowOrigin, undefined);
});

test("BUG-007.2: preflight advertises the real method list", async () => {
  const res = await request("OPTIONS", "https://app.example.com");
  assert.equal(res.status, 204);
  assert.equal(res.allowOrigin, "https://app.example.com");
  assert.match(res.allowMethods, /PUT/);
  assert.match(res.allowMethods, /DELETE/);
});
