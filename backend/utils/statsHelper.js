const { UserStats } = require('../models');

// Cộng XP cho user (giống hàm addXP(n) gốc)
async function addXP(userId, amount) {
  const [stats] = await UserStats.findOrCreate({ where: { userId }, defaults: { userId } });
  stats.xp += amount;
  await stats.save();
  return stats;
}

// Cập nhật streak ngày học liên tiếp (giống hàm updateStreak() gốc)
async function touchStreak(userId) {
  const [stats] = await UserStats.findOrCreate({ where: { userId }, defaults: { userId } });
  const todayStr = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  if (stats.lastActiveDate === todayStr) return stats; // đã tính hôm nay rồi

  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  stats.streak = stats.lastActiveDate === yesterday ? stats.streak + 1 : 1;
  stats.lastActiveDate = todayStr;
  await stats.save();
  return stats;
}

module.exports = { addXP, touchStreak };
