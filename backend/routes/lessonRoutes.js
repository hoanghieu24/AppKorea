const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const ctrl = require('../controllers/lessonController');

router.use(requireAuth);
router.get('/', ctrl.listLessons);
router.post('/', ctrl.createLesson);
router.delete('/:id', ctrl.deleteLesson);

module.exports = router;
