const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const cloudinaryImageStorage = require('../services/cloudinaryImageStorage');

async function test() {
    console.log('Cloud name:', process.env.CLOUDINARY_CLOUD_NAME);
    console.log('API Key:', process.env.CLOUDINARY_API_KEY);
    console.log('API Secret:', process.env.CLOUDINARY_API_SECRET ? 'Exists' : 'Missing');
    console.log('Is Configured:', cloudinaryImageStorage.isCloudinaryConfigured());
    const res = await cloudinaryImageStorage.verifyCloudinaryCredentials();
    console.log('Verification Result:', res);
}

test().catch(console.error);
