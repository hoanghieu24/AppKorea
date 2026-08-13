const express = require('express');
const router = express.Router();
const { requireAuth, requireRole } = require('../middleware/auth');
const ctrl = require('../controllers/classController');

router.use(requireAuth);

router.post('/', requireRole('teacher'), ctrl.createClass);
router.get('/', ctrl.listClasses);
router.get('/:id', ctrl.getClass);
router.post('/join', requireRole('student'), ctrl.joinClass);
router.delete('/:id/students/:studentId', requireRole('teacher'), ctrl.removeStudent);

module.exports = router;
