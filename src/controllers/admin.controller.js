// controller for admin-related operations

const adminService = require("../services/admin.service");
const { attachStatus } = require("../utils/httpError");

const createCourse = async (req, res, next) => {
  try {
    const course = await adminService.createCourse(req.body);
    res.status(201).json(course);
  } catch (err) {
    next(attachStatus(err, 400));
  }
};

const updateCourse = async (req, res, next) => {
  try {
    const course = await adminService.updateCourse(req.params.id, req.body);
    res.json(course);
  } catch (err) {
    next(attachStatus(err, 404));
  }
};

const deleteCourse = async (req, res, next) => {
  try {
    const data = await adminService.deleteCourse(req.params.id);
    res.json(data);
  } catch (err) {
    next(attachStatus(err, 404));
  }
};

// ✅ NEW: enrollments list
const getEnrollments = async (req, res, next) => {
  try {
    const data = await adminService.getEnrollments(req.query);
    res.json(data);
  } catch (err) {
    next(attachStatus(err, 400));
  }
};

// ✅ NEW: assignments list
const getAssignments = async (req, res, next) => {
  try {
    const data = await adminService.getAssignments(req.query);
    res.json(data);
  } catch (err) {
    next(attachStatus(err, 400));
  }
};

// review an assignment submission
const reviewAssignment = async (req, res, next) => {
  try {
    const id = req.params.id;
    const data = await adminService.reviewAssignment(id, req.body, req.user.id);
    res.json(data);
  } catch (err) {
    next(attachStatus(err, 400));
  }
};

// get analytics data
const getAnalytics = async (req, res, next) => {
  try {
    const data = await adminService.getAnalytics();
    res.json(data);
  } catch (err) {
    next(attachStatus(err, 400));
  }
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
