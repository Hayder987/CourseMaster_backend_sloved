# CourseMaster - Backend API

A RESTful API for the CourseMaster E-learning platform built with Node.js, Express, and MongoDB.

**Video Link:** [Watch Project Video](https://drive.google.com/file/d/1vjMrBxr0-7xqjxMX2EBEBw30D_av1pOu/view)

---

## 🚀 IMPORTANT: Admin Account Setup — `npm run seed`

> **⚠️ Run the seed command to create the initial administrator account.**
>
> The admin account is created using `ADMIN_EMAIL` and `ADMIN_PASSWORD` from your `.env` file. The seed script does not use old demo credentials or a default password.

### Step 1: Configure Admin Credentials

Add the following variables to your `.env` file:

```env
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=ReplaceWithYourStrongPassword123!
```

**Requirements:**
- `ADMIN_EMAIL` must be a valid email address.
- `ADMIN_PASSWORD` must contain at least 12 characters.
- Do not use known demo or default passwords.
- Never commit your `.env` file or expose your real credentials publicly.

### Step 2: Run the Seed Command

Execute the following commands from the backend project directory:

```bash
npm install
npm run seed
```

**Expected result:** The seed script should connect to MongoDB and create the administrator account using the configured credentials. Check the terminal output to confirm successful completion.

**Important:** If MongoDB is unavailable, the environment variables are missing, or the configured credentials are invalid, resolve the reported error before continuing. The seed script must not silently fall back to default credentials.

### Step 3: Start the Backend Server

```bash
npm run dev
```

For production:

```bash
npm start
```

After seeding, use the configured admin email and password to log in through the application's login endpoint.

---

## Project Name & Description

**CourseMaster Backend** provides a comprehensive RESTful API for managing an e-learning platform. It handles authentication, course management, enrollments, assignments, quizzes, and administrative operations.

The backend is built with Node.js and Express.js, uses MongoDB for data storage, and uses JWT for authentication.

## Technology Stack

- **Node.js** — Runtime environment
- **Express.js 5** — Web framework
- **MongoDB** — Database
- **Mongoose** — Object Data Modeling (ODM)
- **JWT** — Authentication
- **bcrypt** — Password hashing
- **Zod** — Input validation

## Installation

1. Clone the repository.
2. Navigate to the backend directory:

   ```bash
   cd courseMaster_Backend
   ```

3. Install dependencies:

   ```bash
   npm install
   ```

4. Create a `.env` file in the project root using `.env.example` as a reference.
5. Configure the required environment variables.
6. Create the initial admin account by following the **Admin Account Setup** section above.
7. Start the development server:

   ```bash
   npm run dev
   ```

8. Start the production server when needed:

   ```bash
   npm start
   ```

## Environment Variables

Create a `.env` file in the root directory with the following configuration:

```env
# Server Configuration
PORT=5000

# Database
MONGODB_URI=mongodb://localhost:27017/coursemaster

# JWT Secret
JWT_SECRET=replace-with-a-strong-random-secret

# Admin Registration Key (Optional)
ADMIN_REGISTRATION_KEY=replace-with-a-secure-admin-key

# Seed-only admin account (Required for npm run seed)
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=ReplaceWithYourStrongPassword123!

# Node Environment
NODE_ENV=development

# Email Configuration (Optional)
EMAIL_SERVICE=gmail
EMAIL_USER=your-email@gmail.com
EMAIL_PASSWORD=your-gmail-app-password

# Frontend URL
FRONTEND_URL=http://localhost:5173
```

### Required Variables

- `MONGODB_URI` — MongoDB connection string.
- `JWT_SECRET` — Secret key used to sign JWT tokens.

`PORT` is optional if the application defaults to port `5000`.

### Required Only for `npm run seed`

- `ADMIN_EMAIL` — Email address for the initial administrator account.
- `ADMIN_PASSWORD` — Strong password of at least 12 characters that is not a known demo/default password.

The seed script must fail safely when the required configuration is missing or invalid. It must never use a published default admin password.

### Optional Variables

- `NODE_ENV` — Application environment (`development` or `production`).
- `ADMIN_REGISTRATION_KEY` — Secret key for admin registration, if supported by the application.
- `EMAIL_SERVICE` — Email service provider.
- `EMAIL_USER` — Email address used to send messages.
- `EMAIL_PASSWORD` — Email account password or app password.
- `FRONTEND_URL` — Frontend URL used for email links.

### Email Setup

For Gmail:

1. Enable two-factor authentication.
2. Generate a Google App Password.
3. Configure `EMAIL_USER` and `EMAIL_PASSWORD` in `.env`.

Email configuration is optional. If the application implements non-blocking email delivery, registration should still succeed when an email cannot be sent.

## API Documentation

**Local Base URL:** `http://localhost:5000`

### Authentication Endpoints

#### Register

- **Method:** `POST`
- **Endpoint:** `/api/auth/register`

**Request Body:**

```json
{
  "name": "John Doe",
  "email": "john@example.com",
  "password": "password123"
}
```

Optional admin registration key:

```json
{
  "name": "Admin User",
  "email": "admin@example.com",
  "password": "StrongPassword123!",
  "adminKey": "your-configured-admin-registration-key"
}
```

**Response:** User information and authentication token, according to the implemented API contract.

**Notes:**
- Normal registrations should create student accounts by default.
- Admin registration must follow the backend's configured security policy.
- If `ADMIN_REGISTRATION_KEY` is enabled, the supplied key must match the configured value.
- Never allow users to assign themselves the admin role merely by submitting `"role": "admin"`.

#### Login

- **Method:** `POST`
- **Endpoint:** `/api/auth/login`

**Request Body:**

```json
{
  "email": "john@example.com",
  "password": "password123"
}
```

**Response:** User information and authentication token.

#### Get Current User

- **Method:** `GET`
- **Endpoint:** `/api/auth/me`
- **Authentication:** Bearer token required.

```http
Authorization: Bearer <token>
```

**Response:** Authenticated user's information.

### Course Endpoints — Public

#### Get All Courses

- **Method:** `GET`
- **Endpoint:** `/api/courses`

**Query Parameters:**

| Parameter | Description |
|---|---|
| `page` | Page number; default: 1 |
| `limit` | Items per page; default: 8 |
| `search` | Search by title or instructor |
| `sort` | Sort by price: `price_asc` or `price_desc` |
| `category` | Filter by category |
| `tags` | Filter by comma-separated tags |

**Response:** Paginated course list.

#### Get Course by ID

- **Method:** `GET`
- **Endpoint:** `/api/courses/:id`

**Response:** Course details.

### Enrollment Endpoints — Student Only

All endpoints require a valid student authentication token.

#### Enroll in Course

- **Method:** `POST`
- **Endpoint:** `/api/enrollments/:courseId`

**Request Body (optional):**

```json
{
  "batchId": "batch-id-here"
}
```

**Response:** Created enrollment object.

Expected behavior:
- A student who is not enrolled can enroll successfully.
- Duplicate enrollment attempts should return an appropriate client error.
- An unknown course should return `404 Not Found`.

#### Get My Enrollments

- **Method:** `GET`
- **Endpoint:** `/api/enrollments/my`

**Response:** Enrollments belonging to the authenticated student.

#### Mark Lesson as Complete

- **Method:** `PATCH`
- **Endpoint:** `/api/enrollments/:enrollId/complete-lesson`

**Request Body:**

```json
{
  "lessonId": "lesson-id-here"
}
```

**Response:** Updated enrollment and learning progress.

### Assignment Endpoints — Student Only

#### Submit Assignment

- **Method:** `POST`
- **Endpoint:** `/api/assignments/submit`

**Request Body:**

```json
{
  "courseId": "course-id",
  "lessonId": "lesson-id",
  "answer": "Answer text or Google Drive link",
  "answerType": "text"
}
```

`answerType` may be `text` or `link`, subject to the implemented validation rules.

**Response:** Assignment submission object.

#### Get My Submissions

- **Method:** `GET`
- **Endpoint:** `/api/assignments/my`

**Response:** Assignment submissions belonging to the authenticated student.

### Quiz Endpoints — Student Only

#### Submit Quiz

- **Method:** `POST`
- **Endpoint:** `/api/quizzes/submit`

**Request Body:**

```json
{
  "courseId": "course-id",
  "lessonId": "lesson-id",
  "answers": [0, 1, 2, 0]
}
```

The `answers` array contains selected option indices.

**Example Response:**

```json
{
  "total": 4,
  "score": 3,
  "percent": 75
}
```

The actual response fields depend on the backend implementation.

### Admin Endpoints — Admin Only

All endpoints require a valid administrator token. Student accounts must be denied access.

#### Create Course

- **Method:** `POST`
- **Endpoint:** `/api/admin/courses`

**Request Body:** Course data following the Course Schema.

**Response:** Created course object.

#### Update Course

- **Method:** `PATCH`
- **Endpoint:** `/api/admin/courses/:id`

**Request Body:** Course fields to update.

**Response:** Updated course object.

#### Delete Course

- **Method:** `DELETE`
- **Endpoint:** `/api/admin/courses/:id`

**Response:** Success message.

#### Get All Enrollments

- **Method:** `GET`
- **Endpoint:** `/api/admin/enrollments`

**Query Parameters:**

- `courseId` — Filter enrollments by course.
- `batchId` — Filter enrollments by batch.

**Response:** Enrollment records.

#### Get All Assignments

- **Method:** `GET`
- **Endpoint:** `/api/admin/assignments`

**Response:** Assignment submissions across the platform.

#### Get Analytics

- **Method:** `GET`
- **Endpoint:** `/api/admin/analytics`

**Response:** Analytics data, potentially including:

- Enrollment trends over the last 30 days.
- Top courses by enrollment count.
- Total enrollments.
- Total courses.
- Total students.
- Total instructors.

#### Review Assignment

- **Method:** `PATCH`
- **Endpoint:** `/api/admin/assignments/:id/review`

**Request Body:**

```json
{
  "status": "reviewed",
  "reviewNotes": "Great work!",
  "grade": 95
}
```

**Response:** Updated assignment submission.

## Data Models

### Course Schema

```javascript
{
  title: String,          // Required, indexed
  description: String,    // Required
  instructorName: String, // Required, indexed
  price: Number,          // Required
  category: String,       // Indexed
  tags: [String],         // Indexed
  syllabus: [
    {
      title: String,
      lessons: [
        {
          title: String,
          videoUrl: String,
          assignmentPrompt: String,
          quiz: [
            {
              question: String,
              options: [String],
              correctIndex: Number
            }
          ]
        }
      ]
    }
  ],
  batches: [
    {
      name: String,
      startDate: Date
    }
  ]
}
```

### User Schema

```javascript
{
  name: String,
  email: String,        // Required, unique
  passwordHash: String, // Required; hashed password
  role: {
    type: String,
    enum: ["student", "admin"],
    default: "student"
  }
}
```

### Enrollment Schema

```javascript
{
  student: ObjectId, // Reference to User
  course: ObjectId,  // Reference to Course
  batchId: ObjectId,
  progress: {
    completedLessons: [ObjectId],
    percent: Number
  }
}
```

The exact field types, defaults, and validation rules should match the actual Mongoose models.

## Error Handling

Errors follow this response format:

```json
{
  "message": "Error message here"
}
```

### Common HTTP Status Codes

| Status | Meaning |
|---|---|
| `200` | Request successful |
| `201` | Resource created successfully |
| `400` | Invalid request or business rule violation |
| `401` | Authentication required or invalid credentials |
| `403` | Authenticated but not authorized |
| `404` | Resource not found |
| `500` | Internal server error |

## Bonus Features

### Email Notifications

- Welcome emails for newly registered users, when email delivery is configured.
- Uses Nodemailer for email delivery.
- Configured through environment variables.
- Email failures should not interrupt registration if sending is implemented as a non-blocking operation.

### Analytics Dashboard

- Enrollment trend charts.
- Top courses by enrollment.
- Platform-wide statistics.
- Admin-only analytics access.

**Dashboard route:** `/admin/analytics` in the frontend, if implemented.

## Admin Registration

Administrators may be created through the following supported approaches.

### 1. Seed Script Method

Recommended for initial administrator setup in development or controlled deployment workflows.

```bash
npm run seed
```

Before running the command, configure:

```env
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=ReplaceWithYourStrongPassword123!
MONGODB_URI=mongodb://localhost:27017/coursemaster
```

The seed script should validate the credentials, connect to MongoDB, and create the administrator account securely. It should not print passwords or use default credentials.

### 2. Registration Key Method

If supported by the backend:

1. Configure `ADMIN_REGISTRATION_KEY`.
2. Submit the configured key through the supported registration flow.
3. Validate the key on the server.
4. Assign the admin role only after successful validation.

If the registration key is not configured, key-based admin registration should remain disabled.

### 3. Manual Database Method

An authorized operator may create an administrator directly in MongoDB, ensuring the password is hashed correctly and the role is set to `admin`.

Never store plaintext passwords in the database.

## Security Features

- Password hashing with bcrypt.
- JWT-based authentication.
- Protected routes.
- Admin-only authorization.
- Admin registration key protection, if enabled.
- Request validation with Zod.
- CORS configuration.
- Environment-based secrets.
- Protection against unauthorized role escalation.

## Database Indexing

The intended indexes include:

- Course `title`.
- Course `instructorName`.
- Course `category`.
- Course `tags`.
- Enrollment compound index `{ student: 1, course: 1 }` with uniqueness enabled.

The actual indexes should be verified against the Mongoose model definitions.

## Deployment

The backend is deployed on Vercel.

Configure the required environment variables in the deployment platform:

- `MONGODB_URI`
- `JWT_SECRET`
- `ADMIN_EMAIL` and `ADMIN_PASSWORD` for the seed process, when required.

Ensure that MongoDB Atlas permits connections from the deployment environment. Avoid exposing database credentials or JWT secrets in public repositories.

If the seed script is run in a separate environment, ensure that it targets the intended production database and does not unintentionally create or modify accounts in the wrong environment.

## Development

- Default development URL: `http://localhost:5000`
- Development server uses Nodemon for automatic restarts.
- MongoDB connections are managed through Mongoose.
- Environment variables are loaded from `.env`, when configured.

### Useful Commands

| Command | Purpose |
|---|---|
| `npm install` | Install project dependencies |
| `npm run seed` | Create the initial administrator account |
| `npm run dev` | Start the development server |
| `npm start` | Start the production server |

**Final Reminder:** Configure the environment variables, ensure MongoDB is reachable, run `npm run seed`, and verify that the administrator account was created before testing admin-only endpoints.
