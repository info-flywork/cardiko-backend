const {
  unlockTemplate,
  listUnlockedTemplateIds,
  TEMPLATE_UNLOCK_COST,
  LOCKED_FROM_TEMPLATE_INDEX,
} = require('../db');

/** CDN kökü — örn. https://cardiko.b-cdn.net */
const TEMPLATES_CDN_BASE = (
  process.env.TEMPLATES_CDN_BASE_URL || 'https://cardiko.b-cdn.net'
).replace(/\/$/, '');

function svgUrl(folder, fileName) {
  return `${TEMPLATES_CDN_BASE}/templatesv2/${folder}/${fileName}`;
}

const CATALOG = [
  {
    name: 'Sağlık',
    folder: 'health',
    order: 0,
    accentHex: '#2FB0DC',
    iconName: 'local_hospital',
    prefix: 'health',
    count: 16,
  },
  {
    name: 'Eğitim',
    folder: 'education',
    order: 1,
    accentHex: '#FF6EB3',
    iconName: 'school',
    prefix: 'education',
    count: 16,
  },
  {
    name: 'Mühendislik',
    folder: 'bussiens',
    order: 2,
    accentHex: '#EC951A',
    iconName: 'business_center',
    prefix: 'business',
    count: 16,
  },
  {
    name: 'E-Ticaret',
    folder: 'e-commerce',
    order: 3,
    accentHex: '#5BC4BF',
    iconName: 'shopping_bag',
    prefix: 'e-commerce',
    count: 16,
  },
  {
    name: 'Tasarımcı',
    folder: 'designer',
    order: 4,
    accentHex: '#A3B1E8',
    iconName: 'brush',
    prefix: 'designer',
    count: 16,
  },
  {
    name: 'Hukuk',
    folder: 'lawyer',
    order: 5,
    accentHex: '#EAC870',
    iconName: 'gavel',
    prefix: 'lawyer',
    count: 16,
  },
];

function _buildCategories() {
  return CATALOG.map((cat) => {
    const templates = [];
    for (let i = 1; i <= cat.count; i++) {
      templates.push({
        id: `${cat.prefix}-${i}`,
        index: i,
        frontSvgUrl: svgUrl(cat.folder, `${cat.prefix}-on${i}.svg`),
        backSvgUrl: svgUrl(cat.folder, `${cat.prefix}-back${i}.svg`),
        locked: i >= LOCKED_FROM_TEMPLATE_INDEX,
      });
    }
    return {
      name: cat.name,
      folder: cat.folder,
      order: cat.order,
      accentHex: cat.accentHex,
      iconName: cat.iconName,
      templates,
    };
  });
}

function list(req, res) {
  try {
    return res.json({ categories: _buildCategories() });
  } catch (err) {
    console.error('[templates list]', err);
    return res.status(500).json({ message: 'Failed to list templates' });
  }
}

function getCategory(req, res) {
  try {
    const folder = req.params.folder;
    const categories = _buildCategories();
    const category = categories.find((c) => c.folder === folder);
    if (!category) {
      return res.status(404).json({ message: 'Category not found' });
    }
    return res.json({ category });
  } catch (err) {
    console.error('[templates getCategory]', err);
    return res.status(500).json({ message: 'Failed to get category' });
  }
}

function unlocked(req, res) {
  try {
    const ids = listUnlockedTemplateIds(req.user.id);
    return res.json({ unlocked: ids });
  } catch (err) {
    console.error('[templates unlocked]', err);
    return res.status(500).json({ message: 'Failed to get unlocked templates' });
  }
}

function unlock(req, res) {
  const templateId =
    typeof req.body?.templateId === 'string'
      ? req.body.templateId
      : typeof req.params?.id === 'string'
        ? req.params.id
        : '';

  try {
    const result = unlockTemplate(req.user.id, templateId);
    if (!result.ok && result.code === 'INSUFFICIENT') {
      return res.status(402).json({
        message: 'Not enough tokens',
        code: 'INSUFFICIENT',
        unlockCost: TEMPLATE_UNLOCK_COST,
        ...result.state,
      });
    }
    if (!result.ok) {
      return res.status(400).json({
        message: 'Unlock failed',
        code: result.code,
        ...result.state,
      });
    }
    return res.status(200).json({
      unlocked: true,
      already: result.code === 'ALREADY',
      unlockCost: TEMPLATE_UNLOCK_COST,
      ...result.state,
    });
  } catch (err) {
    console.error('[templates unlock]', err);
    return res.status(500).json({ message: 'Unlock failed' });
  }
}

module.exports = { list, getCategory, unlocked, unlock };
