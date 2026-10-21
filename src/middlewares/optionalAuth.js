// optional authentication for public routes
//
// A public endpoint may use this middleware to know *who* is calling without
// requiring a token. An absent, invalid or expired token simply means the
// request continues as an anonymous one; protected routes must keep using
// authMiddleware instead.

const jwt = require("jsonwebtoken");
const User = require("../models/User");

const optionalAuth = async (req, res, next) => {
  const header = req.headers.authorization;
  if (!header) return next();

  const token = header.startsWith("Bearer ") ? header.split(" ")[1] : header;

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id).select("role isBanned");
    if (user && !user.isBanned) {
      req.user = { id: String(user._id), role: user.role };
    }
  } catch {
    // ignore: the route stays public
  }

  return next();
};

module.exports = optionalAuth;
