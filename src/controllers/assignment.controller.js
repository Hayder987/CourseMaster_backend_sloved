const assignmentService = require("../services/assignment.service");
const { attachStatus } = require("../utils/httpError");

const submitAssignment = async (req, res, next) => {
  try {
    const data = await assignmentService.submitAssignment(req.user.id, req.body);
    res.status(201).json(data);
  } catch (err) {
    next(attachStatus(err, 400));
  }
};

const mySubmissions = async (req, res, next) => {
  try {
    const { courseId } = req.query;
    const data = await assignmentService.getMySubmissions(req.user.id, courseId);
    res.json(data);
  } catch (err) {
    next(attachStatus(err, 400));
  }
};

const getAssignmentStats = async (req, res, next) => {
  try {
    const { courseId } = req.query;
    if (!courseId) {
      return res.status(400).json({ message: "courseId is required" });
    }
    const data = await assignmentService.getAssignmentStats(req.user.id, courseId);
    res.json(data);
  } catch (err) {
    next(attachStatus(err, 400));
  }
};

module.exports = { submitAssignment, mySubmissions, getAssignmentStats };
