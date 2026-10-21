const enrollmentService = require("../services/enrollment.service");
const { attachStatus } = require("../utils/httpError");

const enrollCourse = async (req, res, next) => {
  try {
    const enrollment = await enrollmentService.enrollCourse(
      req.user.id,
      req.params.courseId,
      req.body.batchId
    );
    res.status(201).json(enrollment);
  } catch (err) {
    next(attachStatus(err, 400));
  }
};

const myEnrollments = async (req, res, next) => {
  try {
    const data = await enrollmentService.getMyEnrollments(req.user.id);
    res.json(data);
  } catch (err) {
    next(attachStatus(err, 400));
  }
};

const completeLesson = async (req, res, next) => {
  try {
    const data = await enrollmentService.completeLesson(
      req.params.enrollId,
      req.body.lessonId,
      req.user.id
    );
    res.json(data);
  } catch (err) {
    next(attachStatus(err, 400));
  }
};

module.exports = { enrollCourse, myEnrollments, completeLesson };
