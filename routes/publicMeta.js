const express = require('express');
const router = express.Router();
const publicMetaController = require('../controllers/publicMetaController');

// Public route for webstore to fetch Pixel configuration
router.get('/config', publicMetaController.getMetaConfig);

module.exports = router;
