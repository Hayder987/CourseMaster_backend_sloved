# CourseMaster Backend — Bug Bashing Report

This document is the authoritative backend bug report. It contains **seven parent reports** (`BUG-001` … `BUG-007`). Child identifiers (`BUG-00X.Y`) are intentionally **not** used as report IDs; the original audit numbering is preserved only as a historical index by title in Section 5.

---

## 1. Project information

| Item | Value |
|---|---|
| Project | CourseMaster Backend (Node.js + Express 5 + Mongoose 9) |
| Local workspace | `D:\27.05.2026 computer\B7-Practise\problem_solving\courseMaster_Backend` |
| Git remote (workspace) | `https://github.com/Hayder987/CourseMaster_backend_sloved.git` (branch `main`) |
| Original reference repo | `https://github.com/Pullock4981/courseMaster_Backend` (read-only, never modified) |
| Entry points | `server.js` (local), `api/index.js` (Vercel), `app.js` (Express app) |
| Database | MongoDB Atlas (URI only from `.env`; never printed) |
| Test runner | Node.js built-in (`node --test`) |
| Frontend | Inspected read-only for API contracts; **no frontend file was changed** |

### Scope

Backend source, tests, seed script, configuration and documentation. The frontend was used only to confirm request/response contracts (for example, the quiz review screen reads `question.correctIndex`).

---

## 2. Baseline, methodology and environment

### 2.1 What was executed

| Check | Command | Actual result |
|---|---|---|
| Automated tests | `npm test` | **45 tests, 45 pass, 0 fail** |
| Syntax | `node --check` on project JS files | **0 failures** |
| Dependency audit (before) | `npm audit --omit=dev` | **7 vulnerabilities** (1 low, 1 moderate, 4 high, 1 critical) |
| Dependency audit fix | `npm audit fix --omit=dev` | lockfile updated; **1 high remaining** (nodemailer, breaking major) |
| Dependency audit (after) | `npm audit --omit=dev` | **1 high** (nodemailer, fix requires `npm audit fix --force`) |
| Database integration | Atlas connection + ping | **PASS** — MongoDB 8.0.34, database `test`, 5 collections |
| Server startup | `node server.js` | **PASS** — `MongoDB Connected`, port 5000, `/` 200, `/api/courses` 200 |
| Real-database E2E | isolated prefixed records, 130 assertions | **130 pass, 0 fail**, 0 leftover records |
| Frontend build/lint | out of scope | **NOT RUN** for this report |

### 2.2 Evidence levels used in this report

- **Test-based** — an executed `node --test` case proves the behaviour over the real Express app or service.
- **Runtime-based** — an HTTP probe against a running instance.
- **Database-based** — an executed request/query against the real MongoDB Atlas database using isolated, prefixed records that were deleted afterwards.
- **Source-only** — verified by reading the implementation; no executable proof.
- **Live probe** — HTTP request to the deployed backend `https://course-master-backend-ochre.vercel.app`. The deployment is **older than this working tree**, so a live probe proves the deployed build, not the current source. Every use is labelled.

### 2.3 Database verification (final pass, 2026-10-22)

The Atlas cluster is now reachable from this machine. Verified with a direct driver connection and with the running API:

- `mongoose.connect` succeeded in ~1 s; `admin.ping()` returned `ok`; server version **8.0.34**.
- Database in use: **`test`** (the URI has no database path, so the driver uses its default). A startup warning now reports this; see Remaining Issues.
- Collections present: `users`, `courses`, `enrollments`, `assignmentsubmissions`, `quizsubmissions`.
- Indexes created and verified: `users.email` (unique), `enrollments{student,course}` (unique), `enrollments{course,batchId,createdAt}`, `assignmentsubmissions{course,createdAt}`, `assignmentsubmissions{student,course,createdAt}`.
- **130/130** end-to-end HTTP assertions passed against the real database: registration, login (including expired/wrong-secret/unknown-user tokens), course CRUD, search/sort/filter/pagination, answer-key scoping (anonymous/list vs enrolled/admin, including expired/invalid tokens on the public route), enrollment (including a database-level duplicate-key test), progress, quiz, assignment, admin review, analytics, role/ban enforcement, both delete cascades.
- Every test document carried an `e2e.<timestamp>` prefix and was removed afterwards; the cleanup check reported **0** leftover users, courses, enrollments, assignments and quizzes.
- No production or pre-existing data was modified. The collections were empty at the start of the run.
- `explain()` was not executed, so index *performance* remains unmeasured.

---

## 3. Parent bug reports

---

## BUG-001 — Authentication and account security could not be relied on, and default credentials were published

### 1. Location & Steps

**API:** `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me`, every authenticated route; `npm run seed`; `node hash.js`.

**Files:** `src/services/auth.service.js`, `src/middlewares/authMiddleware.js`, `src/middlewares/adminMiddleware.js`, `seed.js`, `src/utils/seedCredentials.js`, `hash.js`, `README.md`, `.env.example`.

**Code Location (before fix):**
- `auth.service.login` — plain `throw new Error(...)` for every failure; no HTTP status; the controller converted everything to `400`.
- `authMiddleware` — accepted a token without stopping the request when verification failed.
- `auth.service.register` — `User.create` not guarded against `E11000`; the admin-registration key was documented but ignored.
- `seed.js` — hardcoded the published admin password; `hash.js` hardcoded `bcrypt.hash("admin123", 10)`.
- `README.md` / `.env.example` — published the demo admin credential.

**Steps:**
1. `POST /api/auth/login` with a valid seeded account and correct password.
2. Call any protected route with an invalid/expired token.
3. Ban a user, delete a user, or change a role, then reuse the token issued before the change.
4. Send two simultaneous registrations for the same email.
5. Register with `adminKey` (documented) and inspect the resulting role.
6. Search the repository for `admin123`.
7. Run `node hash.js`.

### 2. Expected vs. Actual

**Expected:** valid credentials log in; invalid tokens stop at the middleware with `401`; bans/deletions/role changes take effect immediately; duplicate registration returns a clean `409`; admin creation requires the configured key; no credential is published or hardcoded.

**Actual (before fix):**
- Login rejected every valid credential (case-sensitive/unnormalised email lookup and a broken password comparison path), so no account could authenticate.
- An invalid or expired JWT did not stop the request; the handler continued with an undefined user.
- Roles and bans were read only from the token, so a banned or deleted account kept access for the token lifetime (30 days).
- Concurrent registration surfaced a raw `E11000 duplicate key error`; the documented `adminKey` was ignored, so the role was always `student`.
- `seed.js` and `README.md` published `admin@coursemaster.com / admin123`; `hash.js` reproduced the same password hash.

**Actual (after fix):**
- Email is normalised (`trim().toLowerCase()`) before lookup; valid credentials return a token.
- Invalid/expired tokens return `401 {"message":"Not authorized"}` before any service runs.
- The middleware re-reads the user on every request: banned → `403`, deleted → `401`, role changes apply immediately (a forged admin token is rejected with `403`).
- Duplicate email → `409 {"message":"Email already registered"}`.
- `adminKey` is compared in constant time against `ADMIN_REGISTRATION_KEY`; a wrong key → `400`, an unconfigured key → `403`.
- Seed reads `ADMIN_EMAIL`/`ADMIN_PASSWORD`, refuses missing/invalid/short/known-default values **before** deleting anything, and never prints the password. `hash.js` now takes the password from `argv` and refuses published defaults.

**Root Cause:** the authentication path had both logic defects (normalisation/comparison, missing middleware rejection) and a design defect (trusting stale claims in a long-lived token). Credentials were additionally treated as documentation rather than secrets.

### 3. Severity & Evidence

**Severity:** Critical.

**Priority:** P0.

**Screenshot / Error:** No screenshot is available. Raw behaviour observed: `400 {"message":"Invalid email or password"}` for a correct password before the fix, and protected routes executing with an invalid token.

**Evidence:** combination of **test-based** and **source-only**.
- Tests: `BUG-001: login normalizes the email and issues a token`, `BUG-001: wrong password and banned accounts are rejected`, `BUG-002: an invalid token cannot reach protected routes`, `BUG-006: only a valid admin key creates an admin`, `BUG-014: bans, deletions and role changes apply to existing tokens`, `BUG-015: a duplicate-key race returns a clean error`, plus six `BUG-001.6` seed tests.
- Source: `authMiddleware`, `auth.service`, `seed.js`, `hash.js`.

### 4. Fix & Verification

**Fix:** normalise the email before lookup; reject invalid tokens in the middleware; revalidate the account against the database on every request; translate duplicate-key errors; enforce the admin key with `crypto.timingSafeEqual`; move seed credentials to validated environment variables; replace the hardcoded hash helper with an `argv`-driven helper that refuses published passwords.

**Status:** `Fixed & Verified`

**Changed Files:**
- `src/services/auth.service.js` — email normalisation, `httpError` statuses (`401`/`403`/`409`), duplicate-key translation.
- `src/middlewares/authMiddleware.js` — hard rejection of invalid tokens, DB revalidation, ban check.
- `src/middlewares/adminMiddleware.js` — role check returns `403`.
- `seed.js` — validates credentials before deletion, no hardcoded admin password.
- `src/utils/seedCredentials.js` (new) — allowed values, minimum length, known-default rejection.
- `hash.js` — password supplied on the command line, refuses `admin123`/`student123`/other defaults.
- `README.md`, `.env.example` — credential documentation removed/neutralised.

**Verification:**
- **Command:** `npm test` — **Result:** 46/46 pass.
- **Test:** the eight auth/seed tests listed above — **Result:** all pass.
- **Regression:** `BUG-014`, `BUG-015` — **Result:** pass.
- **Build:** not applicable (no build step).
- **Lint:** `NOT RUN` (no lint script in this project).
- **API Verification:** `POST /api/auth/login` returns `401` for a wrong password and `403` for a banned account (`tests/http-errors.test.js`).
- **Database Verification:** **PASS** — real Atlas run: registration (student/admin), login with normalised email, wrong password `401`, missing/invalid/expired/wrong-secret/unknown-user token `401`, ban applies to an existing token (`403`), unban restores access, role change applies to an existing token, deleted user token `401`.

**Known Limitations:** the connected database is currently empty (no users, courses or enrollments), so no seeded admin exists yet. Create the first admin through `POST /api/auth/register` with `ADMIN_REGISTRATION_KEY`, or run `npm run seed` only against a disposable database. The frontend repository still publishes the demo credentials; it is outside this backend-only scope and is reported separately.

**Code Location Details:**
- **File:** `src/services/auth.service.js` — `normalizeEmail`, `matchesAdminKey`, `resolveRegistrationRole`, `register`, `login`, `getMe`.
- **File:** `src/middlewares/authMiddleware.js` — token parse, `jwt.verify`, `User.findById(...).select("role isBanned")`.
- **File:** `seed.js` — `seedDatabase` guard and credential load.
- **File:** `src/utils/seedCredentials.js` — `getSeedAdminCredentials`.
- **File:** `hash.js` — `KNOWN_PUBLISHED_PASSWORDS` refusal.

---

## BUG-002 — Enrollment creation, progress updates and deletion could corrupt or orphan data

### 1. Location & Steps

**API:** `POST /api/enrollments/:courseId`, `PATCH /api/enrollments/:enrollId/complete-lesson`, `DELETE /api/admin/courses/:id`, `DELETE /api/users/:id`, `GET /api/admin/enrollments`.

**Files:** `src/services/enrollment.service.js`, `src/services/admin.service.js`, `src/services/user.service.js`, `src/controllers/enrollment.controller.js`, `src/models/Enrollment.js`.

**Code Location (before fix):**
- `enrollment.service.enrollCourse` — existence check inverted; no uniqueness guard around `create`.
- `enrollment.service.completeLesson` — no ownership check, lesson id not validated against the course, `save()` not awaited.
- `admin.service.deleteCourse` / `user.service.deleteUser` — document deleted without touching dependent rows.

**Steps:**
1. Enroll as a student whose enrollment does not exist.
2. Send two identical enrollment requests in parallel.
3. `PATCH` another student's `enrollId` with any `lessonId`.
4. Call `complete-lesson` with a lesson id from a different course.
5. Delete a course that has enrollments and submissions; list enrollments and analytics.

### 2. Expected vs. Actual

**Expected:** a first-time student can enroll; duplicate requests yield one enrollment and a clean `409`; only the owner can update progress; only lessons of the enrolled course count; deleting a course/user removes or intentionally retains dependants, never silently orphaning them.

**Actual (before fix):**
- The existence check was inverted, so students could never enroll (or were blocked after the first attempt).
- A second parallel request produced a raw `E11000 duplicate key error` because the unique index was not translated.
- Any authenticated student could rewrite any enrollment's progress; a lesson from another course could be counted; the `save()` promise was not awaited, so failures were silent.
- Deleting a course left enrollments, assignments and quiz submissions pointing at a missing document; analytics and lists then referenced deleted content.
- Deleting a user left the same orphans.

**Actual (after fix):**
- Enrollment works for a first-time student; a foreign batch is rejected; a duplicate enrollment returns `409` on both the pre-check and the concurrent-request path.
- Progress updates require ownership (a foreign enrollment → `403`), a missing enrollment → `404`, only lessons in the enrolled course are accepted (`400` otherwise), and `save()` is awaited.
- Course deletion cascades to `Enrollment`, `AssignmentSubmission` and `QuizSubmission`; user deletion cascades to that user's rows.

**Root Cause:** the enrollment guard was written with the wrong boolean polarity, ownership was never checked, an async write was not awaited, and deletion had no referential-integrity strategy.

### 3. Severity & Evidence

**Severity:** Critical (students could not enroll; cross-account progress write).

**Priority:** P0.

**Screenshot / Error:** No screenshot. Observed errors: `"Already enrolled in this course"` on a first enrollment; raw `E11000 duplicate key error collection: enrollments`.

**Evidence:** **test-based**.
- `BUG-003: a second enrollment in the same course is rejected`
- `BUG-004: a student cannot update another student's progress`
- `BUG-004: progress is based only on lessons that belong to the course`
- `BUG-009: enrollment only accepts a batch that belongs to the course`
- `BUG-002.4: a duplicate-key race is reported as 409`
- `BUG-002.5: deleting a course cascades …`, `BUG-002.5: deleting a user cascades …`

### 4. Fix & Verification

**Fix:** correct the existence check; validate the batch against the course; enforce `enrollment.student === req.user.id`; validate the lesson id against the course syllabus; `await` the save; translate `E11000` to `409`; cascade deletes for course and user.

**Status:** `Fixed & Verified`

**Changed Files:**
- `src/services/enrollment.service.js` — ownership, lesson validation, `await`, duplicate-key translation, precise `403`/`404`/`409` statuses.
- `src/services/admin.service.js` — `deleteCourse` cascade.
- `src/services/user.service.js` — `deleteUser` cascade.
- `src/models/Enrollment.js` — compound index supporting the list query.

**Verification:**
- **Command:** `npm test` — **Result:** 46/46 pass.
- **Test:** the six tests listed above — **Result:** all pass.
- **Regression:** the full pre-existing suite — **Result:** pass.
- **API Verification:** enrollment/progress paths exercised through the real Express app where the test harness uses HTTP (auth/error cases); service-level probes for progress and cascade.
- **Database Verification:** **PASS** — real Atlas run: first enrollment `201`; duplicate enrollment `409`; database unique index independently rejected a direct duplicate with `E11000`; invalid/foreign batch `400`; progress 1/2 lessons = `50%`, double completion stays `50%`; foreign enrollment `403`; missing enrollment `404`; course delete removed 2 enrollments, 1 assignment and 1 quiz; user delete removed the student's rows and rejected their token with `401`.

**Known Limitations:** the chosen policy is a **hard cascade**. If the product later needs soft deletion or retention, this decision must be revisited. The concurrent-race path is covered by a simulated `E11000` in the unit suite and by a real database-level duplicate-key attempt in the E2E run.

**Code Location Details:**
- **File:** `src/services/enrollment.service.js` — `enrollCourse` (guard + create), `completeLesson` (ownership, lesson set, `await`).
- **File:** `src/services/admin.service.js` — `deleteCourse`.
- **File:** `src/services/user.service.js` — `deleteUser`.

---

## BUG-003 — Quiz scoring was wrong and the answer key was publicly readable

### 1. Location & Steps

**API:** `POST /api/quizzes/submit`, `GET /api/courses`, `GET /api/courses/:id`.

**Files:** `src/services/quiz.service.js`, `src/services/course.service.js`, `src/middlewares/optionalAuth.js` (new), `src/routes/course.routes.js`, `src/controllers/course.controller.js`, `src/models/Course.js`.

**Code Location (before fix):**
- `quiz.service.submitQuiz` — percentage calculation divided by the wrong factor; answers were not validated as integers.
- `course.service.getCourses` / `getCourseById` — returned the raw course document, including `syllabus[].lessons[].quiz[].correctIndex`.

**Steps:**
1. Submit a perfect quiz (two correct answers) and read `percent`.
2. Submit `answers: "11"` or `[1, "1"]`.
3. `GET /api/courses` and search the JSON for `correctIndex`.
4. Repeat step 3 with no token, with a student token and with an admin token.

### 2. Expected vs. Actual

**Expected:** a perfect quiz scores `100`; malformed answers are rejected before any lookup; anonymous callers never receive the answer key; the enrolled student's review screen still works.

**Actual (before fix):**
- A perfect two-question quiz returned `10` instead of `100` (percentage was computed against a 10x denominator).
- Non-integer/malformed answers reached the scoring loop.
- `correctIndex` was present in **every** course response, anonymous included. **Runtime-based confirmation:** live probe `GET https://course-master-backend-ochre.vercel.app/api/courses?limit=50` returned a body containing `"correctIndex"`. This proves the deployed build; the same code path exists in the source.

**Actual (after fix):**
- `percent` is `Math.round((score / total) * 100)` → `100` for a perfect quiz.
- `answers` must be an array of integers; otherwise `400` before any enrollment/course lookup.
- Course **list** responses are always stripped of `correctIndex`.
- Course **detail** responses are stripped for anonymous callers. Enrolled students and admins still receive the key, because the existing player renders its review screen from `question.correctIndex`. Verified against the real database: anonymous `absent`, enrolled student `1`, admin `1`, list `absent`.
- A new optional-auth middleware identifies the caller on the public detail route without ever rejecting an anonymous request.

**Root Cause:** an incorrect denominator in the score formula, no input validation, and no response projection separating authoring data from public data.

### 3. Severity & Evidence

**Severity:** High (score correctness) / High (answer-key disclosure).

**Priority:** P1.

**Screenshot / Error:** No screenshot. Live response excerpt contained `"correctIndex"`.

**Evidence:** combination of **test-based**, **runtime-based** and **database-based**.
- Tests: `BUG-005: a perfect quiz scores 100 percent`, `BUG-010: malformed quiz answers are rejected before any lookup`, `BUG-003: the answer key is hidden from anonymous callers but kept for enrolled students and admins`.
- Runtime: live `GET /api/courses` probe (deployed build); real-database HTTP checks for anonymous/enrolled/admin/list.
- Source: `CoursePlayer.jsx:717,757,773` consumes `correctIndex`.

### 4. Fix & Verification

**Fix:** corrected the percentage formula; validate `answers`; add optional authentication to the public detail route; strip `correctIndex` from every list response and from detail responses unless the caller is an enrolled student or an admin.

**Status:** `Fix Applied — Verification Incomplete`

**Changed Files:**
- `src/services/quiz.service.js` — validation, percentage, precise statuses.
- `src/services/course.service.js` — `hideAnswerKey`, `canSeeAnswerKey`, scoped `getCourseById`, stripped list.
- `src/middlewares/optionalAuth.js` (new) — identifies the caller without rejecting anonymous requests.
- `src/routes/course.routes.js` — `optionalAuth` on `GET /:id`.
- `src/controllers/course.controller.js` — passes `req.user`.

**Verification:**
- **Command:** `npm test` — **Result:** 46/46 pass.
- **Test:** the three quiz tests above — **Result:** pass.
- **Regression:** enrollment/admin tests that read course details — **Result:** pass.
- **API Verification:** real-database HTTP checks — anonymous detail hides the key, enrolled/admin detail keeps it, list always hides it.
- **Database Verification:** **PASS** — perfect submission persisted with `score=2`, `total=2`, `percent=100`.

**Known Limitations:** the key is still delivered to **enrolled students** before they submit, because the current player needs it for the review screen. Removing that last exposure requires a frontend change (a submission-scoped review endpoint). Anonymous and list exposure — the original public leak — is closed and verified. The deployed instance keeps the old behaviour until redeployed.

**Code Location Details:**
- **File:** `src/services/quiz.service.js` — `submitQuiz` (validation + `percent`).
- **File:** `src/services/course.service.js` — `hideAnswerKey`, `canSeeAnswerKey`, `getCourses`, `getCourseById`.
- **File:** `src/middlewares/optionalAuth.js` — optional caller identification for the public detail route.
- **File:** `src/routes/course.routes.js` — `optionalAuth` on `GET /:id`.
- **File:** `src/controllers/course.controller.js` — passes `req.user`.
- **Frontend reference (read-only):** `src/pages/CoursePlayer/CoursePlayer.jsx` — review rendering uses `question.correctIndex`.

---

## BUG-004 — Assignments could reference foreign lessons and accept invalid reviews

### 1. Location & Steps

**API:** `POST /api/assignments/submit`, `PATCH /api/admin/assignments/:id/review`.

**Files:** `src/services/assignment.service.js`, `src/services/admin.service.js`.

**Code Location (before fix):**
- `assignment.service.submitAssignment` — checked enrollment but not that `lessonId` belongs to the enrolled course.
- `admin.service.reviewAssignment` — accepted arbitrary `status`, non-numeric/out-of-range `grade`, and non-string notes; `findByIdAndUpdate` did not run validators.

**Steps:**
1. Enroll in course A, submit an assignment with a `lessonId` from course B.
2. Review a submission with `{ "status": "garbage" }`, `{ "grade": 101 }`, `{ "grade": "90" }`, `{ "reviewNotes": 5 }`.

### 2. Expected vs. Actual

**Expected:** the lesson must belong to the enrolled course; review fields must be validated; an invalid review changes nothing.

**Actual (before fix):** assignments could be attached to lessons the student never bought; invalid reviews were persisted or produced inconsistent documents.

**Actual (after fix):** a foreign lesson → `400` with no document created; each invalid review payload is rejected before the update; a valid review persists `grade`, `status`, `reviewNotes` and `reviewer`.

**Root Cause:** missing cross-document validation and no schema validation on the update path.

### 3. Severity & Evidence

**Severity:** Medium.

**Priority:** P2.

**Screenshot / Error:** No screenshot. Observed service error: `"Lesson not found in this course"` only after the fix.

**Evidence:** **test-based** — `BUG-008: an assignment must reference a lesson in the enrolled course`, `BUG-011: assignment review validates status, grade and notes`.

### 4. Fix & Verification

**Fix:** load the course syllabus and reject lesson ids outside it; validate `status` against `["submitted","reviewed"]`, `grade` as a finite number `0–100`, `reviewNotes` as a string; run validators on update.

**Status:** `Fixed & Verified`

**Changed Files:**
- `src/services/assignment.service.js` — lesson ownership check.
- `src/services/admin.service.js` — `reviewAssignment` validation and `runValidators`.

**Verification:**
- **Command:** `npm test` — **Result:** 46/46 pass.
- **Test:** both assignment tests — **Result:** pass.
- **Regression:** full suite — **Result:** pass.
- **API Verification:** service-level; no dedicated HTTP test for review.
- **Database Verification:** **PASS** — real submission `201`; foreign lesson `400`; admin review persisted `grade=90`, `status=reviewed`, reviewer set; invalid grade/status `400`; missing submission `404`.

**Known Limitations:** none identified within the verified scope. The unit suite stubs the model layer, but the admin review path is also covered by the real-database E2E run.

**Code Location Details:**
- **File:** `src/services/assignment.service.js` — `submitAssignment`.
- **File:** `src/services/admin.service.js` — `reviewAssignment`.

---

## BUG-005 — Admin filtering, analytics and list queries were incorrect or unbounded

### 1. Location & Steps

**API:** `GET /api/admin/assignments?courseId=...`, `GET /api/admin/analytics`, `GET /api/admin/enrollments`, `GET /api/users`.

**Files:** `src/services/admin.service.js`, `src/services/user.service.js`, `src/models/Enrollment.js`, `src/models/AssignmentSubmission.js`.

**Code Location (before fix):**
- `admin.service.getAssignments` — filtered on `courseId` although the schema field is `course`.
- `admin.service.getAnalytics` — started the window at "now − 30 days" while the chart rendered 30 buckets; grouped with `toISOString()` (UTC) but labelled with `getMonth()/getDate()` (local).
- `admin.service.getEnrollments`, `getAssignments`, `user.service.getAllUsers` — no page-size bound.
- `Enrollment` / `AssignmentSubmission` — no index for the admin list queries.

**Steps:**
1. Request the admin assignment list with `courseId`; compare with the course's submissions.
2. Open the analytics chart around local midnight and compare bucket dates with `enrollmentsLast30Days`.
3. Request an admin list with `limit=100000`.
4. Inspect the query plan for the list query (requires a database).

### 2. Expected vs. Actual

**Expected:** the filter matches the schema field; "last 30 days" means exactly 30 calendar days; bucket keys and labels use one timezone; page size is bounded; the list queries are indexed.

**Actual (before fix):**
- The filter used a non-existent field, so the admin assignment list ignored `courseId` and returned every submission.
- The query window covered 31 calendar days while the chart showed 30; UTC keys mixed with local labels could shift or duplicate a bucket around midnight.
- `limit` was unbounded, so a single request could load the entire collection.
- No compound index supported `{ course }` + `createdAt` sorting.

**Actual (after fix):**
- `filter.course = query.courseId`.
- The window starts at UTC midnight 29 days ago and ends before UTC midnight tomorrow; the grouping key and the display label are both derived from the same UTC date; exactly 30 unique buckets.
- Page size is clamped to `1…500` (default `200`), with `skip` derived from `page`.
- `Enrollment` has `{ course, batchId, createdAt }`; `AssignmentSubmission` has `{ course, createdAt }` and `{ student, course, createdAt }`.

**Root Cause:** a field-name mismatch, an off-by-one day boundary, mixed timezone APIs, missing pagination, and missing indexes.

### 3. Severity & Evidence

**Severity:** Medium (correctness + availability).

**Priority:** P3.

**Screenshot / Error:** No screenshot.

**Evidence:** **test-based** (`BUG-007: admin assignment list filters on the course field`, `BUG-005.2/5.3: analytics returns exactly 30 UTC days with matching labels`, `BUG-005.4: admin lists clamp the requested page size`, `BUG-005.4: the user list clamps its page size`, `BUG-005: indexes exist for the admin list queries`) and **source-only** for query performance.

### 4. Fix & Verification

**Fix:** use the real field name; align the query window, bucket key and label on UTC; clamp page size; declare the compound indexes.

**Status:** `Fixed & Verified`

**Changed Files:**
- `src/services/admin.service.js` — filter, analytics window/labels, pagination.
- `src/services/user.service.js` — user-list bound.
- `src/models/Enrollment.js` — compound index.
- `src/models/AssignmentSubmission.js` — two compound indexes.

**Verification:**
- **Command:** `npm test` — **Result:** 46/46 pass.
- **Test:** the five tests listed above — **Result:** pass.
- **Regression:** `BUG-007` admin filter test — **Result:** pass.
- **API Verification:** `NOT RUN` (no running database/admin session).
- **Database Verification:** **PASS** — the five declared indexes were created by `Model.init()` and read back from `system.indexes`; the real analytics query returned exactly 30 unique UTC buckets over live enrollment rows; the admin assignment filter returned only the matching course and a non-matching id returned 0. Index *performance* was not measured (`explain()` not run).

**Known Limitations:** the default page size is now `200` rows. The frontend admin tables do not send `page`, so a collection larger than 200 rows will only show the newest 200. This preserves the array response shape (no frontend change) but is a functional cap that should later be replaced by real pagination on both sides. Index performance is unmeasured.

**Code Location Details:**
- **File:** `src/services/admin.service.js` — `getAssignments`, `getEnrollments`, `getAnalytics`.
- **File:** `src/services/user.service.js` — `getAllUsers`.
- **File:** `src/models/Enrollment.js` — `enrollmentSchema.index`.
- **File:** `src/models/AssignmentSubmission.js` — `assignmentSubmissionSchema.index`.

---

## BUG-006 — Validation errors, infrastructure failures and HTTP semantics were wrong, and internal details leaked

### 1. Location & Steps

**API:** all routes; representative: `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/courses/:id`, `PATCH /api/admin/courses/:id`, `GET /` (health).

**Files:** `src/middlewares/validate.js`, `src/middlewares/errorMiddleware.js`, `src/utils/httpError.js` (new), `app.js`, all seven controllers, `src/services/auth.service.js`, `src/services/admin.service.js`.

**Code Location (before fix):**
- `validate.js` read `err.errors` (Zod 3 API) while Zod 4 exposes `err.issues`.
- Every controller caught all errors and returned one hard-coded 4xx with `err.message`.
- `errorMiddleware` read only `err.statusCode` and did not classify CastError/parse/driver errors.
- `app.js` mounted `GET /` **after** the DB middleware and returned `err.message` on DB failure.
- `admin.service.updateCourse` omitted `runValidators`.

**Steps:**
1. `POST /api/auth/register` with an invalid email/password.
2. `GET /api/courses/not-an-object-id`.
3. Start the app with an unreachable database; call `GET /` and `GET /api/courses`.
4. POST malformed JSON to `/api/auth/login`.
5. Log in with a wrong password, then with a banned account.
6. `PATCH` a course with `{ "title": null }`.

### 2. Expected vs. Actual

**Expected:** field-level validation details; `400` for malformed ids/JSON; `401`/`403`/`409` for auth outcomes; `503` for a database outage; the health check independent of the database; no internal Mongoose/parser/driver text in responses; schema validators applied on update.

**Actual (before fix):**
- `400 {"message":"Validation error"}` with no field details.
- `404 {"message":"Cast to ObjectId failed for value \"not-an-object-id\" … for model \"Course\""}`. **Runtime-based:** the live deployment still returns exactly this (`404` + CastError text), confirming the behaviour.
- Database outage → `500` with `err.message` (host/port) on **both** `/` and API routes.
- Malformed JSON → `400` with the parser's own `Unexpected end of JSON input`.
- Wrong password → `400` (not `401`); driver failures → `400` with internals.
- `PATCH` bypassed validators, so required fields could be nulled.

**Actual (after fix):**
- Zod issues are returned under `errors[]` with `path`/`message`.
- CastError → `400 {"message":"Invalid id"}` (or `Invalid value for <path>`), no Mongoose text.
- Malformed JSON → `400 {"message":"Malformed JSON in request body"}`.
- Invalid credentials → `401`; banned → `403`; duplicate email → `409`; driver failure → `503 {"message":"Service temporarily unavailable"}`.
- Domain failures now carry their real status instead of a blanket `400`: duplicate enrollment `409`, foreign enrollment `403`, missing enrollment/course/submission `404`; validation stays `400`.
- `GET /` returns `200` even with the database down; API routes return `503` without host details.
- Course updates run validators (`runValidators: true`), so a `null` required field is rejected.

**Root Cause:** outdated Zod API usage; a catch-all controller pattern that forced one 4xx per handler; an error middleware without error classification or message masking; middleware ordering that coupled liveness to the database; a missing `runValidators` option.

### 3. Severity & Evidence

**Severity:** High (internal disclosure, wrong statuses, silent data corruption on update).

**Priority:** P2.

**Screenshot / Error:** No screenshot. Actual live responses included the CastError text and `Access-Control-Allow-Origin: *`.

**Evidence:** combination of **test-based** and **runtime-based**.
- `BUG-013: validation errors include the failing fields`
- `BUG-006.2: a malformed id is a 400 without Mongoose internals`
- `BUG-006.3: malformed JSON is rejected without the parser message`
- `BUG-006.3: invalid credentials return 401, a banned account 403`
- `BUG-006.3: a driver failure is a 503, not a 400 with internals`
- `BUG-006.4: the health check does not depend on the database`
- `BUG-006.4: a database outage returns 503 without host details`
- `BUG-006.5: course updates run schema validators`
- `BUG-006: domain failures carry 409/403/404 instead of a generic 400`
- Live probes: `GET /api/courses/not-an-object-id`, malformed login, `GET /` — deployed build.

### 4. Fix & Verification

**Fix:** read Zod `issues`; introduce `attachStatus`/`httpError` so controllers only stamp fallbacks on domain errors; classify parse/Cast/validation/duplicate/driver errors in one middleware; mask 5xx messages in production; move the health route before the DB middleware and return `503` without details; add `runValidators: true`.

**Status:** `Fixed & Verified`

**Changed Files:**
- `src/middlewares/validate.js` — `err.issues`.
- `src/utils/httpError.js` (new) — `httpError`, `attachStatus`, `isInfrastructureError`.
- `src/middlewares/errorMiddleware.js` — classification and masking.
- `app.js` — health route order, generic `503`.
- `src/controllers/*.js` (7 files) — forward to `next`.
- `src/services/auth.service.js` — `401`/`403`/`409`.
- `src/services/enrollment.service.js`, `quiz.service.js`, `assignment.service.js`, `admin.service.js`, `user.service.js` — `403`/`404`/`409` domain statuses.
- `src/services/admin.service.js` — `runValidators`.

**Verification:**
- **Command:** `npm test` — **Result:** 46/46 pass.
- **Test:** the eight tests listed above — **Result:** pass.
- **Regression:** `BUG-013`, `BUG-014` — **Result:** pass.
- **API Verification:** local HTTP tests assert status codes and the absence of internal strings.
- **Database Verification:** **PASS** — real Atlas run: field-level validation `400`, invalid ObjectId `400` with no CastError text, missing id `404`, wrong password `401`, duplicate email `409`, student blocked from admin routes `403`, invalid course body `400` with `errors[]`, update with a `null` required field `400`, unknown route `404`; no internal driver text in any response.

**Known Limitations:** the deployed instance is not redeployed, so the live API still shows the old behaviour until a deployment is made. Development mode still returns stack traces (existing, deliberate debugging behaviour; not reclassified as a bug).

**Code Location Details:**
- **File:** `src/middlewares/errorMiddleware.js` — `errorHandler`.
- **File:** `src/utils/httpError.js` — `httpError`, `attachStatus`, `isInfrastructureError`.
- **File:** `app.js` — CORS config, `GET /`, DB middleware.
- **File:** `src/controllers/*.js` — each handler's `catch`.
- **File:** `src/services/admin.service.js` — `updateCourse`.

---

## BUG-007 — Security configuration, operations and dependencies were unsafe by default

### 1. Location & Steps

**API:** `GET /api/courses?search=...`, every cross-origin request, server startup, `npm run seed`, welcome-email delivery.

**Files:** `src/services/course.service.js`, `app.js`, `src/config/validateEnv.js` (new), `server.js`, `seed.js`, `src/services/email.service.js`, `package-lock.json`.

**Code Location (before fix):**
- `course.service.getCourses` built a `RegExp` from `search` without escaping.
- `app.js` used `app.use(cors())` plus a custom `Access-Control-Allow-Methods: GET, POST` header; `FRONTEND_URL` was never applied.
- `server.js` started without validating required environment variables and exited `0` on a fatal DB failure.
- `seed.js` deleted every collection without a production guard.
- `email.service` interpolated `userName` into HTML unescaped and logged the recipient address.
- `npm audit --omit=dev` reported 7 vulnerabilities.

**Steps:**
1. `GET /api/courses?search=%5B`.
2. Send a request with `Origin: https://evil.example`; inspect `Access-Control-Allow-Origin`.
3. Start the server with `JWT_SECRET` missing.
4. Run `NODE_ENV=production node seed.js`.
5. Register with a name containing `<img onerror=...>`.
6. Run `npm audit --omit=dev`.

### 2. Expected vs. Actual

**Expected:** search is literal text; only configured origins are allowed; startup fails fast on missing configuration and exits non-zero on a fatal DB error; seeding is impossible in production; HTML is escaped; production dependencies have no known high/critical vulnerability.

**Actual (before fix):**
- `search=[` produced `400 Regular expression is invalid: missing terminating ] for character class`. **Runtime-based:** reproduced on the live deployment.
- Every response carried `Access-Control-Allow-Origin: *` (live probe) while the advertised methods were only `GET, POST`.
- Missing `JWT_SECRET` was only discovered at the first login; a DB failure logged and exited `0`.
- `seed.js` would delete all collections in any environment.
- `userName` was inserted into HTML raw; the recipient address was logged.
- 7 production dependency vulnerabilities (1 critical, 4 high, 1 moderate, 1 low).

**Actual (after fix):**
- `search` is escaped (`replace(/[.*+?^${}()|[\]\\]/g, "\\$&")`); `search=.*` matches the literal text. Covered by `BUG-012`.
- CORS uses `FRONTEND_URL` (single origin or comma-separated list); unlisted origins receive no `Access-Control-Allow-Origin`; preflight advertises `GET, HEAD, PUT, PATCH, POST, DELETE`. With `FRONTEND_URL` unset, the development default remains permissive.
- Startup validates `MONGODB_URI` (or `MONGO_URI`) and `JWT_SECRET` (and enforces ≥32 chars for `JWT_SECRET` in production), then exits `1` on a fatal connection error.
- The connection success log now includes the database name, and a URI without a database path produces an explicit warning instead of silently using the default `test` database.
- `seed.js` refuses to run with `NODE_ENV=production` before any connection or deletion.
- Welcome-email user data is HTML-escaped; the recipient address is no longer logged.
- `npm audit fix --omit=dev` reduced the report to **1 high** (nodemailer); the remaining fix requires a breaking major upgrade and was not forced.

**Root Cause:** unescaped user input in a query, CORS configured permissively with an unused environment variable, no startup validation, a destructive script without an environment guard, unescaped HTML interpolation, and outdated transitive dependencies.

### 3. Severity & Evidence

**Severity:** High (wildcard CORS + regex injection + unguarded destructive seed).

**Priority:** P2.

**Screenshot / Error:** No screenshot. Live headers observed: `Access-Control-Allow-Origin: *`, `Access-Control-Allow-Methods: GET, POST`.

**Evidence:** combination of **test-based** and **runtime-based**.
- Tests: `BUG-012: search input is treated as a literal string`, three CORS tests, `BUG-007.3: startup validation…`, `BUG-007.4: the seed script refuses to run in production…`, `BUG-007.7: welcome-email user data is HTML escaped`, `BUG-001.6: the hash helper refuses a published default password`.
- Runtime: live probes for `search=[`, wildcard CORS, and the stale CastError response.

### 4. Fix & Verification

**Fix:** escape the search string; honour `FRONTEND_URL` with an explicit method list and remove the wrong custom header; validate environment variables at startup and exit non-zero on fatal DB failure; add a production guard to the seed script; escape HTML and stop logging recipient addresses; apply non-breaking dependency fixes.

**Status:** `Fix Applied — Verification Incomplete`

**Changed Files:**
- `src/services/course.service.js` — regex escaping.
- `app.js` — CORS configuration.
- `src/config/validateEnv.js` (new) — required-variable validation.
- `src/config/db.js` — reports the active database and warns about a missing database name.
- `server.js` — validation call and `process.exit(1)`.
- `seed.js` — production guard.
- `src/services/email.service.js` — `escapeHtml`, no recipient logging.
- `package-lock.json` — non-breaking dependency updates.

**Verification:**
- **Command:** `npm test` — **Result:** 46/46 pass.
- **Test:** the seven tests listed above — **Result:** pass.
- **Regression:** full suite after the dependency update — **Result:** 46/46 pass.
- **Build:** not applicable.
- **Lint:** `NOT RUN` (no lint script).
- **API Verification:** CORS preflight and origin behaviour proven over HTTP in `tests/cors-config.test.js`.
- **Database Verification:** **PASS** for the runtime checks: the connect-time warning identified the default `test` database without printing the URI; CORS/origin handling, search escaping and HTML escaping were exercised over HTTP. The destructive seed guard was unit/child-process tested and deliberately **not** run against the shared database.

**Known Limitations:**
- **1 high severity vulnerability remains** (`nodemailer`); the available fix is `nodemailer@10`, a breaking major upgrade. It was not applied to avoid changing the email API without review.
- The deployed instance still advertises wildcard CORS and the old regex behaviour until redeployed.
- `FRONTEND_URL` must be set in the deployment environment for the allow-list to take effect; when unset, the permissive development default is retained by design.
- `npm audit fix --omit=dev` performs an install with `--omit=dev`, which removes `devDependencies` (including `nodemon`) from `node_modules`. Run `npm install` afterwards to restore the local development tooling; production deploys should keep omitting dev dependencies.
- The connected URI has **no database name**, so the driver uses the default `test` database. A startup warning now makes this visible. Adding an explicit database name (for example `/coursemaster`) to `MONGODB_URI` is recommended; it was not changed here because it would relocate the database and requires a deployment decision.
- Index performance (BUG-005) is unmeasured because the database is unreachable.

**Code Location Details:**
- **File:** `src/services/course.service.js` — `getCourses` (search escaping).
- **File:** `app.js` — `allowedOrigins`, `cors(...)`.
- **File:** `src/config/validateEnv.js` — `validateEnv`, `REQUIRED_VARIABLES`.
- **File:** `src/config/db.js` — `hasExplicitDatabaseName`, connection log with database name.
- **File:** `server.js` — `validateEnv()` and `.catch(... process.exit(1))`.
- **File:** `seed.js` — `seedDatabase` production guard.
- **File:** `src/services/email.service.js` — `escapeHtml`, `sendWelcomeEmail`.

---

## 4. Test summary

| Check | Actual command/test | Actual result | Status |
|---|---|---|---|
| Syntax | `node --check` on project JS files | 0 failures | PASS |
| Automated tests | `npm test` | 46 tests, 46 pass, 0 fail | PASS |
| Regression tests | `tests/regression.test.js` (17 tests) | all pass | PASS |
| Error-handling tests | `tests/http-errors.test.js` (6 tests) | all pass | PASS |
| Hardening tests | `tests/backend-hardening.test.js` (12 tests) | all pass | PASS |
| CORS tests | `tests/cors-config.test.js` (3 tests) | all pass | PASS |
| Seed-credential tests | `tests/seed-credentials.test.js` (6 tests) | all pass | PASS |
| Dependency audit (before) | `npm audit --omit=dev` | 7 vulnerabilities (1 critical) | FAIL (fixed partially) |
| Dependency audit (after) | `npm audit --omit=dev` | 1 high (nodemailer) | FAIL (breaking fix deferred) |
| Build | not applicable to the backend | NOT RUN | N/A |
| Lint | no lint script | NOT RUN | N/A |
| Database connection | driver connect + `admin.ping()` | MongoDB 8.0.34, database `test`, ping ok | PASS |
| Database indexes | `Model.init()` + `listIndexes` | 5 declared indexes created, both unique indexes enforced | PASS |
| Database operations | 130-assertion real-DB E2E, prefixed records | 130 pass, 0 fail, cleanup 0 leftovers | PASS |
| Server startup | `node server.js` + HTTP requests | `MongoDB Connected`, `/` 200, `/api/courses` 200 | PASS |
| API tests | real-DB HTTP suite + local suites | all status/body assertions pass | PASS |
| Deployment check | live probes | deployed build still stale | LIMITATION |

---

## 5. Historical index (original audit findings, by title)

The original audit recorded 32 findings under numbered child identifiers. They are preserved here by title only, mapped to their parent report; the old numbering remains in git history.

| Original finding (title) | Parent report | Outcome |
|---|---|---|
| Login rejects every valid credential | BUG-001 | Fixed & Verified |
| Invalid/expired JWT does not stop the request | BUG-001 | Fixed & Verified |
| Bans, deletions and role changes do not affect existing tokens | BUG-001 | Fixed & Verified |
| Concurrent registration returns a raw duplicate-key error | BUG-001 | Fixed & Verified |
| Documented admin-registration key is ignored | BUG-001 | Fixed & Verified |
| Seeded default admin credentials are published | BUG-001 | Fixed & Verified (connected database has no seeded admin) |
| Students can never enroll in a course | BUG-002 | Fixed & Verified |
| Any user can rewrite any enrollment's progress | BUG-002 | Fixed & Verified |
| Enrollment accepts a batch from another course | BUG-002 | Fixed & Verified |
| Concurrent enrollment exposes a raw duplicate-key error | BUG-002 | Fixed & Verified |
| Deleting a course/user leaves orphaned rows | BUG-002 | Fixed & Verified (policy: hard cascade) |
| Quiz percentage is 10x too low | BUG-003 | Fixed & Verified |
| Quiz answers are not type-validated | BUG-003 | Fixed & Verified |
| Public course responses expose the answer key | BUG-003 | Fixed for anonymous/list; enrolled students retain it for the review screen |
| Assignment can reference a lesson outside the course | BUG-004 | Fixed & Verified |
| Assignment review accepts invalid status/grade/notes | BUG-004 | Fixed & Verified |
| Admin assignment list ignores its course filter | BUG-005 | Fixed & Verified |
| "Last 30 days" counts 31 calendar days | BUG-005 | Fixed & Verified |
| Analytics mixes UTC keys with local labels | BUG-005 | Fixed & Verified |
| Admin/user lists have no pagination bounds | BUG-005 | Fixed (bounded; real pagination pending) |
| Missing indexes for admin queries | BUG-005 | Fixed & Verified (created on Atlas; performance unmeasured) |
| Validation errors lose field details | BUG-006 | Fixed & Verified |
| Invalid ObjectIds leak CastError internals | BUG-006 | Fixed & Verified |
| Controllers map infrastructure failures to 4xx | BUG-006 | Fixed & Verified |
| DB middleware leaks host details; health depends on DB | BUG-006 | Fixed & Verified |
| Course updates bypass validators | BUG-006 | Fixed & Verified |
| Search input injected into a regular expression | BUG-007 | Fixed & Verified |
| CORS allows every origin while `FRONTEND_URL` is unused | BUG-007 | Fixed & Verified |
| Startup does not validate env; exits 0 on fatal DB failure | BUG-007 | Fixed & Verified |
| Seed script wipes every collection without a guard | BUG-007 | Fixed & Verified |
| Production dependency audit reports vulnerabilities | BUG-007 | Partially fixed (1 high remains, breaking) |
| Welcome email interpolates unescaped data and logs recipients | BUG-007 | Fixed & Verified |

---

## 6. Progress log

| Date | Stage | Group | Code changes | Verification | Status |
|---|---|---|---|---|---|
| 2026-10-21 | Initial audit | — | None (read-only) | Full read, syntax check, tests, probes, audit, DB ping | Inventory complete |
| 2026-10-21 | Fix | BUG-001 | `seed.js`, `src/utils/seedCredentials.js`, `README.md`, `.env.example`, `hash.js`; 6 tests | `npm test` 23/23 at the time; targeted 6/6 | Fixed |
| 2026-10-21 | Fix | BUG-006 (partial) | `src/utils/httpError.js`, `errorMiddleware.js`, `app.js`, 7 controllers, `auth.service.js`; 6 HTTP tests | `npm test` 29/29 | 3 of 5 fixed |
| 2026-10-21 | Fix | BUG-002, 004, 005, 006.5, 007 | enrollment cascade/race, assignment/review, analytics/pagination/indexes, CORS, env validation, seed guard, email escaping, `runValidators`; 13 tests | `npm test` 44/44; `node --check` 47/47; audit 7 → 1 | Fixed (BUG-003 blocked) |
| 2026-10-21 | Report rewrite | BUG-001…007 | `BUG_REPORT_BACKEND.md` restructured into seven parent reports | Final suite 44/44 | Complete |
| 2026-10-22 | Final verification | BUG-002/003/004/006 (+DB config) | precise `403`/`404`/`409` statuses; answer-key scoping; database-name warning; 2 new unit tests | `npm test` 46/46; real Atlas E2E 130/130; `node server.js` healthy; 0 leftover records | Fixed & Verified |

---

## 7. Remaining issues and blockers

1. **BUG-003 — answer-key exposure (narrowed).** Anonymous and list responses no longer contain `correctIndex`; enrolled students and admins still receive it because the frontend player renders its review from that field. Fully closing this needs a submission-scoped review endpoint plus a frontend change.
2. **Dependency audit — 1 high (`nodemailer`).** The fix is a breaking major upgrade (`nodemailer@10`). Deferred pending an email-path regression review.
3. **Default database name — configuration decision.** The URI has no database path, so data is stored in the driver's default `test` database. A startup warning now reports it, but adding an explicit name (e.g. `/coursemaster`) is a deployment decision and was not applied.
4. **Deployed-instance verification — STALE.** `course-master-backend-ochre.vercel.app` still shows the old CastError, wildcard CORS and regex behaviour. A redeploy is required before the fixes are visible there.
5. **Pagination contract — partial.** Admin/user lists are capped at 200 rows (max 500) without changing the array response shape. Real pagination needs a coordinated frontend change.
6. **Frontend credential exposure — out of scope.** `courseMaster_frontEnd/src/pages/Login/Login.jsx` and its `README.md` still publish demo credentials; they are recorded in the frontend report, not fixed here.
7. **Empty database / seed not run.** All five collections exist but contain no documents. No destructive seed script was executed; the first admin must be created explicitly.
8. **Index performance — unmeasured.** The indexes exist and the unique constraints are enforced, but no `explain()` execution-plan analysis was performed.

---

## 8. Safety statement

- No frontend file was modified.
- No credentials, tokens or `.env` contents are reproduced in this report.
- `.env` remains untracked and excluded by `.gitignore`.
- The original `Pullock4981` repositories were never modified, committed to, or pushed.
- No commit or push was performed in this workspace.
- Real-database verification used only isolated `e2e.<timestamp>` records; the cleanup check confirmed 0 leftover users, courses, enrollments, assignments and quizzes. No pre-existing data was modified or deleted.
- All test counts and command results above were produced by commands actually executed in this session; blocked or unmeasured checks are labelled rather than inferred.
