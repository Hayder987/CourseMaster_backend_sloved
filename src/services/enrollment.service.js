const Enrollment = require("../models/Enrollment");
const Course = require("../models/Course");
const { httpError } = require("../utils/httpError");

const enrollCourse = async (studentId, courseId, batchId = null) => {
  const course = await Course.findById(courseId);
  if (!course) throw httpError(404, "Course not found");

  // a batchId must reference one of this course's batches
  if (batchId) {
    const batchExists = (course.batches || []).some(
      (batch) => String(batch._id) === String(batchId)
    );
    if (!batchExists) throw httpError(400, "Batch not found for this course");
  }

  // Check if already enrolled
  let enrollment = await Enrollment.findOne({
    student: studentId,
    course: courseId,
  });

  if (enrollment) {
    throw httpError(409, "Already enrolled in this course");
  }

  // Create new enrollment
  try {
    enrollment = await Enrollment.create({
      student: studentId,
      course: courseId,
      batchId,
      progress: { completedLessons: [], percent: 0 },
    });
  } catch (err) {
    // two simultaneous requests can both pass the findOne check above; the
    // unique index is the real guard, so translate its error instead of
    // returning a raw duplicate-key message
    if (err && err.code === 11000) {
      throw httpError(409, "Already enrolled in this course");
    }
    throw err;
  }

  return enrollment;
};

const getMyEnrollments = async (studentId) => {
  return Enrollment.find({ student: studentId })
    .populate("course", "title instructorName price category tags")
    .sort({ createdAt: -1 });
};

const completeLesson = async (enrollId, lessonId, studentId) => {
  const enrollment = await Enrollment.findById(enrollId);
  if (!enrollment) throw httpError(404, "Enrollment not found");

  // a student may only update their own enrollment
  if (String(enrollment.student) !== String(studentId)) {
    throw httpError(403, "Not authorized for this enrollment");
  }

  // calculate percent
  const course = await Course.findById(enrollment.course);
  if (!course) throw httpError(404, "Course not found");

  const lessons = course.syllabus.reduce(
    (all, mod) => all.concat(mod.lessons || []),
    []
  );
  const lessonIds = lessons.map((lesson) => String(lesson._id));

  // the lesson must belong to the enrolled course
  if (!lessonIds.includes(String(lessonId))) {
    throw httpError(400, "Lesson not found in this course");
  }

  // avoid duplicates
  const alreadyDone = enrollment.progress.completedLessons
    .map(String)
    .includes(String(lessonId));

  if (!alreadyDone) {
    enrollment.progress.completedLessons.push(lessonId);
  }

  const totalLessons = lessons.length;
  // count only lessons that actually belong to this course
  const completed = enrollment.progress.completedLessons.filter((id) =>
    lessonIds.includes(String(id))
  ).length;
  enrollment.progress.percent =
    totalLessons === 0 ? 0 : Math.round((completed / totalLessons) * 100);

  await enrollment.save();
  return enrollment;
};

module.exports = { enrollCourse, getMyEnrollments, completeLesson };
