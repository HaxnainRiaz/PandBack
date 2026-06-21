const mongoose = require('mongoose');
const dotenv = require('dotenv');
const Blog = require('./models/Blog');

dotenv.config();

const seedBlog = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/skincare');

        const count = await Blog.countDocuments();
        if (count === 0) {
            await Blog.create({
                title: 'The Science of Glow: Why Botanical Ingredients Matter',
                slug: 'the-science-of-glow',
                content: '<p>Skincare is more than just products; it is a ritual of self-care. In this article, we explore how botanical extracts like Neem and Kalonji transform your skin health...</p>',
                excerpt: 'Discover the hidden powers of botanical ingredients in your daily ritual.',
                image: 'https://images.unsplash.com/photo-1596755094514-f87e34085b2c?auto=format&fit=crop&q=80&w=1200',
                author: 'Luminelle Editorial',
                readTime: '5 min read',
                category: 'Skincare',
                status: 'published'
            });
            console.log('Sample blog created successfully.');
        } else {
            console.log('Blogs already exist in the database.');
        }

        process.exit();
    } catch (err) {
        console.error('Error seeding blog:', err);
        process.exit(1);
    }
};

seedBlog();
