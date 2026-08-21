const express = require('express');
const { requireAuth } = require('../middleware/auth');
const {
  list,
  getOne,
  create,
  update,
  remove,
  makePrimary,
  like,
  recordExport,
  setDesign,
  setColor,
} = require('../controller/cardsController');

const router = express.Router();

router.use(requireAuth);

router.get('/', list);
router.post('/', create);
router.get('/:id', getOne);
router.put('/:id', update);
router.delete('/:id', remove);
router.post('/:id/primary', makePrimary);
router.post('/:id/like', like);
router.post('/:id/export', recordExport);
router.post('/:id/design', setDesign);
router.post('/:id/color', setColor);

module.exports = router;
