const userService = require("../services/user.service");
const { attachStatus } = require("../utils/httpError");

const getAllUsers = async (req, res, next) => {
  try {
    const users = await userService.getAllUsers(req.query);
    res.json(users);
  } catch (err) {
    next(attachStatus(err, 400));
  }
};

const deleteUser = async (req, res, next) => {
  try {
    const { id } = req.params;
    // Prevent deleting yourself
    if (id === req.user.id) {
      return res.status(400).json({ message: "Cannot delete your own account" });
    }
    const result = await userService.deleteUser(id);
    res.json(result);
  } catch (err) {
    next(attachStatus(err, 400));
  }
};

const updateUserRole = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { role } = req.body;
    // Prevent changing your own role
    if (id === req.user.id) {
      return res.status(400).json({ message: "Cannot change your own role" });
    }
    const user = await userService.updateUserRole(id, role);
    res.json(user);
  } catch (err) {
    next(attachStatus(err, 400));
  }
};

const toggleBanUser = async (req, res, next) => {
  try {
    const { id } = req.params;
    // Prevent banning yourself
    if (id === req.user.id) {
      return res.status(400).json({ message: "Cannot ban your own account" });
    }
    const user = await userService.toggleBanUser(id);
    res.json(user);
  } catch (err) {
    next(attachStatus(err, 400));
  }
};

module.exports = { getAllUsers, deleteUser, updateUserRole, toggleBanUser };
