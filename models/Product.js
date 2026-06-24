const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
    title: {
        type: String,
        required: [true, 'Please add a product title'],
        trim: true,
    },
    slug: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    description: {
        type: String,
        required: [true, 'Please add a description'],
    },
    ingredients: {
        type: [String],
        default: []
    },
    usage: {
        type: String,
        default: ''
    },
    images: {
        type: [mongoose.Schema.Types.Mixed],
        default: ['https://placehold.co/600x600?text=No+Photo'],
    },
    price: {
        type: Number,
        required: [true, 'Please add a price'],
    },
    salePrice: {
        type: Number,
        default: null
    },
    stock: {
        type: Number,
        required: [true, 'Please add stock count'],
        min: 0,
        default: 0,
    },
    category: [{
        type: mongoose.Schema.ObjectId,
        ref: 'Category',
        required: false
    }],
    tags: {
        type: [String],
        default: []
    },
    concerns: {
        type: [String],
        default: []
    },
    isFeatured: {
        type: Boolean,
        default: false,
    },
    status: {
        type: String,
        enum: ['active', 'inactive'],
        default: 'active'
    },
    rating: {
        type: Number,
        default: 0,
        min: 0,
        max: 5
    },
    totalReviews: {
        type: Number,
        default: 0
    },
    metaTitle: {
        type: String,
        default: ''
    },
    metaDescription: {
        type: String,
        default: ''
    },
    isBestSeller: {
        type: Boolean,
        default: false
    }
}, {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
});

productSchema.index({ status: 1, createdAt: -1 });
productSchema.index({ status: 1, category: 1, createdAt: -1 });
productSchema.index({ status: 1, isFeatured: 1, createdAt: -1 });
productSchema.index({ status: 1, isBestSeller: 1, createdAt: -1 });
productSchema.index({ title: 'text', tags: 'text', concerns: 'text' });

// Computed: saleBadge
productSchema.virtual('saleBadge').get(function () {
    if (this.salePrice && this.salePrice < this.price) {
        const percent = Math.round(((this.price - this.salePrice) / this.price) * 100);
        return `${percent}% OFF`;
    }
    return null;
});

// Computed: availabilityLabel
productSchema.virtual('availabilityLabel').get(function () {
    if (this.stock <= 0) return 'Out of Stock';
    if (this.stock < 5) return `Only ${this.stock} Left`;
    if (this.totalReviews > 20 && this.rating >= 4) return 'Bestseller';
    return 'In Stock';
});

module.exports = mongoose.models.Product || mongoose.model('Product', productSchema);
