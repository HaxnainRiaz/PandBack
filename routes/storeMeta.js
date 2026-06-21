const express = require('express');
const router = express.Router();
const storeMetaController = require('../controllers/storeMetaController');

// Public route for webstore to fetch Pixel configuration
router.get('/config', storeMetaController.getMetaConfig);

module.exports = router;
