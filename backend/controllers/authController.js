const bcrypt = require('bcryptjs');
const { User, UserStats } = require('../models');
const { signToken } = require('../utils/jwt');

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    avatar: user.avatar,
    createdAt: user.createdAt,
  };
}

// POST /api/auth/register
async function register(req, res) {
  try {
    const { name, email, password, role } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ message: 'Vui lòng nhập đầy đủ họ tên, email và mật khẩu.' });
    }
    if (password.length < 6) {
      return res.status(400).json({ message: 'Mật khẩu cần tối thiểu 6 ký tự.' });
    }
    if (!['teacher', 'student'].includes(role)) {
      return res.status(400).json({ message: 'Vai trò không hợp lệ (chỉ nhận teacher hoặc student).' });
    }

    const existing = await User.findOne({ where: { email } });
    if (existing) {
      return res.status(409).json({ message: 'Email này đã được đăng ký.' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await User.create({ name, email, passwordHash, role });
    await UserStats.create({ userId: user.id });

    const token = signToken(user);
    res.status(201).json({ token, user: publicUser(user) });
  } catch (err) {
    console.error('register error:', err);
    res.status(500).json({ message: 'Lỗi máy chủ khi đăng ký.' });
  }
}

// POST /api/auth/login
async function login(req, res) {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ message: 'Vui lòng nhập email và mật khẩu.' });
    }

    const user = await User.findOne({ where: { email } });
    if (!user) {
      return res.status(401).json({ message: 'Email hoặc mật khẩu không đúng.' });
    }
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      return res.status(401).json({ message: 'Email hoặc mật khẩu không đúng.' });
    }

    const token = signToken(user);
    res.json({ token, user: publicUser(user) });
  } catch (err) {
    console.error('login error:', err);
    res.status(500).json({ message: 'Lỗi máy chủ khi đăng nhập.' });
  }
}

// GET /api/auth/me
async function me(req, res) {
  res.json({ user: publicUser(req.user) });
}

module.exports = { register, login, me, publicUser };
