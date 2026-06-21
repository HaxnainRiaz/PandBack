const MetaIntegration = require('../models/MetaIntegration');

exports.getMetaConfig = async (req, res) => {
    try {
        const integration = await MetaIntegration.findOne();
        if (!integration || !integration.isPixelEnabled || !integration.pixelId) {
            return res.status(200).json({ 
                success: true, 
                enabled: false 
            });
        }

        // Return only public-safe fields
        res.status(200).json({
            success: true,
            isPixelEnabled: integration.isPixelEnabled,
            pixelId: integration.pixelId,
            dataSharingLevel: integration.dataSharingLevel,
            enabledEvents: integration.enabledEvents,
            deduplicationEnabled: integration.deduplicationEnabled || false,
            hasCapiToken: !!integration.capiAccessTokenEncrypted
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
