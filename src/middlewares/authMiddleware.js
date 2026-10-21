// middleware to authenticate JWT tokens

const jwt = require("jsonwebtoken");
const User = require("../models/User");

const authMiddleware = async (req, res, next) => {
  const header = req.headers.authorization;
  if (!header) {
    return res.status(401).json({ message: "Not authorized" });
  }

  const token = header.startsWith("Bearer ") ? header.split(" ")[1] : header;

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    // invalid or expired token: reject instead of continuing unauthenticated
    return res.status(401).json({ message: "Not authorized" });
  }

  try {
    // revalidate against the database so bans, role changes and deleted
    // accounts take effect immediately instead of after the token expires
    const user = await User.findById(decoded.id).select("role isBanned");
    if (!user) {
      return res.status(401).json({ message: "Not authorized" });
    }

    if (user.isBanned) {
      return res.status(403).json({ message: "Account is banned" });
    }

    req.user = { id: String(user._id), role: user.role };
    return next();
  } catch (err) {
    return next(err);
  }
};

module.exports = authMiddleware;
