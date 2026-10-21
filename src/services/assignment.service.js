const AssignmentSubmission = require("../models/AssignmentSubmission");
const Enrollment = require("../models/Enrollment");
const Course = require("../models/Course");
const { httpError } = require("../utils/httpError");

const submitAssignment = async (studentId, payload) => {
  const { courseId, lessonId, answerType, answer } = payload;

  // ensure student enrolled
  const enrolled = await Enrollment.findOne({ student: studentId, course: courseId });
  if (!enrolled) throw httpError(403, "You are not enrolled in this course");

  // the lesson must belong to the enrolled course
  const course = await Course.findById(courseId);
  if (!course) throw httpError(404, "Course not found");

  const lessonExists = (course.syllabus || []).some((mod) =>
    (mod.lessons || []).some((lesson) => String(lesson._id) === String(lessonId))
  );
  if (!lessonExists) throw httpError(400, "Lesson not found in this course");

  const submission = await AssignmentSubmission.create({
    student: studentId,
    course: courseId,
    lessonId,
    answerType,
    answer,
  });

  return submission;
};

const getMySubmissions = async (studentId, courseId = null) => {
  const filter = { student: studentId };
  if (courseId) filter.course = courseId;

  return AssignmentSubmission.find(filter)
    .populate("course", "title")
    .populate("reviewer", "name")
    .sort({ createdAt: -1 });
};

// Get assignment statistics for a course
const getAssignmentStats = async (studentId, courseId) => {
  const submissions = await AssignmentSubmission.find({
    student: studentId,
    course: courseId,
  })
    .populate("reviewer", "name")
    .sort({ createdAt: -1 });

  if (submissions.length === 0) {
    return {
      average: 0,
      totalAssignments: 0,
      reviewedCount: 0,
      submissions: [],
    };
  }

  // Calculate average from graded assignments only
  const gradedSubmissions = submissions.filter((s) => s.grade !== null && s.grade !== undefined);
  const average = gradedSubmissions.length > 0
    ? Math.round(gradedSubmissions.reduce((sum, s) => sum + s.grade, 0) / gradedSubmissions.length)
    : 0;

  return {
    average,
    totalAssignments: submissions.length,
    reviewedCount: submissions.filter((s) => s.status === "reviewed").length,
    submissions: submissions.map((s) => ({
      _id: s._id,
      lessonId: s.lessonId,
      answer: s.answer,
      answerType: s.answerType,
      status: s.status,
      grade: s.grade,
      reviewNotes: s.reviewNotes,
      reviewer: s.reviewer,
      submittedAt: s.createdAt,
      reviewedAt: s.updatedAt,
    })),
  };
};

module.exports = { submitAssignment, getMySubmissions, getAssignmentStats };
