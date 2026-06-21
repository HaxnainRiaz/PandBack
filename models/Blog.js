const mongoose = require('mongoose');

const blogSchema = new mongoose.Schema({
    title: {
        type: String,
        required: [true, 'Please add a title'],
        trim: true,
    },
    slug: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    content: {
        type: String,
        required: [true, 'Please add content'],
    },
    excerpt: {
        type: String,
        required: [true, 'Please add an excerpt'],
    },
    image: {
        type: String,
        default: 'https://placehold.co/1200x600?text=Blog+Header',
    },
    author: {
        type: String,
        default: 'Admin',
    },
    readTime: {
        type: String,
        default: '5 min read',
    },
    category: {
        type: String,
        default: 'General',
    },
    tags: {
        type: [String],
        default: []
    },
    status: {
        type: String,
        enum: ['draft', 'published'],
        default: 'published'
    },
    isFeatured: {
        type: Boolean,
        default: false
    },
    comments: [{
        name: {
            type: String,
            required: true
        },
        email: {
            type: String,
            required: true
        },
        comment: {
            type: String,
            required: true
        },
        createdAt: {
            type: Date,
            default: Date.now
        }
    }]
}, {
    timestamps: true
});

module.exports = mongoose.models.Blog || mongoose.model('Blog', blogSchema);
