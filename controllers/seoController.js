const SEO = require('../models/SEO');

exports.getSEO = async (req, res) => {
    try {
        const { entityType, entityId } = req.query;
        let query = {};
        if (entityType) query.entityType = entityType;
        if (entityId) query.entityId = entityId;

        const seo = await SEO.find(query);
        res.status(200).json({ success: true, data: seo });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

exports.updateSEO = async (req, res) => {
    try {
        const { entityType, entityId, metaTitle, metaDescription } = req.body;

        let seo = await SEO.findOneAndUpdate(
            { entityType, entityId },
            { metaTitle, metaDescription },
            { new: true, upsert: true, runValidators: true }
        );

        res.status(200).json({ success: true, data: seo });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};
