const User = require("../models/User");
const Enrollment = require("../models/Enrollment");
const AssignmentSubmission = require("../models/AssignmentSubmission");
const QuizSubmission = require("../models/QuizSubmission");
const { httpError } = require("../utils/httpError");

const getAllUsers = async (query = {}) => {
  const limitNum = Math.min(500, Math.max(1, parseInt(query.limit, 10) || 200));

  return User.find()
    .select("-passwordHash")
    .sort({ createdAt: -1 })
    .limit(limitNum);
};

const deleteUser = async (userId) => {
  const user = await User.findById(userId);
  if (!user) throw httpError(404, "User not found");
  await User.findByIdAndDelete(userId);

  // hard cascade: a deleted student must not leave enrollments/submissions
  // behind, because those rows keep counting in admin analytics
  await Promise.all([
    Enrollment.deleteMany({ student: userId }),
    AssignmentSubmission.deleteMany({ student: userId }),
    QuizSubmission.deleteMany({ student: userId }),
  ]);

  return { message: "User deleted successfully" };
};

const updateUserRole = async (userId, role) => {
  if (!["student", "admin"].includes(role)) {
    throw httpError(400, "Invalid role");
  }
  const user = await User.findByIdAndUpdate(
    userId,
    { role },
    { new: true }
  ).select("-passwordHash");
  if (!user) throw httpError(404, "User not found");
  return user;
};

const toggleBanUser = async (userId) => {
  const user = await User.findById(userId);
  if (!user) throw httpError(404, "User not found");
  user.isBanned = !user.isBanned;
  await user.save();
  return User.findById(userId).select("-passwordHash");
};

module.exports = { getAllUsers, deleteUser, updateUserRole, toggleBanUser };
