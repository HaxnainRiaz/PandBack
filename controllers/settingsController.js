const Settings = require('../models/Settings');
const { createLog } = require('./auditController');
const { invalidateCache } = require('../utils/cache');

exports.getSettings = async (req, res) => {
    try {
        let settings = await Settings.findOne().select('-__v').lean();
        if (!settings) {
            settings = await Settings.create({});
            settings = settings.toObject();
        }
        res.set('Cache-Control', 'public, max-age=120, stale-while-revalidate=300');
        res.status(200).json({ success: true, data: settings });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

exports.updateSettings = async (req, res) => {
    try {
        let settings = await Settings.findOne();
        if (!settings) {
            settings = await Settings.create(req.body);
        } else {
            settings = await Settings.findOneAndUpdate({}, req.body, { new: true });
        }
        invalidateCache('store:');

        await createLog(req.user.id, 'Settings Update', 'Updated global store structural configuration');

        res.status(200).json({ success: true, data: settings });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};
