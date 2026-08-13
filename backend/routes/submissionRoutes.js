const express = require('express');
const router = express.Router();
const { requireAuth, requireRole } = require('../middleware/auth');
const ctrl = require('../controllers/submissionController');

router.use(requireAuth);

router.post('/:id/regrade', requireRole('teacher'), ctrl.regradeWithAI);
router.put('/:id/grade', requireRole('teacher'), ctrl.teacherGrade);

module.exports = router;
