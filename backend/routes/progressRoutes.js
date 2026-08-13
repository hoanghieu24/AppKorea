const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const ctrl = require('../controllers/progressController');

router.use(requireAuth);
router.get('/me', ctrl.getMyStats);
router.post('/checkin', ctrl.checkin);
router.post('/xp', ctrl.grantXP);

module.exports = router;
