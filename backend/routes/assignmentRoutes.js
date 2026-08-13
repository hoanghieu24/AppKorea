const express = require('express');
const router = express.Router();
const { requireAuth, requireRole } = require('../middleware/auth');
const ctrl = require('../controllers/assignmentController');
const sub = require('../controllers/submissionController');

router.use(requireAuth);

router.post('/', requireRole('teacher'), ctrl.createAssignment);
router.get('/', ctrl.listAssignments);
router.get('/:id', ctrl.getAssignment);
router.delete('/:id', requireRole('teacher'), ctrl.deleteAssignment);
router.post('/:id/submit', requireRole('student'), sub.submitAssignment);

module.exports = router;
