const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const ctrl = require('../controllers/wordController');

router.use(requireAuth);
router.get('/', ctrl.listWords);
router.post('/', ctrl.createWord);
router.delete('/:id', ctrl.deleteWord);
router.put('/:id/progress', ctrl.updateProgress);

module.exports = router;
