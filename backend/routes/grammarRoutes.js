const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const ctrl = require('../controllers/grammarController');

router.use(requireAuth);
router.get('/', ctrl.listGrammar);
router.post('/', ctrl.createGrammar);
router.delete('/:id', ctrl.deleteGrammar);

module.exports = router;
