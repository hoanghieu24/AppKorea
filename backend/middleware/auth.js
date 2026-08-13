const { verifyToken } = require('../utils/jwt');
const { User } = require('../models');

// Yêu cầu đăng nhập: đọc Bearer token, gắn req.user
async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) {
      return res.status(401).json({ message: 'Chưa đăng nhập (thiếu token).' });
    }
    const payload = verifyToken(token);
    const user = await User.findByPk(payload.id);
    if (!user) {
      return res.status(401).json({ message: 'Tài khoản không tồn tại.' });
    }
    req.user = user; // Sequelize instance đầy đủ
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Token không hợp lệ hoặc đã hết hạn.' });
  }
}

// Chặn theo vai trò, VD: requireRole('teacher')
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ message: 'Bạn không có quyền thực hiện hành động này.' });
    }
    next();
  };
}

module.exports = { requireAuth, requireRole };
