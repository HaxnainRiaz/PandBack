const axios = require('axios');

const testLogin = async () => {
    try {
        console.log('Attempting test login for hasnain@gmail.com...');
        const response = await axios.post('http://localhost:5000/api/auth/login', {
            email: 'hasnain@gmail.com',
            password: '12345678'
        });
        console.log('Response Status:', response.status);
        console.log('Response Data:', JSON.stringify(response.data, null, 2));
    } catch (error) {
        console.error('Login Failed!');
        if (error.response) {
            console.error('Status:', error.response.status);
            console.error('Data:', JSON.stringify(error.response.data, null, 2));
        } else {
            console.error('Error Message:', error.message);
        }
    }
};

testLogin();
