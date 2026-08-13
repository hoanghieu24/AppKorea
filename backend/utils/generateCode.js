// Sinh mã tham gia lớp ngắn, dễ đọc (bỏ ký tự dễ nhầm: 0/O, 1/I)
const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateJoinCode(length = 6) {
  let code = '';
  for (let i = 0; i < length; i++) {
    code += CHARS[Math.floor(Math.random() * CHARS.length)];
  }
  return code;
}

module.exports = { generateJoinCode };
