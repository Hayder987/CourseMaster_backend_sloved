/*
 * Regression tests for the CourseMaster backend.
 *
 * These tests boot the real Express app, routes, controllers and services and
 * replace only the Mongoose model boundary with in-memory stubs, so they can
 * run without a MongoDB instance. Run with: npm test
 */

const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const http = require("http");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

process.env.JWT_SECRET = "regression-test-secret";
process.env.NODE_ENV = "test";
process.env.ADMIN_REGISTRATION_KEY = "regression-admin-key";

// stub the database connection before the app is loaded
const dbPath = require.resolve("../src/config/db");
require.cache[dbPath] = {
  id: dbPath,
  filename: dbPath,
  loaded: true,
  exports: async () => ({ connection: {} }),
};

const app = require("../app");
const User = require("../src/models/User");
const Course = require("../src/models/Course");
const Enrollment = require("../src/models/Enrollment");
const AssignmentSubmission = require("../src/models/AssignmentSubmission");
const QuizSubmission = require("../src/models/QuizSubmission");

const authService = require("../src/services/auth.service");
const enrollmentService = require("../src/services/enrollment.service");
const quizService = require("../src/services/quiz.service");
const assignmentService = require("../src/services/assignment.service");
const adminService = require("../src/services/admin.service");
const courseService = require("../src/services/course.service");

const oid = (n) => String(n).repeat(24);
const studentId = oid(3);
const adminId = oid(7);
const courseId = oid(2);
const lessonId = oid(1);
const otherLessonId = oid(8);
const batchId = oid(9);

// minimal chainable query used to stub Mongoose reads
const query = (value) => {
  const q = {
    sort: () => q,
    skip: () => q,
    limit: () => q,
    populate: () => q,
    then: (resolve, reject) => Promise.resolve(value).then(resolve, reject),
  };
  return q;
};

let server;
let port;

before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  port = server.address().port;
});

after(() => new Promise((resolve) => server.close(resolve)));

beforeEach(() => {
  User.findById = () => ({ select: async () => null });
  User.findOne = async () => null;
  User.create = async () => { throw new Error("User.create was not stubbed"); };

  Course.findById = async () => null;
  Course.find = () => query([]);
  Course.countDocuments = async () => 0;

  Enrollment.findById = async () => null;
  Enrollment.findOne = async () => null;
  Enrollment.create = async () => { throw new Error("Enrollment.create was not stubbed"); };

  AssignmentSubmission.find = () => query([]);
  AssignmentSubmission.create = async () => { throw new Error("AssignmentSubmission.create was not stubbed"); };
  AssignmentSubmission.findByIdAndUpdate = () => query(null);

  QuizSubmission.create = async () => { throw new Error("QuizSubmission.create was not stubbed"); };
});

const request = (method, urlPath, token, body) => new Promise((resolve, reject) => {
  const payload = body ? JSON.stringify(body) : null;
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = "Bearer " + token;
  if (payload) headers["Content-Length"] = Buffer.byteLength(payload);

  const req = http.request({ host: "127.0.0.1", port, path: urlPath, method, headers }, (res) => {
    let data = "";
    res.on("data", (chunk) => (data += chunk));
    res.on("end", () => resolve({ status: res.statusCode, body: data }));
  });
  req.on("error", reject);
  if (payload) req.write(payload);
  req.end();
});

/* ------------------------------ BUG-001 ------------------------------ */

test("BUG-001: login normalizes the email and issues a token", async () => {
  const passwordHash = await bcrypt.hash("Correct#123", 4);
  let lookup = null;
  User.findOne = async (filter) => {
    lookup = filter;
    return {
      _id: studentId, name: "S", email: "s@example.com",
      passwordHash, role: "student", isBanned: false,
    };
  };

  const result = await authService.login({ email: "  S@Example.COM  ", password: "Correct#123" });

  assert.equal(lookup.email, "s@example.com");
  assert.ok(result.token);
  assert.equal(result.user.role, "student");
});

test("BUG-001: wrong password and banned accounts are rejected", async () => {
  const passwordHash = await bcrypt.hash("Correct#123", 4);
  User.findOne = async () => ({
    _id: studentId, name: "S", email: "s@example.com",
    passwordHash, role: "student", isBanned: false,
  });
  await assert.rejects(
    authService.login({ email: "s@example.com", password: "Wrong#123" }),
    /Invalid email or password/
  );

  User.findOne = async () => ({
    _id: studentId, name: "S", email: "s@example.com",
    passwordHash, role: "student", isBanned: true,
  });
  await assert.rejects(
    authService.login({ email: "s@example.com", password: "Correct#123" }),
    /Account is banned/
  );
});

/* ------------------------------ BUG-002 ------------------------------ */

test("BUG-002: an invalid token cannot reach protected routes", async () => {
  let serviceRan = false;
  Enrollment.findById = async () => { serviceRan = true; return null; };

  const res = await request("PATCH", `/api/enrollments/${oid(5)}/complete-lesson`,
    "not-a-valid-jwt", { lessonId });

  assert.equal(res.status, 401);
  assert.equal(serviceRan, false);
});

/* ------------------------------ BUG-003 ------------------------------ */

test("BUG-003: a second enrollment in the same course is rejected", async () => {
  let createCalls = 0;
  Course.findById = async () => ({ _id: courseId, batches: [] });
  Enrollment.findOne = async () => ({ _id: oid(5) });
  Enrollment.create = async () => { createCalls++; return {}; };

  await assert.rejects(
    enrollmentService.enrollCourse(studentId, courseId),
    /Already enrolled in this course/
  );
  assert.equal(createCalls, 0);
});

/* ------------------------------ BUG-004 ------------------------------ */

test("BUG-004: a student cannot update another student's progress", async () => {
  let saveCalls = 0;
  Enrollment.findById = async () => ({
    _id: oid(5), student: oid(4), course: courseId,
    progress: { completedLessons: [], percent: 0 },
    save: async () => { saveCalls++; },
  });
  Course.findById = async () => ({ _id: courseId, syllabus: [{ lessons: [{ _id: lessonId }] }] });

  await assert.rejects(
    enrollmentService.completeLesson(oid(5), lessonId, studentId),
    /Not authorized for this enrollment/
  );
  assert.equal(saveCalls, 0);
});

test("BUG-004: progress is based only on lessons that belong to the course", async () => {
  let saveCalls = 0;
  Enrollment.findById = async () => ({
    _id: oid(5), student: studentId, course: courseId,
    progress: { completedLessons: [], percent: 0 },
    save: async () => { saveCalls++; },
  });
  Course.findById = async () => ({
    _id: courseId,
    syllabus: [{ lessons: [{ _id: lessonId }, { _id: otherLessonId }] }],
  });

  const enrollment = await enrollmentService.completeLesson(oid(5), lessonId, studentId);

  assert.equal(enrollment.progress.percent, 50);
  assert.equal(saveCalls, 1);
});

/* ------------------------------ BUG-005 ------------------------------ */

const quizLessons = [
  {
    _id: lessonId,
    quiz: [
      { question: "Q1", options: ["a", "b"], correctIndex: 1 },
      { question: "Q2", options: ["a", "b"], correctIndex: 1 },
    ],
  },
];
quizLessons.id = (id) => quizLessons.find((lesson) => String(lesson._id) === String(id));

test("BUG-005: a perfect quiz scores 100 percent", async () => {
  Enrollment.findOne = async () => ({ _id: oid(5) });
  Course.findById = async () => ({ _id: courseId, syllabus: [{ lessons: quizLessons }] });
  QuizSubmission.create = async (doc) => ({ _id: oid(4), ...doc });

  const result = await quizService.submitQuiz(studentId, {
    courseId, lessonId, answers: [1, 1],
  });

  assert.equal(result.score, 2);
  assert.equal(result.total, 2);
  assert.equal(result.percent, 100);
});

/* ------------------------------ BUG-006 ------------------------------ */

test("BUG-006: only a valid admin key creates an admin", async () => {
  let createdRole = null;
  User.findOne = async () => null;
  User.create = async (doc) => {
    createdRole = doc.role;
    return { _id: adminId, ...doc };
  };

  const admin = await authService.register({
    name: "Admin", email: "admin@example.com", password: "Secret#123", adminKey: "regression-admin-key",
  });
  assert.equal(createdRole, "admin");
  assert.equal(admin.user.role, "admin");

  createdRole = null;
  await assert.rejects(
    authService.register({
      name: "Fake", email: "fake@example.com", password: "Secret#123", adminKey: "wrong-key",
    }),
    /Invalid admin key/
  );
  assert.equal(createdRole, null);
});

/* ------------------------------ BUG-007 ------------------------------ */

test("BUG-007: admin assignment list filters on the course field", async () => {
  let filter = null;
  AssignmentSubmission.find = (value) => { filter = value; return query([]); };

  await adminService.getAssignments({ courseId });

  assert.equal(String(filter.course), courseId);
  assert.equal("courseId" in filter, false);
});

/* ------------------------------ BUG-008 ------------------------------ */

test("BUG-008: an assignment must reference a lesson in the enrolled course", async () => {
  let createCalls = 0;
  Enrollment.findOne = async () => ({ _id: oid(5) });
  Course.findById = async () => ({
    _id: courseId,
    syllabus: [{ lessons: [{ _id: lessonId }] }],
  });
  AssignmentSubmission.create = async (doc) => { createCalls++; return { _id: oid(4), ...doc }; };

  await assert.rejects(
    assignmentService.submitAssignment(studentId, {
      courseId, lessonId: otherLessonId, answerType: "text", answer: "hello",
    }),
    /Lesson not found in this course/
  );
  assert.equal(createCalls, 0);

  const created = await assignmentService.submitAssignment(studentId, {
    courseId, lessonId, answerType: "text", answer: "hello",
  });
  assert.equal(created.lessonId, lessonId);
  assert.equal(createCalls, 1);
});

/* ------------------------------ BUG-009 ------------------------------ */

test("BUG-009: enrollment only accepts a batch that belongs to the course", async () => {
  let createCalls = 0;
  Course.findById = async () => ({
    _id: courseId,
    batches: [{ _id: batchId }],
    syllabus: [],
  });
  Enrollment.findOne = async () => null;
  Enrollment.create = async (doc) => { createCalls++; return { _id: oid(6), ...doc }; };

  await assert.rejects(
    enrollmentService.enrollCourse(studentId, courseId, otherLessonId),
    /Batch not found for this course/
  );
  assert.equal(createCalls, 0);

  await enrollmentService.enrollCourse(studentId, courseId, batchId);
  assert.equal(createCalls, 1);
});

/* ------------------------------ BUG-010 ------------------------------ */

test("BUG-010: malformed quiz answers are rejected before any lookup", async () => {
  let lookups = 0;
  Enrollment.findOne = async () => { lookups++; return { _id: oid(5) }; };
  Course.findById = async () => ({ _id: courseId, syllabus: [{ lessons: quizLessons }] });

  for (const answers of [undefined, "11", [1, "1"]]) {
    await assert.rejects(
      quizService.submitQuiz(studentId, { courseId, lessonId, answers }),
      /answers must be an array of option indices/
    );
  }
  assert.equal(lookups, 0);
});

/* ------------------------------ BUG-011 ------------------------------ */

test("BUG-011: assignment review validates status, grade and notes", async () => {
  let updateCalls = 0;
  AssignmentSubmission.findByIdAndUpdate = (id, update, options) => {
    updateCalls++;
    assert.equal(options.runValidators, true);
    return query({ _id: id, ...update });
  };

  for (const payload of [
    { status: "garbage" },
    { status: "reviewed", grade: 101 },
    { status: "reviewed", grade: -1 },
    { status: "reviewed", grade: "90" },
    { status: "reviewed", grade: 90, reviewNotes: 5 },
  ]) {
    await assert.rejects(adminService.reviewAssignment(oid(4), payload, adminId));
  }
  assert.equal(updateCalls, 0);

  const reviewed = await adminService.reviewAssignment(
    oid(4), { status: "reviewed", grade: 90, reviewNotes: "Good" }, adminId
  );
  assert.equal(reviewed.grade, 90);
  assert.equal(updateCalls, 1);
});

/* ------------------------------ BUG-012 ------------------------------ */

test("BUG-012: search input is treated as a literal string", async () => {
  let filter = null;
  Course.find = (value) => { filter = value; return query([]); };

  await courseService.getCourses({ search: ".*" });

  assert.equal(filter.$or[0].title.$regex, "\\.\\*");
  assert.equal(filter.$or[1].instructorName.$regex, "\\.\\*");
});

/* ------------------------------ BUG-013 ------------------------------ */

test("BUG-013: validation errors include the failing fields", async () => {
  const res = await request("POST", "/api/auth/register", null, {
    name: "x", email: "not-an-email", password: "1",
  });
  const body = JSON.parse(res.body);

  assert.equal(res.status, 400);
  assert.equal(body.message, "Validation error");
  assert.ok(Array.isArray(body.errors));
  assert.ok(body.errors.length > 0);
  assert.ok(Array.isArray(body.errors[0].path));
  assert.equal(typeof body.errors[0].message, "string");
});

/* ------------------------------ BUG-014 ------------------------------ */

test("BUG-014: bans, deletions and role changes apply to existing tokens", async () => {
  const token = jwt.sign({ id: studentId, role: "student" }, process.env.JWT_SECRET, { expiresIn: "1h" });

  User.findById = (id) => ({
    select: async () => ({ _id: id, role: "student", isBanned: true }),
  });
  let res = await request("GET", "/api/auth/me", token);
  assert.equal(res.status, 403);

  User.findById = () => ({ select: async () => null });
  res = await request("GET", "/api/auth/me", token);
  assert.equal(res.status, 401);

  User.findById = (id) => ({ select: async () => ({ _id: id, role: "student" }) });
  const forgedAdmin = jwt.sign({ id: studentId, role: "admin" }, process.env.JWT_SECRET, { expiresIn: "1h" });
  res = await request("GET", "/api/admin/assignments", forgedAdmin);
  assert.equal(res.status, 403);
});

/* ------------------------------ BUG-015 ------------------------------ */

test("BUG-015: a duplicate-key race returns a clean error", async () => {
  User.findOne = async () => null;
  User.create = async () => {
    const err = new Error("E11000 duplicate key error");
    err.code = 11000;
    throw err;
  };

  await assert.rejects(
    authService.register({ name: "Race", email: "race@example.com", password: "Secret#123" }),
    /Email already registered/
  );
});
