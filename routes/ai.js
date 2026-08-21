const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { generate, suggestTitle } = require('../controller/aiController');
const {
  listChats,
  getChat,
  upsertChat,
  renameChat,
  removeChat,
  shareChat,
  unshareChat,
} = require('../controller/aiChatsController');
const {
  uploadAudio,
  transcribe,
} = require('../controller/aiTranscribeController');

const router = express.Router();

router.post('/generate', requireAuth, generate);
router.post('/title', requireAuth, suggestTitle);
router.post('/transcribe', requireAuth, (req, res) => {
  uploadAudio.single('file')(req, res, (err) => {
    if (err) {
      const message = err.message || 'Upload failed';
      const status = message.includes('Only audio') ? 400 : 500;
      return res.status(status).json({ message });
    }
    return transcribe(req, res);
  });
});

router.get('/chats', requireAuth, listChats);
router.get('/chats/:id', requireAuth, getChat);
router.put('/chats/:id', requireAuth, upsertChat);
router.patch('/chats/:id', requireAuth, renameChat);
router.delete('/chats/:id', requireAuth, removeChat);
router.post('/chats/:id/share', requireAuth, shareChat);
router.delete('/chats/:id/share', requireAuth, unshareChat);

module.exports = router;
