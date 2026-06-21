const axios = require('axios');

async function testApi() {
    const API_URL = 'http://localhost:5000/api';
    try {
        const res = await axios.get(`${API_URL}/categories`);
        console.log('Categories Response:', JSON.stringify(res.data, null, 2));
    } catch (err) {
        console.error('API Error:', err.message);
    }
}

testApi();
