// service to handle admin-related operations

const Course = require("../models/Course");
const Enrollment = require("../models/Enrollment");
const AssignmentSubmission = require("../models/AssignmentSubmission");
const QuizSubmission = require("../models/QuizSubmission");
const User = require("../models/User");
const { httpError } = require("../utils/httpError");

const createCourse = async (payload) => {
  const course = await Course.create(payload);
  return course;
};

const updateCourse = async (id, payload) => {
  const course = await Course.findByIdAndUpdate(id, payload, {
    new: true,
    runValidators: true,
  });
  if (!course) throw httpError(404, "Course not found");
  return course;
};

const deleteCourse = async (id) => {
  const course = await Course.findByIdAndDelete(id);
  if (!course) throw httpError(404, "Course not found");

  // hard cascade: enrollments and submissions that reference a deleted course
  // would otherwise stay in the database and corrupt analytics/progress views
  await Promise.all([
    Enrollment.deleteMany({ course: id }),
    AssignmentSubmission.deleteMany({ course: id }),
    QuizSubmission.deleteMany({ course: id }),
  ]);

  return { message: "Course deleted" };
};

// ✅ NEW: get enrollments (with optional filters)
const getEnrollments = async (query) => {
  const { courseId, batchId, page, limit } = query;

  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(500, Math.max(1, parseInt(limit, 10) || 200));

  const filter = {};
  if (courseId) filter.course = courseId;
  if (batchId) filter.batchId = batchId;

  return Enrollment.find(filter)
    .populate("student", "name email")
    .populate("course", "title instructorName")
    .sort({ createdAt: -1 })
    .skip((pageNum - 1) * limitNum)
    .limit(limitNum);
};

// ✅ NEW: get all assignment submissions (optional course filter)
const getAssignments = async (query = {}) => {
  const filter = {};
  if (query.courseId) filter.course = query.courseId; // schema field is 'course'

  const pageNum = Math.max(1, parseInt(query.page, 10) || 1);
  const limitNum = Math.min(500, Math.max(1, parseInt(query.limit, 10) || 200));

  const submissions = await AssignmentSubmission.find(filter)
    .populate("student", "name email")
    .populate("course", "title syllabus")
    .populate("reviewer", "name")
    .sort({ createdAt: -1 })
    .skip((pageNum - 1) * limitNum)
    .limit(limitNum);

  // Add lesson title to each submission
  const submissionsWithLessonTitle = submissions.map((sub) => {
    const submissionObj = sub.toObject();
    let lessonTitle = "Unknown Lesson";

    if (sub.course && sub.course.syllabus) {
      for (const module of sub.course.syllabus) {
        for (const lesson of module.lessons || []) {
          if (String(lesson._id) === String(sub.lessonId)) {
            lessonTitle = lesson.title;
            submissionObj.assignmentPrompt = lesson.assignmentPrompt || "";
            break;
          }
        }
        if (lessonTitle !== "Unknown Lesson") break;
      }
    }

    submissionObj.lessonTitle = lessonTitle;
    return submissionObj;
  });

  return submissionsWithLessonTitle;
};

// review/update an assignment submission (admin)
const REVIEW_STATUSES = ["submitted", "reviewed"];

const reviewAssignment = async (id, payload, adminId) => {
  const { reviewNotes, grade, status } = payload;

  if (typeof status !== "undefined" && !REVIEW_STATUSES.includes(status)) {
    throw new Error("Invalid review status");
  }
  if (
    typeof grade !== "undefined" &&
    (typeof grade !== "number" || !Number.isFinite(grade) || grade < 0 || grade > 100)
  ) {
    throw new Error("Grade must be a number between 0 and 100");
  }
  if (typeof reviewNotes !== "undefined" && typeof reviewNotes !== "string") {
    throw new Error("reviewNotes must be a string");
  }

  const update = {};
  if (typeof status !== "undefined") update.status = status;
  if (typeof reviewNotes !== "undefined") update.reviewNotes = reviewNotes;
  if (typeof grade !== "undefined") update.grade = grade;
  if (adminId) update.reviewer = adminId;

  const submission = await AssignmentSubmission.findByIdAndUpdate(id, update, {
    new: true,
    runValidators: true,
  })
    .populate("student", "name email")
    .populate("course", "title")
    .populate("reviewer", "name");

  if (!submission) throw httpError(404, "Submission not found");

  return submission;
};

// Get analytics data for dashboard
const getAnalytics = async () => {
  // Use UTC day boundaries for the query, the grouping key and the chart label
  // so a local-time midnight can never move an enrollment into another bucket.
  const now = new Date();
  const todayUtc = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate()
  ));
  const startUtc = new Date(todayUtc);
  startUtc.setUTCDate(startUtc.getUTCDate() - 29); // 30 calendar days including today
  const endUtc = new Date(todayUtc);
  endUtc.setUTCDate(endUtc.getUTCDate() + 1);

  const enrollments = await Enrollment.find({
    createdAt: { $gte: startUtc, $lt: endUtc }
  }).sort({ createdAt: 1 });

  // Group by date
  const enrollmentData = {};
  enrollments.forEach(enrollment => {
    const date = enrollment.createdAt.toISOString().split('T')[0];
    enrollmentData[date] = (enrollmentData[date] || 0) + 1;
  });

  // Convert to array format for chart (exactly 30 UTC days)
  const chartData = [];
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  for (let i = 29; i >= 0; i--) {
    const date = new Date(todayUtc);
    date.setUTCDate(date.getUTCDate() - i);
    const dateStr = date.toISOString().split('T')[0];

    // Format date for display (e.g., "Jan 15"), using the same UTC date
    const displayDate = `${monthNames[date.getUTCMonth()]} ${date.getUTCDate()}`;

    chartData.push({
      date: dateStr,
      displayDate: displayDate,
      enrollments: enrollmentData[dateStr] || 0
    });
  }

  // Get total stats
  const totalEnrollments = await Enrollment.countDocuments();
  const totalCourses = await Course.countDocuments();
  const totalStudents = await User.countDocuments({ role: "student" });
  const totalInstructors = await User.countDocuments({ role: "admin" }); // Assuming admins are instructors

  // Get enrollments by course (top 5)
  const enrollmentsByCourse = await Enrollment.aggregate([
    {
      $group: {
        _id: "$course",
        count: { $sum: 1 }
      }
    },
    {
      $sort: { count: -1 }
    },
    {
      $limit: 5
    },
    {
      $lookup: {
        from: "courses",
        localField: "_id",
        foreignField: "_id",
        as: "courseInfo"
      }
    },
    {
      $unwind: "$courseInfo"
    },
    {
      $project: {
        courseName: "$courseInfo.title",
        enrollments: "$count"
      }
    }
  ]);

  return {
    chartData,
    enrollmentsByCourse,
    stats: {
      totalEnrollments,
      totalCourses,
      totalStudents,
      totalInstructors,
      enrollmentsLast30Days: enrollments.length
    }
  };
};

module.exports = {
  createCourse,
  updateCourse,
  deleteCourse,
  getEnrollments,
  getAssignments,
  reviewAssignment,
  getAnalytics,
};
