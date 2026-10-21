# CourseMaster Backend — Bug Bashing Report

**Repository:** `courseMaster_Backend` (local clone; remote = `Hayder987/CourseMaster_backend_sloved`)
**Branch / commit:** `main` @ `c060b62`
**Audit date:** 2026-10-21
**Stack:** Node.js + Express 5 + Mongoose 9 + JWT + bcrypt + Zod
**Phase:** B — all six confirmed groups (BUG-001 … BUG-006) fixed and verified. No application change is pending approval.

## Scope and method

The whole backend was read (`app.js`, `server.js`, `api/index.js`, all routes, controllers, services, models, middlewares, validators). Candidate defects were then exercised in an isolated harness in the system temp directory. The harness stubs only the Mongoose model/DB boundary and boots the **real** Express app, routes, middlewares, controllers and services, so HTTP status codes, headers and service return values are genuine. No database, no production endpoint and no live site was mutated.

**Environment limitations (honest statement):**

- `.env` currently contains only `VITE_API_BASE_URL` (a frontend variable). `MONGODB_URI` and `JWT_SECRET` are absent.
- `node server.js` was executed: it exits with `Initial DB connection failed: MONGODB_URI or MONGO_URI missing in .env` / `DB connection failed: ...`. The backend therefore **cannot** boot locally as-is.
- No MongoDB server, no Docker and no `mongodb-memory-server` are installed, so no real-DB integration test or reproduction against persisted data was possible.
- `.env.example` does not document the backend variables described in `README.md`; it contains only `VITE_API_BASE_URL`.
- `package.json` has no test script and the repository has no test suite.
- No production write request, account creation, payment, enrollment or auth flow was performed against the live site.

Because of the above, every finding below is either (a) observed directly by executing the backend code with a stubbed DB boundary, or (b) marked as source-code evidence only.

## Confirmed defect groups (6)

| ID | Title | Severity | Priority | Reproduced | Status |
|----|-------|----------|----------|------------|--------|
| BUG-001 | Login rejects every valid credential | Critical | P1 | Yes (service + HTTP) | **Fixed & Verified** |
| BUG-002 | Invalid/expired JWT does not stop the request (authentication bypass) | Critical | P1 | Yes (HTTP) | **Fixed & Verified** |
| BUG-003 | Students can never enroll in a course | High | P1 | Yes (service + HTTP) | **Fixed & Verified** |
| BUG-004 | Any user can rewrite any enrollment's progress; progress can exceed 100% | High | P2 | Yes (HTTP + service) | **Fixed & Verified** |
| BUG-005 | Quiz percentage is 10× too low | High | P2 | Yes (service + HTTP) | **Fixed & Verified** |
| BUG-006 | Documented admin-registration key is ignored | Medium | P3 | Yes (service + HTTP) | **Fixed & Verified** |

---

# BUG-001 - Login rejects every valid credential

**1. Location & Steps**  
Page: `POST /api/auth/login` (also affects the duplicate-email check in `POST /api/auth/register`)  
File: `src/services/auth.service.js`  
Code Location: `login()` (pre-fix lines 35–49, password check line 40; post-fix lines 39–54, password check line 43); `register()` (pre-fix lines 8–20; post-fix lines 11–24); ban state was never consulted  
Steps:  
1. Register/seed a user. Passwords are stored as a bcrypt hash (`register()`, `seed.js`).
2. `POST /api/auth/login` with that user's email and **correct** plaintext password.
3. Observe the rejection. Then retry with the email in different letter case.

**2. Expected vs. Actual**  
Expected: a correct password authenticates the user (bcrypt comparison), email matching is case-insensitive (the `User` schema stores emails with `lowercase: true`), and a user with `isBanned: true` is refused.  
Actual (before fix): `login()` compared the plaintext password to the stored hash with `password === user.passwordHash`, which can never be true for a bcrypt hash; every login failed with `Invalid email or password`. `User.findOne({ email })` received the raw input and the schema `lowercase` setter is **not** applied to query filters (verified: filter sent as `{"email":"S@Example.COM"}`), so any uppercase letter in the email also failed. `isBanned` was never read in the authentication path (only `src/models/User.js:11` and `src/services/user.service.js:30`).  
Actual (after fix): correct credentials return `200` with a token, wrong passwords still return `400 Invalid email or password`, mixed-case/padded emails authenticate, and a banned user with a correct password is rejected with `Account is banned`.

**3. Severity & Evidence**  
Severity: Critical  
Priority: P1  
Screenshot / Error: Before fix, executed against the real `authService.login` with a real bcrypt hash of `Correct#123`: `REJECTED: Invalid email or password`. After fix: `PASS [V1] … token issued, payload={"id":"666…666","role":"student",...}` and `PASS [V8] HTTP POST /api/auth/login correct credentials -> status=200`.

**4. Fix & Verification**  
Fix (applied): added `normalizeEmail()` (`trim().toLowerCase()`), used it for the `register()` duplicate lookup, the stored email, and the `login()` lookup; replaced plaintext equality with `await bcrypt.compare(password, user.passwordHash)`; added `if (user.isBanned) throw new Error("Account is banned")` **after** password verification so ban status is not disclosed to callers without valid credentials.  
Status: Fixed & Verified

**Changed Files:**
- `src/services/auth.service.js` — added email normalization helper, bcrypt password verification, banned-account rejection.

**Verification:**
- Command: `node --check src/services/auth.service.js` — Result: exit code 0.
- Command: `node %TEMP%\cm-audit\verify-bug001.js` — Result: `10/10 checks passed` (V1 correct password, V2 wrong password, V3 mixed-case email, V4 banned user, V5 banned user with wrong password, V6 register normalization, V7 duplicate with different case, V8 HTTP login 200, V9 HTTP login 400, V10 HTTP register normalization).
- Regression: `node %TEMP%\cm-audit\audit.js` — Result: T1/T2 changed from `REJECTED` to `SUCCESS`; all other observations (T3–T15) unchanged, i.e. no side effects on BUG-002 … BUG-006.
- Remaining limitation: no real MongoDB available, so the bcrypt comparison and normalization were verified against a stubbed model boundary, not persisted data. No test script exists in `package.json`.

**Code Location Details:**
- File: `src/services/auth.service.js`
- Function/Method: `normalizeEmail()`, `register()`, `login()`
- Lines (post-fix): `normalizeEmail` 8–9; `register` 11–37 (lookup 13, stored email 21); `login` 39–54 (lookup 40, `bcrypt.compare` 43, ban check 46)
- Change summary: email normalization for storage/lookup, real bcrypt verification, banned-user rejection after credential validation.


---

# BUG-002 - Invalid/expired JWT does not stop the request (authentication bypass)

**1. Location & Steps**  
Page: All protected routes (`/api/auth/me`, `/api/enrollments/*`, `/api/assignments/*`, `/api/quizzes/*`, `/api/admin/*`, `/api/users/*`)  
File: `src/middlewares/authMiddleware.js`  
Code Location: `authMiddleware()` lines 13–20 (pre-fix `catch` called `next()` at line 19; post-fix returns 401 at line 19)  
Steps:  
1. Send `PATCH /api/enrollments/<enrollId>/complete-lesson` with `Authorization: Bearer not-a-valid-jwt`.
2. Send `GET /api/auth/me` with the same invalid token.
3. Send `GET /api/admin/analytics` with the same invalid token.

**2. Expected vs. Actual**  
Expected: `401 Not authorized` for every request whose token is missing, malformed, invalid, expired, or signed with the wrong secret.  
Actual (before fix): the `catch` block called `next()` without setting `req.user`, so the request continued into the handler as if authenticated. Observed: the unauthenticated `PATCH complete-lesson` returned **200** and mutated progress; `GET /api/auth/me` returned **404** with `{"message":"Cannot read properties of undefined (reading 'id')"}`; `GET /api/admin/analytics` returned **403 `Admin access only`** instead of 401. Any route that did not dereference `req.user` (e.g. `completeLesson`) was fully reachable without a token.  
Actual (after fix): all invalid/expired/mis-signed tokens and missing/malformed headers return `401 {"message":"Not authorized"}` before any controller or service runs.

**3. Severity & Evidence**  
Severity: Critical (unauthenticated state change was demonstrated)  
Priority: P1  
Screenshot / Error: Before fix: `PATCH /api/enrollments/666…5/complete-lesson` + invalid JWT → `status=200`, progress mutated; `/api/auth/me` → `status=404`; `/api/admin/analytics` → `status=403`. After fix: the same requests → `status=401 body={"message":"Not authorized"}`, with the service confirmed not invoked (`serviceRan=false`).

**4. Fix & Verification**  
Fix (applied): the `catch` block now returns `401 { message: "Not authorized" }` instead of calling `next()`, so no handler executes without a verified token.  
Status: Fixed & Verified

**Changed Files:**
- `src/middlewares/authMiddleware.js` — reject failed JWT verification with 401 instead of continuing the request.

**Verification:**
- Command: `node --check src/middlewares/authMiddleware.js` — Result: exit code 0.
- Command: `node %TEMP%\cm-audit\verify-bug002.js` — Result: `10/10 checks passed` (missing header, invalid token on `/me`/admin/complete-lesson, valid token on `/me`, student token on admin still 403, expired token, wrong-secret token, valid token still reaches handler, malformed `Bearer`).
- Regression: `node %TEMP%\cm-audit\verify-bug001.js` — Result: `10/10 checks passed`.
- Regression: `node %TEMP%\cm-audit\audit.js` — Result: T8/T9/T10 changed from `404`/`403`/`200` to `401`; T13 still `200` because BUG-004 is not fixed yet; other observations unchanged.
- Remaining limitation: no real MongoDB/multi-instance test. Note that a **valid** token still allows cross-student progress writes until BUG-004 is fixed, and roles/bans embedded in a 30-day token are not revalidated (deferred finding).

**Code Location Details:**
- File: `src/middlewares/authMiddleware.js`
- Function/Method: `authMiddleware()`
- Lines: 13–20 (rejection at line 19)
- Change summary: `catch` now returns 401 instead of `next()`.


---

# BUG-003 - Students can never enroll in a course

**1. Location & Steps**  
Page: `POST /api/enrollments/:courseId`  
File: `src/services/enrollment.service.js`  
Code Location: `enrollCourse()` (pre-fix lines 4–28, inverted condition 14–17; post-fix lines 4–27, condition 14–16)  
Steps:  
1. Authenticate as a student who is **not** enrolled in the course.
2. `POST /api/enrollments/<courseId>`.
3. Observe the 400 error; then repeat as an already-enrolled student.

**2. Expected vs. Actual**  
Expected: a not-yet-enrolled student gets a created enrollment (`201`); an already-enrolled student is rejected.  
Actual (before fix): `if (!enrollment) throw new Error("Already enrolled in this course")` rejected exactly the not-enrolled case, so **no student could ever enroll**. For an already-enrolled student the code proceeded to `Enrollment.create(...)`, which violates the unique compound index `{student, course}` and fails with a duplicate-key error. Executed result: not-enrolled student → `ERROR THROWN: Already enrolled in this course`.  
Actual (after fix): not-enrolled → enrollment created (`201`, `progress {completedLessons: [], percent: 0}`, `batchId` forwarded or `null`); already-enrolled → `400 Already enrolled in this course` with no second insert; unknown course still → `Course not found`.

**3. Severity & Evidence**  
Severity: High (core student feature was completely unusable)  
Priority: P1  
Screenshot / Error: Before fix — `ERROR THROWN: Already enrolled in this course`. After fix — `PASS [V8] HTTP POST enroll (not enrolled) -> status=201 createCalls=1`; `PASS [V9] HTTP POST enroll (already enrolled) -> status=400 createCalls=1`.

**4. Fix & Verification**  
Fix (applied): inverted the existence condition to `if (enrollment) throw new Error("Already enrolled in this course")`, so the create path runs only when no enrollment exists.  
Status: Fixed & Verified

**Changed Files:**
- `src/services/enrollment.service.js` — corrected the inverted enrollment existence check.

**Verification:**
- Command: `node --check src/services/enrollment.service.js` — Result: exit code 0.
- Command: `node %TEMP%\cm-audit\verify-bug003.js` — Result: `10/10 checks passed` (create on first attempt, reject duplicate without insert, unknown course, `batchId` forwarded/omitted, progress initialized, unique index intact, HTTP 201/400/401).
- Regression: `node %TEMP%\cm-audit\verify-bug001.js` → `10/10`, `verify-bug002.js` → `10/10`.
- Regression: `node %TEMP%\cm-audit\audit.js` — Result: T4 changed to `SUCCESS (enrollment created)`; all other observations unchanged.
- Remaining limitation: no real MongoDB, so uniqueness under a concurrent double-submit was not exercised; the unique index is still declared and verified at schema level.

**Code Location Details:**
- File: `src/services/enrollment.service.js`
- Function/Method: `enrollCourse()`
- Lines (post-fix): 4–27 (condition 14–16, create 19–24)
- Change summary: `if (!enrollment)` → `if (enrollment)`.


---

# BUG-004 - Any user can rewrite any enrollment's progress; progress can exceed 100%

**1. Location & Steps**  
Page: `PATCH /api/enrollments/:enrollId/complete-lesson`  
File: `src/services/enrollment.service.js` (also `src/controllers/enrollment.controller.js`, `src/routes/enrollment.routes.js`)  
Code Location: `completeLesson()` (pre-fix lines 35–62: no ownership check 36–37, no lesson validation, `enrollment.save()` not awaited at line 60; post-fix lines 35–78: ownership 39–42, lesson validation 48–57, awaited save 76); controller lines 25–36 (caller identity passed at line 30)  
Steps:  
1. Log in as student A and obtain A's token.
2. Send `PATCH /api/enrollments/<student B's enrollId>/complete-lesson` with A's token and a `lessonId`.
3. Repeat with a syntactically valid `lessonId` that does not belong to the course, and with a `save()` failure.

**2. Expected vs. Actual**  
Expected: only the owner of the enrollment may update it; the lesson must exist in that course; the write must be awaited so failures are reported.  
Actual (before fix): `completeLesson(enrollId, lessonId)` received no caller identity, so any authenticated caller could modify any enrollment (and, before BUG-002, even an unauthenticated caller). Executed with student A's token against student B's enrollment: **200 OK** with the document modified. Lesson IDs were never validated against the course: an arbitrary ID was appended to `completedLessons` and counted — executed: a 1-lesson course with 4 arbitrary lesson IDs reported **percent=400**. `enrollment.save()` was not awaited, so a rejected write still returned success while raising an unhandled rejection — executed: `returned percent=100, unhandledRejection="simulated Mongo write failure"`.  
Actual (after fix): the controller passes `req.user.id`; a non-owner request returns `400 Not authorized for this enrollment` with no write; a lesson outside the course returns `400 Lesson not found in this course`; the percentage counts only lessons that belong to the course (legacy bogus IDs no longer inflate it); and a failed `save()` now rejects to the caller with no unhandled rejection.

**3. Severity & Evidence**  
Severity: High (broken access control + silent data loss + corrupt progress)  
Priority: P2  
Screenshot / Error: Before fix — IDOR: `status=200` on another student's enrollment (`owner=…664`, caller `…663`); percentage: `percent for 1-lesson course with 4 arbitrary lessonIds = 400`; persistence: `returned percent=100, unhandledRejection="simulated Mongo write failure"`. After fix — `status=400 {"message":"Not authorized for this enrollment"} saveCalls=0`; `REJECTED to caller (save awaited): simulated Mongo write failure, unhandledRejection=null`; legacy bogus progress normalised to `percent=50`.

**4. Fix & Verification**  
Fix (applied): controller passes `req.user.id` to `completeLesson(enrollId, lessonId, studentId)`; the service rejects when the enrollment's `student` differs from the caller; it loads the course (guarding a missing course), flattens the syllabus, rejects a `lessonId` that is not part of that course, counts only course lessons when computing the percentage, and `await`s `enrollment.save()`.  
Status: Fixed & Verified

**Changed Files:**
- `src/services/enrollment.service.js` — ownership check, lesson validation, course guard, valid-lesson percentage, awaited save.
- `src/controllers/enrollment.controller.js` — forwards `req.user.id` to the service.

**Verification:**
- Command: `node --check src/services/enrollment.service.js` and `node --check src/controllers/enrollment.controller.js` — Result: exit code 0 for both.
- Command: `node %TEMP%\cm-audit\verify-bug004.js` — Result: `12/12 checks passed` (owner update, non-owner blocked without write, foreign lesson blocked, duplicate handling, save failure surfaced with no unhandled rejection, legacy bogus IDs normalised, missing enrollment/course, HTTP 200/400/401).
- Regression: `verify-bug001.js` `10/10`, `verify-bug002.js` `10/10`, `verify-bug003.js` `10/10`.
- Regression: `node %TEMP%\cm-audit\audit.js` — Result: T6 now `REJECTED to caller (save awaited)`; T13 now `status=400 Not authorized`; all other observations unchanged.
- Remaining limitation: no real MongoDB integration test. The non-owner response is `400` (the controller's existing error contract) rather than `403`; changing that would alter the API contract, so it was left as-is.

**Code Location Details:**
- File: `src/services/enrollment.service.js`
- Function/Method: `completeLesson()`
- Lines (post-fix): 35–78 (ownership 39–42, lesson validation 48–57, awaited save 76)
- File: `src/controllers/enrollment.controller.js`
- Function/Method: `completeLesson()`
- Lines: 25–36 (`req.user.id` at line 30)
- Change summary: caller identity enforced, lesson validated against the course, percentage based on valid lessons, save awaited.


---

# BUG-005 - Quiz percentage is 10× too low

**1. Location & Steps**  
Page: `POST /api/quizzes/submit` (and consequently `GET /api/quizzes/stats`)  
File: `src/services/quiz.service.js`  
Code Location: `submitQuiz()` (pre-fix: comment line 33, wrong calculation line 34; post-fix: line 33), persisted at line 54, returned at line 66; consumed by `getQuizStats()` lines 107–118  
Steps:  
1. Enroll a student in a course whose lesson has a 2-question quiz.
2. `POST /api/quizzes/submit` with both answers correct (`[1,1]` for `correctIndex: 1`).
3. Read `percent` from the response and from `GET /api/quizzes/stats?courseId=...`.

**2. Expected vs. Actual**  
Expected: 2/2 correct → `percent: 100` (README example shows `score: 3` of `total: 4` → `percent: 75`).  
Actual (before fix): the score was divided then multiplied by **10** instead of 100, so 2/2 yielded `percent: 10`. The wrong value was written to `QuizSubmission.percent`, so quiz statistics and dashboard averages were also wrong. Executed: `score=2/2, percent=10`.  
Actual (after fix): 2/2 → `100`, 1/2 → `50`, 0/2 → `0`, 2/3 → `67` (rounded); the persisted document stores the corrected value and `getQuizStats()` averages it correctly. Historical submissions created before this fix still contain their old wrong percentages (no data migration was performed).

**3. Severity & Evidence**  
Severity: High (correct answers were persisted as near-failing scores)  
Priority: P2  
Screenshot / Error: Before — `score=2/2, percent=10`. After — `PASS [V1] 2/2 correct -> 100%`; `PASS [V10] HTTP quiz submit 2/2 -> status=200 score=2/2 percent=100`.

**4. Fix & Verification**  
Fix (applied): changed the multiplier from `10` to `100` in `submitQuiz()`.  
Status: Fixed & Verified

**Changed Files:**
- `src/services/quiz.service.js` — correct percentage formula.

**Verification:**
- Command: `node --check src/services/quiz.service.js` — Result: exit code 0.
- Command: `node %TEMP%\cm-audit\verify-bug005.js` — Result: `11/11 checks passed` (100/50/0/67 cases, partial answers, persisted value, stats average, no-quiz and not-enrolled regressions, HTTP 200 + 401).
- Regression: `verify-bug001.js` `10/10`, `verify-bug002.js` `10/10`, `verify-bug003.js` `10/10`, `verify-bug004.js` `12/12`.
- Regression: `node %TEMP%\cm-audit\audit.js` — Result: T5 changed from `percent=10` to `percent=100`; all other observations unchanged.
- Remaining limitation: historical `QuizSubmission` rows keep their old values; no migration was requested or performed. No real MongoDB integration test.

**Code Location Details:**
- File: `src/services/quiz.service.js`
- Function/Method: `submitQuiz()`
- Lines (post-fix): 32–33, persisted 54, returned 66
- Change summary: `(score / total) * 10` → `(score / total) * 100`.


---

# BUG-006 - Documented admin-registration key is ignored

**1. Location & Steps**  
Page: `POST /api/auth/register`  
File: `src/services/auth.service.js` (schema: `src/validators/auth.validation.js`)  
Code Location: `register()` (pre-fix line 8 destructured `adminKey` and never used it; lines 14–20 used `role || "student"`; post-fix: `matchesAdminKey()` 13–16, `resolveRegistrationRole()` 19–27, `register()` 29–55); `adminKey` accepted at `src/validators/auth.validation.js:9`; `ADMIN_REGISTRATION_KEY` was referenced nowhere in `src/`  
Steps:  
1. `POST /api/auth/register` with `{ name, email, password, adminKey: "<the configured admin key>" }`.
2. Inspect the created user's `role`.
3. Compare with `README.md` ("Admin Registration" section) and the frontend, which sends `adminKey` (`src/pages/auth/Register.jsx:22–29`).

**2. Expected vs. Actual**  
Expected (per `README.md`): a valid `adminKey` matching `ADMIN_REGISTRATION_KEY` creates an `admin`; an invalid one fails; the key feature is disabled when the variable is unset.  
Actual (before fix): `adminKey` was destructured and discarded, so every registration created a `student` and the documented admin flow silently did nothing. Executed: `created role="student"` even with an admin key supplied.  
Actual (after fix): valid key → `admin` (in the user document and the JWT); wrong key → `400 Invalid admin key` with no user created; key supplied while the variable is unset → `400 Admin registration is disabled`; no key → `student` as before. The `role` field is no longer part of the service signature, so it cannot be used to escalate even if validation changes.

**3. Severity & Evidence**  
Severity: Medium  
Priority: P3  
Screenshot / Error: Before — `created role="student" (env ADMIN_REGISTRATION_KEY not consulted)`; `grep ADMIN_REGISTRATION_KEY src/` → no matches. After — `created role="admin" token role="admin"`; invalid key → `error="Invalid admin key" createCalls=0`; unset env → `error="Admin registration is disabled" createCalls=0`.

**4. Fix & Verification**  
Fix (applied): added `resolveRegistrationRole()` which keeps `student` when no key is supplied, rejects when `ADMIN_REGISTRATION_KEY` is unset or does not match (constant-time SHA-256 comparison via `crypto.timingSafeEqual`), and returns `admin` only on a match; removed `role` from the `register()` payload destructuring.  
Status: Fixed & Verified

**Changed Files:**
- `src/services/auth.service.js` — implemented admin-key resolution and removed the direct `role` input path.

**Verification:**
- Command: `node --check src/services/auth.service.js` — Result: exit code 0.
- Command: `node %TEMP%\cm-audit\verify-bug006.js` — Result: `12/12 checks passed` (no key, valid key, invalid key, unset env, role injection at service and HTTP level, email normalization, duplicate email, HTTP 201/400, BUG-001 login regression).
- Regression: `verify-bug001.js` `10/10`, `verify-bug002.js` `10/10`, `verify-bug003.js` `10/10`, `verify-bug004.js` `12/12`, `verify-bug005.js` `11/11`.
- Regression: `node %TEMP%\cm-audit\audit.js` — Result: T3 now `REJECTED: Admin registration is disabled` (env unset) and T3c `created role="admin"` (matching key); all other observations unchanged.
- Remaining limitation: `.env` in this workspace has no `ADMIN_REGISTRATION_KEY`, so the happy path was verified with a test key in-process; enabling the feature in a real deployment requires setting that variable. No real MongoDB integration test.

**Code Location Details:**
- File: `src/services/auth.service.js`
- Function/Method: `matchesAdminKey()`, `resolveRegistrationRole()`, `register()`
- Lines (post-fix): 13–16, 19–27, 29–55 (role resolution at 34)
- Change summary: documented admin-key flow implemented; direct role input removed.


---

## Checked and NOT confirmed (do not fix as a bug)

1. **CORS blocks PUT/PATCH/DELETE (`// Code-10 bug` in `app.js:29`)** — **Not a defect.** `cors()` handles preflight itself and terminates it before the custom middleware runs. Executed `OPTIONS /api/enrollments/:id/complete-lesson` with `Origin` + `Access-Control-Request-Method: PATCH` → `204`, `access-control-allow-methods: GET,HEAD,PUT,PATCH,POST,DELETE`, `access-control-allow-origin: *`. The custom `Access-Control-Allow-Methods: GET, POST` is only written on non-preflight responses, where browsers ignore it. No functional impact; no fix proposed (removing the misleading header would be cosmetic).
2. **Role injection via registration (`// Code-12 bug`)** — **Not exploitable over HTTP.** `validate(registerSchema)` replaces `req.body` with the parsed object and Zod strips `role` (verified). The vulnerable-looking `role` input path was removed anyway as part of the BUG-006 fix.
3. **Public quiz answer key** — `GET /api/courses/:id` returns `quiz[].correctIndex` (verified in the response). It is a real exposure, but the frontend depends on it for client-side grading/review (`CoursePlayer.jsx` lines 706, 746, 762, 782, 866, 887). Removing it requires a frontend change or a separate answer-review endpoint, i.e. an owner/product decision. Not fixed in this phase.
4. **Missing rate limiting, refresh tokens, pagination on admin lists** — not implemented anywhere; treated as unimplemented product scope, not defects.

## Confirmed but deferred (beyond the six-group cap)

| Finding | Files / lines | Severity | Note |
|---|---|---|---|
| Admin assignment list ignores its `courseId` filter | `src/controllers/admin.controller.js:43–50` (calls `getAssignments()` with no argument) and `src/services/admin.service.js:39–48` (filters `courseId`, schema field is `course`) | Medium / P3 | Executed: filter sent as `{"courseId":"ABC123"}`; controller path sends `{}`. UI currently sends no filter, so impact is latent. |
| Validation errors lose field details | `src/middlewares/validate.js:10–13` uses `err.errors`, removed in Zod 4 | Low / P4 | Executed: invalid registration → `400 {"message":"Validation error"}` with no `errors` array. |
| Deleting a course/user leaves orphaned records | `src/services/admin.service.js:19–23`, `src/services/user.service.js:9–14` | Medium / P3 | Enrollments/submissions survive deletion. Cascade vs retain is a product decision. |
| Unescaped `search` regex | `src/services/course.service.js:22–27` | Low / P3 | Caller-controlled `$regex` (ReDoS/expensive queries). No reproduction attempted. |
| Stale privileges in 30-day tokens | `src/utils/generateToken.js:6`, `src/middlewares/authMiddleware.js:15` | Medium / P2 | `role`/ban state are never revalidated, so demotion or banning does not revoke an issued token. Needs a session-invalidation design decision. |
| Documentation/setup mismatch | `README.md:101` (base URL `/api/api`), `.env.example`, `.env` | Low / P4 | README documents backend variables that `.env.example` does not contain; local boot fails as shown above. |

## Reproduction harness

The harness lives outside the repository at `%TEMP%\cm-audit\audit.js`. It sets a throwaway `JWT_SECRET`, injects a no-op `src/config/db.js` into `require.cache`, stubs only Mongoose model statics, and boots the real `app`. Key raw output:

```
[T1] login with correct password (bcrypt hash) -> REJECTED: Invalid email or password
[T2] login with differently-cased email -> REJECTED: Invalid email or password; query filter sent as {"email":"S@Example.COM"}
[T3] register with valid adminKey -> created role="student"
[T3b] role survives validation? -> parsed keys = ["name","email","password"]
[T4] enroll when not yet enrolled -> ERROR THROWN: Already enrolled in this course
[T5] quiz 2/2 correct -> score=2/2, percent=10
[T6] completeLesson when save() rejects -> returned percent=100, unhandledRejection="simulated Mongo write failure"
[T7] admin getAssignments({courseId}) filter -> {"courseId":"ABC123"}
[T8] GET /api/auth/me with invalid JWT -> status=404 {"message":"Cannot read properties of undefined (reading 'id')"}
[T9] GET /api/admin/analytics with invalid JWT -> status=403 {"message":"Admin access only"}
[T10] PATCH complete-lesson with invalid JWT -> status=200 (progress mutated)
[T11] CORS preflight for PATCH -> status=204 allow-methods="GET,HEAD,PUT,PATCH,POST,DELETE"
[T12] GET /api/courses/:id -> status=200 contains "correctIndex":true
[T13] student marks lesson on another student's enrollment -> status=200
[T15] POST /api/auth/register invalid body -> status=400 {"message":"Validation error"}
```

`node server.js` in the current workspace: exits with `MONGODB_URI or MONGO_URI missing in .env`.

### BUG-001 post-fix run (`%TEMP%\cm-audit\verify-bug001.js`)

```
PASS [V1] login with correct password -> token issued, payload={"id":"666…666","role":"student",...}
PASS [V2] login with wrong password -> error="Invalid email or password"
PASS [V3] login with mixed-case/padded email -> query email="s@example.com"
PASS [V4] banned user with correct password -> error="Account is banned"
PASS [V5] banned user with wrong password -> error="Invalid email or password"
PASS [V6] register normalizes email -> stored email="new@example.com"
PASS [V7] duplicate registration with different case -> query email="new@example.com", error="Email already registered"
PASS [V8] HTTP POST /api/auth/login correct credentials -> status=200
PASS [V9] HTTP POST /api/auth/login wrong password -> status=400
PASS [V10] HTTP POST /api/auth/register normalizes email -> status=201

10/10 checks passed
```

After the fix, `audit.js` reports T1 and T2 as `SUCCESS`; every other observation is unchanged.

### BUG-002 post-fix run (`%TEMP%\cm-audit\verify-bug002.js`)

```
PASS [V1] no Authorization header on /me -> status=401
PASS [V2] invalid JWT on /me -> status=401
PASS [V3] invalid JWT on admin route -> status=401
PASS [V4] invalid JWT on complete-lesson -> status=401 serviceRan=false
PASS [V5] valid student token on /me -> status=200
PASS [V6] valid student token on admin route still 403
PASS [V7] expired JWT on /me -> status=401
PASS [V8] JWT signed with wrong secret on /me -> status=401
PASS [V9] valid token still reaches handler (BUG-004 unchanged) -> status=200 serviceRan=true
PASS [V10] malformed 'Bearer' header -> status=401

10/10 checks passed
```

After the fix, `audit.js` reports T8/T9/T10 as `401 Not authorized`; all other observations are unchanged (T13 still `200`, i.e. BUG-004 remains).

### BUG-003 post-fix run (`%TEMP%\cm-audit\verify-bug003.js`)

```
PASS [V1] not-enrolled student enrolls -> created student=…663 course=…662 batchId=…667
PASS [V2] already-enrolled student is rejected -> error="Already enrolled in this course" createCalls=0
PASS [V3] unknown course -> error="Course not found"
PASS [V4] batchId is forwarded -> batchId="…667"
PASS [V5] omitted batchId defaults to null -> batchId=null
PASS [V6] progress initialized -> {"completedLessons":[],"percent":0}
PASS [V7] unique student+course index intact -> [{"student":1,"course":1},{"unique":true}]
PASS [V8] HTTP POST enroll (not enrolled) -> status=201 createCalls=1
PASS [V9] HTTP POST enroll (already enrolled) -> status=400 createCalls=1
PASS [V10] invalid token still rejected -> status=401

10/10 checks passed
```

After the fix, `audit.js` reports T4 as `SUCCESS (enrollment created)`; all other observations are unchanged.

### BUG-004 post-fix run (`%TEMP%\cm-audit\verify-bug004.js`)

```
PASS [V1] owner completes valid lesson -> percent=50 saveCalls=1
PASS [V2] other student cannot update enrollment -> error="Not authorized for this enrollment" saveCalls=0 completed=0
PASS [V3] lesson outside the course is rejected -> error="Lesson not found in this course" saveCalls=0
PASS [V4] duplicate lesson completion -> completed length=1 percent=50
PASS [V5] save failure is surfaced to the caller -> error="simulated Mongo write failure" unhandledRejection=null
PASS [V6] legacy bogus ids do not inflate percent -> percent=100
PASS [V7] missing enrollment -> error="Enrollment not found"
PASS [V8] missing course -> error="Course not found" saveCalls=0
PASS [V9] HTTP owner completes lesson -> status=200 saveCalls=1
PASS [V10] HTTP student cannot touch another enrollment -> status=400 saveCalls=0
PASS [V11] invalid token still rejected -> status=401
PASS [V12] HTTP legacy bogus progress normalised -> status=200 percent=50

12/12 checks passed
```

After the fix, `audit.js` reports T6 as `REJECTED to caller (save awaited)` and T13 as `status=400 Not authorized`; all other observations are unchanged.

### BUG-005 post-fix run (`%TEMP%\cm-audit\verify-bug005.js`)

```
PASS [V1] 2/2 correct -> 100%
PASS [V2] 1/2 correct -> 50%
PASS [V3] 0/2 correct -> 0%
PASS [V4] partial answers -> 50% (unanswered counted wrong)
PASS [V5] persisted percent matches response
PASS [V6] 2/3 correct -> 67% (rounded)
PASS [V7] quiz stats average -> average=75 totalQuizzes=2
PASS [V8] lesson without quiz -> error="No quiz in this lesson"
PASS [V9] un enrolled student -> error="You are not enrolled in this course"
PASS [V10] HTTP quiz submit 2/2 -> status=200 score=2/2 percent=100
PASS [V11] invalid token still rejected -> status=401

11/11 checks passed
```

After the fix, `audit.js` reports T5 as `score=2/2, percent=100`; all other observations are unchanged.

### BUG-006 post-fix run (`%TEMP%\cm-audit\verify-bug006.js`)

```
PASS [V1] registration without adminKey -> student
PASS [V2] registration with valid adminKey -> admin (created role + token role)
PASS [V3] invalid adminKey rejected, no user created
PASS [V4] admin registration disabled when env unset
PASS [V5] role field in service payload ignored
PASS [V6] email normalization preserved
PASS [V7] duplicate email still rejected
PASS [V8] HTTP register with valid adminKey -> status=201 role=admin
PASS [V9] HTTP register with invalid adminKey -> status=400 createCalls=0
PASS [V10] HTTP register without adminKey -> status=201 role=student
PASS [V11] HTTP role injection still stripped -> status=201 role=student
PASS [V12] BUG-001 login regression -> status=200

12/12 checks passed
```

After the fix, `audit.js` reports T3 as `REJECTED: Admin registration is disabled` and T3c as `created role="admin"`; all other observations are unchanged.

## Fix log

| Date | Bug | Changed file(s) | Status |
|------|-----|-----------------|--------|
| 2026-10-21 | BUG-001 | `src/services/auth.service.js` | Fixed & Verified (10/10 targeted checks, `node --check` clean) |
| 2026-10-21 | BUG-002 | `src/middlewares/authMiddleware.js` | Fixed & Verified (10/10 targeted checks + BUG-001 regression, `node --check` clean) |
| 2026-10-21 | BUG-003 | `src/services/enrollment.service.js` | Fixed & Verified (10/10 targeted checks + BUG-001/002 regression, `node --check` clean) |
| 2026-10-21 | BUG-004 | `src/services/enrollment.service.js`, `src/controllers/enrollment.controller.js` | Fixed & Verified (12/12 targeted checks + BUG-001/002/003 regression, `node --check` clean) |
| 2026-10-21 | BUG-005 | `src/services/quiz.service.js` | Fixed & Verified (11/11 targeted checks + BUG-001…004 regression, `node --check` clean) |
| 2026-10-21 | BUG-006 | `src/services/auth.service.js` | Fixed & Verified (12/12 targeted checks + BUG-001…005 regression, `node --check` clean) |

## Final summary

**Groups addressed:** 6 of 6 confirmed groups (BUG-001 … BUG-006), all `Fixed & Verified`.

**Changed application files (5):**
- `src/services/auth.service.js` — login verification, email normalization, ban check (BUG-001); admin-key flow (BUG-006).
- `src/middlewares/authMiddleware.js` — 401 on invalid/expired JWT (BUG-002).
- `src/services/enrollment.service.js` — enrollment creation (BUG-003); progress authorization/validation/await (BUG-004).
- `src/controllers/enrollment.controller.js` — forward `req.user.id` (BUG-004).
- `src/services/quiz.service.js` — quiz percentage (BUG-005).

**Tests/checks that passed:** `node --check` on every changed file; targeted harnesses `verify-bug001.js` 10/10, `verify-bug002.js` 10/10, `verify-bug003.js` 10/10, `verify-bug004.js` 12/12, `verify-bug005.js` 11/11, `verify-bug006.js` 12/12; general `audit.js` re-run shows only the intended changes.

**Checks that could not run:** no `npm test`/lint/type-check/build exists in `package.json`; no MongoDB/Docker available; `node server.js` still exits because `MONGODB_URI`/`JWT_SECRET` are missing from `.env`.

**Remaining unresolved / deferred findings:** admin assignment filter (Medium), orphaned records on delete (Medium), stale 30-day token privileges (Medium), public quiz `correctIndex` (product decision), unescaped search regex (Low), validation-error payload details (Low), documentation/`.env.example` mismatch (Low). Historical quiz submissions and enrollments keep pre-fix values; no data migration was performed.

**Not committed or pushed.** `git status --short` shows only the five changed source files plus this report.






