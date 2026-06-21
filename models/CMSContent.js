const mongoose = require('mongoose');

const cmsContentSchema = new mongoose.Schema({
    announcementBar: {
        text: { type: String, default: 'Free Shipping on Orders Over $75' },
        enabled: { type: Boolean, default: true }
    },
    hero: {
        headline: { type: String, default: 'Redefining Natural Luxury' },
        subHeadline: { type: String, default: 'Clinically proven, organic skincare for the modern era.' },
        image: { type: String, default: 'https://images.unsplash.com/photo-1556228578-0d85b1a4d571?auto=format&fit=crop&q=80&w=1500' }
    },
    homepageToggles: {
        blog: { type: Boolean, default: true },
        newsletter: { type: Boolean, default: true },
        featured: { type: Boolean, default: true }
    }
}, { timestamps: true });

module.exports = mongoose.models.CMSContent || mongoose.model('CMSContent', cmsContentSchema);
