const { UserStats } = require('../models');
const { addXP, touchStreak } = require('../utils/statsHelper');

// GET /api/progress/me
async function getMyStats(req, res) {
  try {
    const [stats] = await UserStats.findOrCreate({
      where: { userId: req.user.id },
      defaults: { userId: req.user.id },
    });
    res.json({ stats });
  } catch (err) {
    console.error('getMyStats error:', err);
    res.status(500).json({ message: 'Lỗi máy chủ khi tải tiến độ.' });
  }
}

// POST /api/progress/checkin  — gọi khi user mở app / hoàn thành hoạt động trong ngày
async function checkin(req, res) {
  try {
    const stats = await touchStreak(req.user.id);
    res.json({ stats });
  } catch (err) {
    console.error('checkin error:', err);
    res.status(500).json({ message: 'Lỗi máy chủ.' });
  }
}

// POST /api/progress/xp  body: { amount }
async function grantXP(req, res) {
  try {
    const amount = parseInt(req.body.amount, 10) || 0;
    const stats = await addXP(req.user.id, amount);
    res.json({ stats });
  } catch (err) {
    console.error('grantXP error:', err);
    res.status(500).json({ message: 'Lỗi máy chủ.' });
  }
}

module.exports = { getMyStats, checkin, grantXP };
