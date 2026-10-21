// service to handle course-related operations

const Course = require("../models/Course");
const Enrollment = require("../models/Enrollment");
const { httpError } = require("../utils/httpError");

// The course player renders the quiz review from `correctIndex`, so enrolled
// students (and admins) still receive it. Anonymous visitors must never see
// the answer key.
const hideAnswerKey = (course) => {
  const plain = typeof course.toObject === "function" ? course.toObject() : course;
  (plain.syllabus || []).forEach((module) => {
    (module.lessons || []).forEach((lesson) => {
      (lesson.quiz || []).forEach((question) => {
        delete question.correctIndex;
      });
    });
  });
  return plain;
};

const canSeeAnswerKey = async (user, courseId) => {
  if (!user) return false;
  if (user.role === "admin") return true;
  const enrollment = await Enrollment.exists({ student: user.id, course: courseId });
  return Boolean(enrollment);
};

const getCourses = async (query) => {
  const {
    page = 1,
    limit = 8,
    search = "",
    sort = "",
    category,
    tags,
  } = query;

  // Validate and sanitize pagination parameters
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 8)); // Max 100 items per page

  const filter = {};

  if (search && typeof search === "string") {
    // treat search input literally so regex metacharacters cannot alter the query
    const escapedSearch = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    filter.$or = [
      { title: { $regex: escapedSearch, $options: "i" } },
      { instructorName: { $regex: escapedSearch, $options: "i" } },
    ];
  }

  if (category && typeof category === "string") {
    filter.category = category;
  }

  if (tags && typeof tags === "string") {
    const tagArray = tags.split(",").map(t => t.trim()).filter(t => t); // "mern,react"
    if (tagArray.length > 0) {
      filter.tags = { $in: tagArray };
    }
  }

  let sortObj = {};
  if (sort === "price_asc") sortObj.price = 1;
  if (sort === "price_desc") sortObj.price = -1;

  const skip = (pageNum - 1) * limitNum;

  const [courses, total] = await Promise.all([
    Course.find(filter)
      .sort(sortObj)
      .skip(skip)
      .limit(limitNum),
    Course.countDocuments(filter),
  ]);

  return {
    // list responses never need the answer key
    courses: courses.map(hideAnswerKey),
    total,
    page: pageNum,
    totalPages: Math.ceil(total / limitNum),
  };
};

const getCourseById = async (id, user = null) => {
  const course = await Course.findById(id);
  if (!course) throw httpError(404, "Course not found");

  if (await canSeeAnswerKey(user, course._id)) return course;
  return hideAnswerKey(course);
};

module.exports = { getCourses, getCourseById };
