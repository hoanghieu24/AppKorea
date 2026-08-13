require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const { sequelize } = require('./models');

const authRoutes = require('./routes/authRoutes');
const classRoutes = require('./routes/classRoutes');
const lessonRoutes = require('./routes/lessonRoutes');
const wordRoutes = require('./routes/wordRoutes');
const grammarRoutes = require('./routes/grammarRoutes');
const assignmentRoutes = require('./routes/assignmentRoutes');
const submissionRoutes = require('./routes/submissionRoutes');
const progressRoutes = require('./routes/progressRoutes');

const app = express();

app.use(cors({ origin: process.env.CLIENT_URL || 'http://localhost:5173' }));
app.use(express.json({ limit: '5mb' }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.get('/api/health', (req, res) => res.json({ ok: true, name: 'HanQuoc Learn AI API' }));

app.use('/api/auth', authRoutes);
app.use('/api/classes', classRoutes);
app.use('/api/lessons', lessonRoutes);
app.use('/api/words', wordRoutes);
app.use('/api/grammar', grammarRoutes);
app.use('/api/assignments', assignmentRoutes);
app.use('/api/submissions', submissionRoutes);
app.use('/api/progress', progressRoutes);

// 404
app.use('/api', (req, res) => res.status(404).json({ message: 'Không tìm thấy endpoint.' }));

// Error handler chung
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ message: 'Lỗi máy chủ không xác định.' });
});

const PORT = process.env.PORT || 5000;

async function start() {
  try {
    await sequelize.authenticate();
    console.log('✅ Kết nối MySQL thành công.');

    // Tự động tạo/đồng bộ bảng theo models. Dùng migration riêng nếu triển khai production.
    await sequelize.sync({ alter: true });
    console.log('✅ Đã đồng bộ schema database.');

    app.listen(PORT, () => {
      console.log(`🚀 API đang chạy tại http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error('❌ Không khởi động được server:', err);
    process.exit(1);
  }
}

start();
