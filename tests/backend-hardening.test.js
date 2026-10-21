/*
 * Regression tests for the remaining backend findings:
 * BUG-002.4 (duplicate enrollment race), BUG-002.5 (delete cascade),
 * BUG-005.2/5.3 (analytics window and UTC labels), BUG-006.5 (update validators),
 * BUG-007.3 (env validation), BUG-007.4 (seed guard), BUG-007.7 (email escaping),
 * BUG-001.6 (hash helper refuses published passwords).
 *
 * Only the Mongoose model boundary is stubbed; no database is required.
 */

const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { execFile } = require("child_process");

process.env.JWT_SECRET = "hardening-test-secret";
process.env.NODE_ENV = "test";

const root = path.join(__dirname, "..");

const Enrollment = require("../src/models/Enrollment");
const Course = require("../src/models/Course");
const AssignmentSubmission = require("../src/models/AssignmentSubmission");
const QuizSubmission = require("../src/models/QuizSubmission");
const User = require("../src/models/User");

const enrollmentService = require("../src/services/enrollment.service");
const adminService = require("../src/services/admin.service");
const userService = require("../src/services/user.service");
const { validateEnv } = require("../src/config/validateEnv");
const { escapeHtml } = require("../src/services/email.service");

const oid = (n) => String(n).repeat(24);
const courseId = oid(2);
const studentId = oid(3);

beforeEach(() => {
  Enrollment.findOne = async () => null;
  Enrollment.create = async (doc) => ({ _id: oid(6), ...doc });
  Enrollment.deleteMany = async () => ({ deletedCount: 0 });
  Enrollment.countDocuments = async () => 0;
  Enrollment.find = async () => [];
  Enrollment.aggregate = async () => [];

  Course.findById = async () => null;
  Course.findByIdAndUpdate = async () => null;
  Course.findByIdAndDelete = async () => null;
  Course.countDocuments = async () => 0;

  AssignmentSubmission.deleteMany = async () => ({ deletedCount: 0 });
  QuizSubmission.deleteMany = async () => ({ deletedCount: 0 });

  User.findById = async () => null;
  User.findByIdAndDelete = async () => null;
  User.countDocuments = async () => 0;
});

const run = (args, env) => new Promise((resolve) => {
  execFile(process.execPath, args, { cwd: root, env, timeout: 20000 }, (error, stdout, stderr) => {
    resolve({ code: error ? error.code : 0, stdout, stderr });
  });
});

/* ------------------------------ BUG-002.4 ------------------------------ */

test("BUG-002.4: a duplicate-key race is reported as 409, not a raw driver error", async () => {
  Course.findById = async () => ({ _id: courseId, batches: [] });
  Enrollment.create = async () => {
    const err = new Error("E11000 duplicate key error collection: enrollments");
    err.code = 11000;
    throw err;
  };

  await assert.rejects(
    enrollmentService.enrollCourse(studentId, courseId),
    (err) => {
      assert.equal(err.status, 409);
      assert.match(err.message, /Already enrolled in this course/);
      return true;
    }
  );
});

/* ------------------------------ BUG-002.5 ------------------------------ */

test("BUG-002.5: deleting a course cascades to its enrollments and submissions", async () => {
  const removed = [];
  Course.findByIdAndDelete = async () => ({ _id: courseId });
  Enrollment.deleteMany = async (filter) => { removed.push(["enrollment", filter]); return {}; };
  AssignmentSubmission.deleteMany = async (filter) => { removed.push(["assignment", filter]); return {}; };
  QuizSubmission.deleteMany = async (filter) => { removed.push(["quiz", filter]); return {}; };

  const result = await adminService.deleteCourse(courseId);

  assert.equal(result.message, "Course deleted");
  assert.deepEqual(
    removed.map(([name]) => name).sort(),
    ["assignment", "enrollment", "quiz"]
  );
  for (const [, filter] of removed) {
    assert.equal(String(filter.course), courseId);
  }
});

test("BUG-002.5: deleting a user cascades to that user's rows", async () => {
  const removed = [];
  User.findById = async () => ({ _id: studentId });
  User.findByIdAndDelete = async () => ({ _id: studentId });
  Enrollment.deleteMany = async (filter) => { removed.push(["enrollment", filter]); return {}; };
  AssignmentSubmission.deleteMany = async (filter) => { removed.push(["assignment", filter]); return {}; };
  QuizSubmission.deleteMany = async (filter) => { removed.push(["quiz", filter]); return {}; };

  await userService.deleteUser(studentId);

  assert.equal(removed.length, 3);
  for (const [, filter] of removed) {
    assert.equal(String(filter.student), studentId);
  }
});

/* ------------------------------ BUG-005.2 / 5.3 ------------------------------ */

test("BUG-005.2/5.3: analytics returns exactly 30 UTC days with matching labels", async () => {
  let capturedFilter = null;
  Enrollment.find = (filter) => {
    capturedFilter = filter;
    return { sort: async () => [] };
  };

  const analytics = await adminService.getAnalytics();

  assert.equal(analytics.chartData.length, 30);

  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const expectedLast = today.toISOString().slice(0, 10);
  const first = new Date(today);
  first.setUTCDate(first.getUTCDate() - 29);

  assert.equal(analytics.chartData[29].date, expectedLast);
  assert.equal(analytics.chartData[0].date, first.toISOString().slice(0, 10));

  // the query window must start on the same day as the first chart bucket
  assert.equal(capturedFilter.createdAt.$gte.toISOString(), first.toISOString());
  // 30 keys, all unique, no gap or duplicate caused by local/UTC mixing
  assert.equal(new Set(analytics.chartData.map((row) => row.date)).size, 30);
  // label is derived from the same UTC date
  const lastLabel = `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][today.getUTCMonth()]} ${today.getUTCDate()}`;
  assert.equal(analytics.chartData[29].displayDate, lastLabel);
});

/* ------------------------------ BUG-006.5 ------------------------------ */

test("BUG-006.5: course updates run schema validators", async () => {
  let options = null;
  Course.findByIdAndUpdate = async (id, payload, opts) => {
    options = opts;
    return { _id: id, ...payload };
  };

  await adminService.updateCourse(courseId, { title: "Updated" });

  assert.equal(options.runValidators, true);
  assert.equal(options.new, true);
});

/* ------------------------------ BUG-005.4 ------------------------------ */

test("BUG-005.4: admin lists clamp the requested page size", async () => {
  let limited = null;
  let skipped = null;
  const chain = {
    populate: () => chain,
    sort: () => chain,
    skip: (n) => { skipped = n; return chain; },
    limit: (n) => { limited = n; return Promise.resolve([]); },
  };
  Enrollment.find = () => chain;

  await adminService.getEnrollments({ limit: "100000", page: "2" });

  assert.equal(limited, 500);
  assert.equal(skipped, 500);
});

test("BUG-005.4: the user list clamps its page size", async () => {
  let limited = null;
  const chain = {
    select: () => chain,
    sort: () => chain,
    limit: (n) => { limited = n; return Promise.resolve([]); },
  };
  User.find = () => chain;

  await userService.getAllUsers({ limit: "99999" });

  assert.equal(limited, 500);
});

/* ------------------------------ BUG-005 (indexes) ------------------------------ */

test("BUG-005: indexes exist for the admin list queries", () => {
  const enrollmentIndexes = Enrollment.schema.indexes()
    .map(([fields]) => JSON.stringify(fields));
  assert.ok(
    enrollmentIndexes.some((index) => index.includes('"course":1') && index.includes('"createdAt":-1'))
  );

  const assignmentIndexes = AssignmentSubmission.schema.indexes()
    .map(([fields]) => JSON.stringify(fields));
  assert.ok(
    assignmentIndexes.some((index) => index.includes('"course":1') && index.includes('"createdAt":-1'))
  );
  assert.ok(
    assignmentIndexes.some((index) => index.includes('"student":1') && index.includes('"course":1'))
  );
});

/* ------------------------------ BUG-007.3 ------------------------------ */

test("BUG-007.3: startup validation rejects a missing environment variable", () => {
  assert.throws(
    () => validateEnv({ JWT_SECRET: "x".repeat(40) }),
    /Missing required environment variables: MONGODB_URI/
  );
  assert.throws(
    () => validateEnv({ MONGODB_URI: "mongodb://localhost/test" }),
    /JWT_SECRET/
  );
  assert.throws(
    () => validateEnv({
      NODE_ENV: "production",
      MONGODB_URI: "mongodb://localhost/test",
      JWT_SECRET: "short",
    }),
    /at least 32 characters/
  );
  assert.doesNotThrow(() => validateEnv({
    MONGODB_URI: "mongodb://localhost/test",
    JWT_SECRET: "x".repeat(40),
  }));
});

/* ------------------------------ BUG-007.4 ------------------------------ */

test("BUG-007.4: the seed script refuses to run in production before deleting data", async () => {
  const result = await run(["seed.js"], {
    ...process.env,
    NODE_ENV: "production",
    MONGODB_URI: "mongodb://127.0.0.1:1/never-connected",
  });

  assert.equal(result.code, 1);
  assert.match(result.stderr, /Refusing to run seed\.js with NODE_ENV=production/);
  assert.doesNotMatch(result.stdout, /Clearing existing data/);
});

/* ------------------------------ BUG-007.7 ------------------------------ */

test("BUG-007.7: welcome-email user data is HTML escaped", () => {
  assert.equal(
    escapeHtml('<img src=x onerror="alert(1)">'),
    "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;"
  );
  assert.equal(escapeHtml("O'Brien & Co"), "O&#39;Brien &amp; Co");
  assert.equal(escapeHtml(undefined), "undefined");
});

/* ------------------------------ BUG-001.6 ------------------------------ */

test("BUG-001.6: the hash helper refuses a published default password", async () => {
  const result = await run(["hash.js", "admin123"], { ...process.env });

  assert.equal(result.code, 1);
  assert.match(result.stderr, /Refusing to hash a published\/default password/);
  assert.doesNotMatch(result.stdout, /\$2[aby]\$/);
});
