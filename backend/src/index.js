import app from './app.js';
import { config } from './config.js';

app.listen(config.port, () => {
  console.log(`HanQuoc Classroom API: http://localhost:${config.port}`);
  if (config.jwtSecret.startsWith('dev-only')) console.warn('Cảnh báo: hãy đổi JWT_SECRET trước khi deploy.');
});
