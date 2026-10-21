// controller for authentication routes

const authService = require("../services/auth.service");
const { attachStatus } = require("../utils/httpError");

const register = async (req, res, next) => {
  try {
    const data = await authService.register(req.body);
    res.status(201).json(data);
  } catch (err) {
    next(attachStatus(err, 400));
  }
};

const login = async (req, res, next) => {
  try {
    const data = await authService.login(req.body);
    res.json(data);
  } catch (err) {
    next(attachStatus(err, 401));
  }
};

const me = async (req, res, next) => {
  try {
    const user = await authService.getMe(req.user.id);
    res.json(user);
  } catch (err) {
    next(attachStatus(err, 404));
  }
};

module.exports = { register, login, me };
