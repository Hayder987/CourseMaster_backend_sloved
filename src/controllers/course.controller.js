// controller for course-related routes

const courseService = require("../services/course.service");
const connectDB = require("../config/db");
const { attachStatus } = require("../utils/httpError");


const getCourses = async (req, res, next) => {
  try {
    // Ensure DB connection before processing request (for serverless)
    await connectDB();
    const data = await courseService.getCourses(req.query);
    res.json(data);
  } catch (err) {
    next(attachStatus(err, 400));
  }
};

const getCourseById = async (req, res, next) => {
  try {
    const course = await courseService.getCourseById(req.params.id, req.user);
    res.json(course);
  } catch (err) {
    next(attachStatus(err, 404));
  }
};

module.exports = { getCourses, getCourseById };
