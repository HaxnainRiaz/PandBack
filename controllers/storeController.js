const Product = require('../models/Product');
const Category = require('../models/Category');
const Banner = require('../models/Banner');
const Settings = require('../models/Settings');
const { getCache, setCache } = require('../utils/cache');

const PRODUCT_CARD_FIELDS = 'title slug images price salePrice stock category isFeatured isBestSeller status rating totalReviews createdAt';

exports.getCatalog = async (req, res, next) => {
    try {
        const page = Math.max(Number.parseInt(req.query.page, 10) || 1, 1);
        const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 20, 1), 50);
        const cacheKey = `store:catalog:${page}:${limit}`;
        const cached = getCache(cacheKey);

        res.set('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
        if (cached) return res.status(200).json(cached);

        const filter = { status: 'active' };
        const skip = (page - 1) * limit;
        const [products, total, categories, banners, settings] = await Promise.all([
            Product.find(filter).select(PRODUCT_CARD_FIELDS).populate('category', 'title slug')
                .sort({ createdAt: -1 }).skip(skip).limit(limit).maxTimeMS(2500).lean(),
            Product.countDocuments(filter).maxTimeMS(2500),
            Category.find().select('title slug image description').sort({ title: 1 }).maxTimeMS(2500).lean(),
            Banner.find({ isActive: true }).select('title subtitle image buttonLink buttonText isActive')
                .sort({ createdAt: -1 }).maxTimeMS(2500).lean(),
            Settings.findOne().select('-__v').maxTimeMS(2500).lean()
        ]);

        const payload = {
            success: true,
            data: {
                products,
                categories,
                banners,
                settings: settings || {},
                pagination: { total, page, pages: Math.ceil(total / limit), limit }
            }
        };

        return res.status(200).json(setCache(cacheKey, payload, 60));
    } catch (error) {
        return next(error);
    }
};
