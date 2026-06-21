const dotenv = require('dotenv');
dotenv.config();

const requiredEnv = [
    'META_APP_ID',
    'META_APP_SECRET',
    'META_REDIRECT_URI',
    'CLIENT_URL'
];

console.log('--- Meta Integration Environment Check ---');
let missing = false;

requiredEnv.forEach(env => {
    if (!process.env[env]) {
        console.error(`❌ Missing: ${env}`);
        missing = true;
    } else {
        console.log(`✅ Found: ${env} = ${process.env[env].substring(0, 4)}...`);
    }
});

if (missing) {
    console.log('\n⚠️  Please add the missing variables to your StoreBackend/.env file.');
    console.log('Go to https://developers.facebook.com to create an app and get credentials.');
} else {
    console.log('\n🚀 Meta Integration is ready for OAuth!');
}
