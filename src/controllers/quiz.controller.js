const quizService = require("../services/quiz.service");
const { attachStatus } = require("../utils/httpError");

const submitQuiz = async (req, res, next) => {
  try {
    const result = await quizService.submitQuiz(req.user.id, req.body);
    res.json(result);
  } catch (err) {
    next(attachStatus(err, 400));
  }
};

const myQuizSubmissions = async (req, res, next) => {
  try {
    const { courseId } = req.query;
    const data = await quizService.getMyQuizSubmissions(req.user.id, courseId);
    res.json(data);
  } catch (err) {
    next(attachStatus(err, 400));
  }
};

const getQuizStats = async (req, res, next) => {
  try {
    const { courseId } = req.query;
    if (!courseId) {
      return res.status(400).json({ message: "courseId is required" });
    }
    const data = await quizService.getQuizStats(req.user.id, courseId);
    res.json(data);
  } catch (err) {
    next(attachStatus(err, 400));
  }
};

module.exports = { submitQuiz, myQuizSubmissions, getQuizStats };
