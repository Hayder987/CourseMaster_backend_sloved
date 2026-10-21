const Enrollment = require("../models/Enrollment");
const Course = require("../models/Course");

const enrollCourse = async (studentId, courseId, batchId = null) => {
  const course = await Course.findById(courseId);
  if (!course) throw new Error("Course not found");

  // Check if already enrolled
  let enrollment = await Enrollment.findOne({
    student: studentId,
    course: courseId,
  });

  if (enrollment) {
    throw new Error("Already enrolled in this course");
  }

  // Create new enrollment
  enrollment = await Enrollment.create({
    student: studentId,
    course: courseId,
    batchId,
    progress: { completedLessons: [], percent: 0 },
  });

  return enrollment;
};

const getMyEnrollments = async (studentId) => {
  return Enrollment.find({ student: studentId })
    .populate("course", "title instructorName price category tags")
    .sort({ createdAt: -1 });
};

const completeLesson = async (enrollId, lessonId, studentId) => {
  const enrollment = await Enrollment.findById(enrollId);
  if (!enrollment) throw new Error("Enrollment not found");

  // a student may only update their own enrollment
  if (String(enrollment.student) !== String(studentId)) {
    throw new Error("Not authorized for this enrollment");
  }

  // calculate percent
  const course = await Course.findById(enrollment.course);
  if (!course) throw new Error("Course not found");

  const lessons = course.syllabus.reduce(
    (all, mod) => all.concat(mod.lessons || []),
    []
  );
  const lessonIds = lessons.map((lesson) => String(lesson._id));

  // the lesson must belong to the enrolled course
  if (!lessonIds.includes(String(lessonId))) {
    throw new Error("Lesson not found in this course");
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
