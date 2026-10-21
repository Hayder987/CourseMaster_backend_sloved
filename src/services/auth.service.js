// authentication service

const crypto = require("crypto");
const bcrypt = require("bcrypt");
const User = require("../models/User");
const generateToken = require("../utils/generateToken");
const { httpError } = require("../utils/httpError");
const { sendWelcomeEmail } = require("./email.service");

// emails are stored lowercased by the User schema, so lookups must be normalized too
const normalizeEmail = (email) => email.trim().toLowerCase();

// constant-time comparison for the shared admin registration key
const matchesAdminKey = (providedKey, configuredKey) => {
  const hash = (value) => crypto.createHash("sha256").update(String(value)).digest();
  return crypto.timingSafeEqual(hash(providedKey), hash(configuredKey));
};

// only a valid ADMIN_REGISTRATION_KEY may create an admin account
const resolveRegistrationRole = (adminKey) => {
  if (!adminKey) return "student";

  const configuredKey = process.env.ADMIN_REGISTRATION_KEY;
  if (!configuredKey) throw httpError(403, "Admin registration is disabled");
  if (!matchesAdminKey(adminKey, configuredKey)) throw httpError(400, "Invalid admin key");

  return "admin";
};

const register = async ({ name, email, password, adminKey }) => {
  const normalizedEmail = normalizeEmail(email);
  const exists = await User.findOne({ email: normalizedEmail });
  if (exists) throw httpError(409, "Email already registered");

  const role = resolveRegistrationRole(adminKey);
  const passwordHash = await bcrypt.hash(password, 10);

  let user;
  try {
    user = await User.create({
      name,
      email: normalizedEmail,
      passwordHash,
      role,
    });
  } catch (err) {
    // the unique index is the real guard: two simultaneous registrations
    // can both pass the findOne check above
    if (err && err.code === 11000) throw httpError(409, "Email already registered");
    throw err;
  }

  const token = generateToken({ id: user._id, role: user.role });

  // Send welcome email (non-blocking - don't wait for it)
  sendWelcomeEmail(user.email, user.name).catch(err => {
    console.error('Email sending failed (non-critical):', err.message);
  });

  return {
    token,
    user: { id: user._id, name: user.name, email: user.email, role: user.role },
  };
};

const login = async ({ email, password }) => {
  const user = await User.findOne({ email: normalizeEmail(email) });
  if (!user) throw httpError(401, "Invalid email or password");

  const match = await bcrypt.compare(password, user.passwordHash);
  if (!match) throw httpError(401, "Invalid email or password");

  if (user.isBanned) throw httpError(403, "Account is banned");

  const token = generateToken({ id: user._id, role: user.role });

  return {
    token,
    user: { id: user._id, name: user.name, email: user.email, role: user.role },
  };
};

const getMe = async (userId) => {
  const user = await User.findById(userId).select("-passwordHash");
  if (!user) throw httpError(404, "User not found");
  return user;
};

module.exports = { register, login, getMe };
