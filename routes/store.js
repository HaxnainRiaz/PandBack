const express = require('express');
const { getCatalog } = require('../controllers/storeController');

const router = express.Router();
router.get('/catalog', getCatalog);

module.exports = router;
