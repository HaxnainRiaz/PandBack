const axios = require('axios');

const token = 'NTY2M2FmY2JkNTQzNGNhOTgzYzU5OTE2YmVkMGRhMTk6NWM2YTQ1OTdkYmViNDA5MmIzMWUwYjc2MDg0OGFhNzY=';
const BASE = 'https://api.postex.pk/services/integration/api/order';

async function testBooking() {
    const payload = {
      orderRefNumber: "TEST-" + Date.now(),
      orderType: "Normal",
      cityName: "Lahore",
      customerName: "Test User",
      customerPhone: "03274379345",
      deliveryAddress: "Test Address, Model Town, Lahore",
      invoicePayment: 100,
      invoiceDivision: 1,
      items: 1,
      orderDetail: "Test Item x1",
      transactionNotes: "Test Booking",
      pickupAddressCode: "002"
    };

    try {
        console.log('Attempting booking with invoicePayment...');
        const res = await axios.post(
            `${BASE}/v3/create-order`,
            payload,
            { headers: { 'token': token, 'Content-Type': 'application/json' }, timeout: 15000 }
        );
        console.log('Success!', res.data);
    } catch (err) {
        console.error('Failed with invoicePayment:', err.response?.status, err.response?.data);
        
        // Try with codAmount
        const payload2 = { ...payload };
        delete payload2.invoicePayment;
        payload2.codAmount = 100;
        payload2.totalAmount = 100;
        payload2.weight = 0.5;

        try {
            console.log('\nAttempting booking with codAmount...');
            const res2 = await axios.post(
                `${BASE}/v3/create-order`,
                payload2,
                { headers: { 'token': token, 'Content-Type': 'application/json' }, timeout: 15000 }
            );
            console.log('Success with codAmount!', res2.data);
        } catch (err2) {
            console.error('Failed with codAmount:', err2.response?.status, err2.response?.data);
        }
    }
}

testBooking();
