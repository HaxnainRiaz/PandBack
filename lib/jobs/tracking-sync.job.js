const cron = require('node-cron');
const Order = require('../../models/Order');
const PostExIntegration = require('../../models/PostExIntegration');
const postexService = require('../../services/postex.service');
const OrderEvent = require('../../models/OrderEvent');

const statusMap = {
    'Booked': 'Booked',
    'PostEx WareHouse': 'PostEx WareHouse',
    'Out For Delivery': 'Out For Delivery',
    'Delivered': 'Delivered',
    'Returned': 'Returned',
    'Delivery Under Review': 'Delivery Under Review',
    'Picked By PostEx': 'Picked By PostEx',
    'Out For Return': 'Out For Return',
    'Attempted': 'Attempted',
    'En-Route to PostEx warehouse': 'En-Route to PostEx warehouse',
    'Cancelled': 'Cancelled'
};

// Schedule to run every hour
cron.schedule('0 * * * *', async () => {
    console.log('[JOBS] Starting background tracking sync...');
    try {
        const orders = await Order.find({ 
            deliveryStatus: { $nin: ['Delivered', 'Returned', 'Cancelled'] },
            'postex.trackingNumber': { $ne: null }
        }).limit(100);

        if (!orders.length) return;

        const integration = await PostExIntegration.findOne({ isConnected: true }).select('ownerId');
        if (!integration?.ownerId) {
            console.warn('[JOBS] No connected PostEx integration found for tracking sync');
            return;
        }

        const trackingNumbers = orders.map(o => o.postex.trackingNumber);
        const response = await postexService.trackBulkOrders(integration.ownerId, trackingNumbers);

        if (response.dist && Array.isArray(response.dist)) {
            for (const item of response.dist) {
                const order = orders.find(o => o.postex.trackingNumber === item.trackingNumber);
                if (order) {
                    const oldStatus = order.deliveryStatus;
                    const newStatus = statusMap[item.transactionStatus] || oldStatus;

                    if (oldStatus !== newStatus) {
                        order.deliveryStatus = newStatus;
                        order.postex.transactionStatus = item.transactionStatus;
                        order.postex.transactionStatusHistory = item.transactionStatusHistory;
                        order.postex.lastTrackingSyncAt = new Date();

                        if (newStatus === 'Delivered') {
                            order.orderStatus = 'delivered';
                            order.paymentStatus = 'paid';
                        } else if (newStatus === 'Returned') {
                            order.orderStatus = 'returned';
                        } else if (newStatus === 'Cancelled') {
                            order.orderStatus = 'cancelled';
                        }

                        await order.save();
                        await OrderEvent.create({
                            orderId: order._id,
                            eventType: 'AUTO_SYNC_UPDATE',
                            message: `Background sync: ${newStatus}`,
                            actor_name: 'SYSTEM'
                        });
                        console.log(`[JOBS] Updated order ${order._id} to ${newStatus}`);
                    }
                }
            }
        }
        
    } catch (err) {
        console.error('[JOBS] Tracking sync error:', err.message);
    }
});

console.log('[JOBS] Tracking sync job scheduled.');
