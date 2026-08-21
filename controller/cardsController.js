const { randomUUID } = require('crypto');
const {
  listCardsByUser,
  findCardForUser,
  upsertCardWithCreationSpend,
  deleteCard,
  setPrimaryCard,
  CARD_CREATION_COST,
} = require('../db');

function list(req, res) {
  try {
    const cards = listCardsByUser(req.user.id);
    return res.status(200).json({ cards });
  } catch (err) {
    console.error('[cards GET]', err);
    return res.status(500).json({ message: 'List failed' });
  }
}

function getOne(req, res) {
  try {
    const card = findCardForUser(req.params.id, req.user.id);
    if (!card) {
      return res.status(404).json({ message: 'Card not found' });
    }
    return res.status(200).json({ card });
  } catch (err) {
    console.error('[cards GET :id]', err);
    return res.status(500).json({ message: 'Get failed' });
  }
}

function create(req, res) {
  try {
    const body = req.body || {};
    const data =
      body.data && typeof body.data === 'object' ? body.data : body;
    if (!data || typeof data !== 'object') {
      return res.status(400).json({ message: 'Card data required' });
    }

    const id =
      (typeof body.id === 'string' && body.id.trim()) ||
      (typeof data.creationId === 'string' && data.creationId.trim()) ||
      randomUUID();

    const payload = { ...data, creationId: id };
    const isPrimary = body.isPrimary !== false;

    const result = upsertCardWithCreationSpend({
      id,
      userId: req.user.id,
      data: payload,
      isPrimary,
    });

    if (!result.ok && result.code === 'INSUFFICIENT') {
      return res.status(402).json({
        message: 'Not enough tokens',
        code: 'INSUFFICIENT',
        cardCreationCost: CARD_CREATION_COST,
        ...(result.state || {}),
      });
    }

    return res.status(201).json({
      card: result.card,
      tokens: result.state,
      cardCreationCost: CARD_CREATION_COST,
    });
  } catch (err) {
    console.error('[cards POST]', err);
    return res.status(500).json({ message: 'Create failed' });
  }
}

function update(req, res) {
  try {
    const body = req.body || {};
    const data =
      body.data && typeof body.data === 'object' ? body.data : body;
    const existing = findCardForUser(req.params.id, req.user.id);
    const payload = {
      ...(existing?.data || {}),
      ...data,
      creationId: req.params.id,
    };

    const card = upsertCard({
      id: req.params.id,
      userId: req.user.id,
      data: payload,
      isPrimary:
        typeof body.isPrimary === 'boolean' ? body.isPrimary : undefined,
    });

    return res.status(existing ? 200 : 201).json({ card });
  } catch (err) {
    console.error('[cards PUT]', err);
    return res.status(500).json({ message: 'Update failed' });
  }
}

function remove(req, res) {
  try {
    const ok = deleteCard(req.params.id, req.user.id);
    if (!ok) {
      return res.status(404).json({ message: 'Card not found' });
    }
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[cards DELETE]', err);
    return res.status(500).json({ message: 'Delete failed' });
  }
}

function makePrimary(req, res) {
  try {
    const card = setPrimaryCard(req.params.id, req.user.id);
    if (!card) {
      return res.status(404).json({ message: 'Card not found' });
    }
    return res.status(200).json({ card });
  } catch (err) {
    console.error('[cards primary]', err);
    return res.status(500).json({ message: 'Set primary failed' });
  }
}

function like(req, res) {
  try {
    const existing = findCardForUser(req.params.id, req.user.id);
    if (!existing) {
      return res.status(404).json({ message: 'Card not found' });
    }
    const liked = req.body?.liked !== false;
    const payload = {
      ...(existing.data || {}),
      liked,
      creationId: req.params.id,
    };
    const card = upsertCard({
      id: req.params.id,
      userId: req.user.id,
      data: payload,
    });
    return res.status(200).json({ card, liked });
  } catch (err) {
    console.error('[cards like]', err);
    return res.status(500).json({ message: 'Like failed' });
  }
}

function recordExport(req, res) {
  try {
    const existing = findCardForUser(req.params.id, req.user.id);
    if (!existing) {
      return res.status(404).json({ message: 'Card not found' });
    }
    const path =
      typeof req.body?.path === 'string' ? req.body.path.trim() : '';
    const prev = Number(existing.data?.downloadCount) || 0;
    const payload = {
      ...(existing.data || {}),
      creationId: req.params.id,
      exportImagePath: path || existing.data?.exportImagePath || null,
      downloadCount: prev + 1,
      lastDownloadedAt: new Date().toISOString(),
    };
    const card = upsertCard({
      id: req.params.id,
      userId: req.user.id,
      data: payload,
    });
    return res.status(200).json({ card });
  } catch (err) {
    console.error('[cards export]', err);
    return res.status(500).json({ message: 'Export record failed' });
  }
}

function setDesign(req, res) {
  try {
    const existing = findCardForUser(req.params.id, req.user.id);
    if (!existing) {
      return res.status(404).json({ message: 'Card not found' });
    }
    const raw = Number(req.body?.designIndex);
    const designIndex = Number.isInteger(raw) ? Math.max(0, Math.min(2, raw)) : 0;
    const payload = {
      ...(existing.data || {}),
      creationId: req.params.id,
      designIndex,
    };
    const card = upsertCard({
      id: req.params.id,
      userId: req.user.id,
      data: payload,
    });
    return res.status(200).json({ card, designIndex });
  } catch (err) {
    console.error('[cards design]', err);
    return res.status(500).json({ message: 'Design update failed' });
  }
}

function setColor(req, res) {
  try {
    const existing = findCardForUser(req.params.id, req.user.id);
    if (!existing) {
      return res.status(404).json({ message: 'Card not found' });
    }
    const rawIndex = Number(req.body?.colorIndex);
    const colorIndex = Number.isInteger(rawIndex)
      ? Math.max(0, Math.min(5, rawIndex))
      : 1;
    const customColorValue = Number.isFinite(Number(req.body?.customColorValue))
      ? Number(req.body.customColorValue)
      : existing.data?.customColorValue;
    const hasCustomColor = req.body?.hasCustomColor === true;
    const payload = {
      ...(existing.data || {}),
      creationId: req.params.id,
      colorIndex,
      customColorValue,
      hasCustomColor,
    };
    const card = upsertCard({
      id: req.params.id,
      userId: req.user.id,
      data: payload,
    });
    return res.status(200).json({ card, colorIndex, hasCustomColor });
  } catch (err) {
    console.error('[cards color]', err);
    return res.status(500).json({ message: 'Color update failed' });
  }
}

module.exports = {
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
};
