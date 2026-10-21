// route definitions for course-related endpoints

const router = require("express").Router();
const courseController = require("../controllers/course.controller");
const optionalAuth = require("../middlewares/optionalAuth");

router.get("/", courseController.getCourses);
router.get("/:id", optionalAuth, courseController.getCourseById);

module.exports = router;
