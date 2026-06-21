const Order = require('../models/Order');
const ShipmentLog = require('../models/ShipmentLog');
const OrderEvent = require('../models/OrderEvent');
const mongoose = require('mongoose');
const postexService = require('../services/postex.service');

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

exports.bookOrderOnPostEx = async (req, res) => {
    try {
        const orderId = req.params.id;
        const order = await Order.findById(orderId).populate('user').populate('items.product', 'title');
        if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

        // ── State Machine Enforcement ──────────────────────────────────────────
        if (order.isPostExBooked) {
            return res.status(400).json({ success: false, message: 'Order is already booked on PostEx' });
        }
        if (order.orderStatus === 'cancelled') {
            return res.status(422).json({ success: false, message: 'Cannot book a cancelled order' });
        }
        if (order.orderStatus === 'delivered') {
            return res.status(422).json({ success: false, message: 'Order already delivered' });
        }
        if (order.orderStatus === 'returned') {
            return res.status(422).json({ success: false, message: 'Order has been returned' });
        }
        if (order.orderStatus === 'pending') {
            return res.status(422).json({ success: false, message: 'Please confirm the order before booking with PostEx' });
        }

        // ── Extract & sanitize fields (req.body can override for weight/remarks) ─
        const { orderType, weight, remarks, pickupAddressCode, storeAddressCode } = req.body || {};

        const customerName = (order.customerName || order.shippingAddress?.fullName || order.user?.name || '').trim();
        
        // Prefer root-level fields which are updated via Admin Slider
        const rawPhone = order.customerPhone || order.shippingAddress?.phone || '';
        const customerPhone = rawPhone.replace(/[\s\-()]/g, '');
        
        const cityName = (order.cityName || order.shippingAddress?.city || '').trim();
        
        const deliveryAddress = (order.deliveryAddress || [
            order.shippingAddress?.street,
            order.shippingAddress?.city,
            order.shippingAddress?.state
        ].filter(Boolean).join(', ')).trim();

        const totalAmount = Number(order.totalAmount || 0);
        // COD amount: 0 if already paid, otherwise full total
        const codAmount = (order.paymentStatus === 'paid') ? 0 : totalAmount;
        
        // Items count for PostEx legacy/bulk compatibility
        const itemsCount = (order.items || []).reduce((acc, item) => acc + (Number(item.quantity) || 0), 0);
        const itemsArray = (order.items || []).map(item => ({
            productName: item.product?.title || item.productName || 'Product',
            quantity: Number(item.quantity)
        }));
        
        const orderRefNumber = order.orderNumber || order._id.toString();
        const packageWeight = Number(weight) || 0.5;
        const bookingRemarks = remarks || order.transactionNotes || '';

        // ── Pre-flight Validation ──────────────────────────────────────────────
        const missing = [];
        if (!customerName)    missing.push('customerName');
        if (!customerPhone)   missing.push('customerPhone');
        if (!cityName)        missing.push('cityName');
        if (!deliveryAddress) missing.push('deliveryAddress');
        if (!totalAmount)     missing.push('totalAmount');
        if (!itemsCount)      missing.push('items');
        
        if (missing.length) {
            return res.status(422).json({
                success: false,
                message: `Missing required fields for PostEx booking: ${missing.join(', ')}`
            });
        }

        // ── Build exact PostEx v3 payload ──────────────────────────────────────
        const payload = {
            orderRefNumber,
            orderType:       orderType || 'Normal',
            cityName,
            customerName,
            customerPhone,
            deliveryAddress,
            items:           itemsCount, // Some versions expect number
            itemsDetail:     itemsArray,  // Some versions expect array
            orderDetail:     itemsArray.map(i => `${i.productName} x${i.quantity}`).join(', ').substring(0, 500),
            totalAmount,
            codAmount,
            weight:          packageWeight,
            remarks:         bookingRemarks,
            ...(pickupAddressCode && { pickupAddressCode }),
            ...(storeAddressCode  && { storeAddressCode })
        };

        // Log request
        try {
            await ShipmentLog.create({
                orderId: order._id,
                action: 'CREATE_ORDER',
                endpoint: '/v3/create-order',
                requestPayload: payload
            });
        } catch (logErr) { console.warn('ShipmentLog write error:', logErr.message); }

        // ── Call PostEx API ────────────────────────────────────────────────────
        const response = await postexService.createOrder(payload);

        // PostEx returns HTTP 200 for BOTH success and failure.
        // The real status lives inside response.statusCode.
        if (String(response.statusCode) !== '200') {
            const errMsg = response.statusMessage || response.message || 'PostEx rejected the booking';
            console.error('[PostEx] Booking rejected:', JSON.stringify(response, null, 2));
            try {
                await ShipmentLog.create({
                    orderId: order._id,
                    action: 'CREATE_ORDER_FAILED',
                    endpoint: '/v3/create-order',
                    responsePayload: response,
                    errorMessage: errMsg,
                    success: false
                });
            } catch (logErr) { console.warn('ShipmentLog write error:', logErr.message); }
            return res.status(422).json({ success: false, message: errMsg, raw: response });
        }

        // Log success
        try {
            await ShipmentLog.create({
                orderId: order._id,
                action: 'CREATE_ORDER',
                endpoint: '/v3/create-order',
                responsePayload: response,
                statusCode: 200,
                success: true
            });
        } catch (logErr) { console.warn('ShipmentLog write error:', logErr.message); }

        // ── Extract tracking info & update order ───────────────────────────────
        const trackingNumber = response.dist?.trackingNumber;
        if (!trackingNumber) {
            throw new Error('PostEx response did not contain a tracking number');
        }

        order.postex.trackingNumber = trackingNumber;
        order.postex.orderStatus    = response.dist?.orderStatus || 'Booked';
        order.postex.orderDate      = response.dist?.orderDate   || new Date();
        order.postex.rawCreateResponse = response;
        order.deliveryStatus  = 'Booked';
        order.isPostExBooked  = true;
        order.orderStatus     = 'in progress';
        order.fulfillmentStatus = 'Partially Fulfilled';
        await order.save();

        try {
            await OrderEvent.create({
                orderId:   order._id,
                eventType: 'POSTEX_BOOKED',
                message:   `Booked on PostEx — Tracking: ${trackingNumber}`,
                createdBy: req.user._id
            });
        } catch (evtErr) { console.warn('OrderEvent write error:', evtErr.message); }

        return res.status(200).json({
            success: true,
            data: order,
            message: `Shipment booked. Tracking: ${trackingNumber}`
        });

    } catch (error) {
        // DETAILED LOGGING FOR 400 ERRORS
        const axiosError = error.response?.data;
        console.error('[PostEx] bookOrderOnPostEx error:', {
            message: error.message,
            response: axiosError || 'No response data'
        });

        try {
            await ShipmentLog.create({
                orderId:      req.params.id,
                action:       'CREATE_ORDER_FAILED',
                endpoint:     '/v3/create-order',
                errorMessage: axiosError?.statusMessage || error.message,
                responsePayload: axiosError,
                success:      false
            });
            await OrderEvent.create({
                orderId:   req.params.id,
                eventType: 'POSTEX_BOOKING_FAILED',
                message:   `PostEx booking failed: ${axiosError?.statusMessage || error.message}`,
                createdBy: req.user._id
            });
        } catch (logErr) { console.warn('Log write error in catch:', logErr.message); }

        res.status(500).json({
            success: false,
            message: axiosError?.statusMessage || axiosError?.message || error.message
        });
    }
};

exports.getPostExTracking = async (req, res) => {
    try {
        const orderId = req.params.id;
        const order = await Order.findById(orderId);
        if (!order || !order.postex.trackingNumber) {
            return res.status(404).json({ success: false, message: 'Order or tracking number not found' });
        }

        const response = await postexService.trackOrder(order.postex.trackingNumber);

        if (response.dist) {
            order.postex.transactionStatus = response.dist.transactionStatus;
            order.postex.transactionStatusHistory = response.dist.transactionHistory;
            order.postex.lastTrackingSyncAt = new Date();
            order.postex.rawTrackingResponse = response;

            const newStatus = statusMap[response.dist.transactionStatus] || order.deliveryStatus;
            if (newStatus !== order.deliveryStatus) {
                order.deliveryStatus = newStatus;
                await OrderEvent.create({
                    orderId: order._id,
                    eventType: 'POSTEX_TRACKING_UPDATED',
                    message: `Delivery status updated to ${newStatus}`,
                    createdBy: req.user._id
                });
            }

            await order.save();
        }

        res.status(200).json({ success: true, data: order });
    } catch (error) {
        res.status(500).json({ success: false, message: error.response?.data?.statusMessage || error.message });
    }
};

exports.cancelPostExOrder = async (req, res) => {
    try {
        const orderId = req.params.id;
        const order = await Order.findById(orderId);
        if (!order || !order.postex.trackingNumber) {
            return res.status(404).json({ success: false, message: 'Order or tracking number not found' });
        }

        const response = await postexService.cancelOrder(order.postex.trackingNumber);

        order.deliveryStatus = 'Cancelled';
        await order.save();

        await OrderEvent.create({
            orderId: order._id,
            eventType: 'POSTEX_CANCELLED',
            message: `PostEx shipment cancelled`,
            createdBy: req.user._id
        });

        res.status(200).json({ success: true, data: order, message: 'Order cancelled successfully on PostEx' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.response?.data?.statusMessage || error.message });
    }
};

exports.downloadPostExInvoice = async (req, res) => {
    try {
        const orderId = req.params.id;
        const order = await Order.findById(orderId);
        if (!order || !order.postex?.trackingNumber) {
            return res.status(404).json({ success: false, message: 'Order or tracking number not found' });
        }

        const response = await postexService.getAirwayBillUrl([order.postex.trackingNumber]);

        res.status(200).json({ success: true, data: response });
    } catch (error) {
        res.status(500).json({ success: false, message: error.response?.data?.statusMessage || error.message });
    }
};

exports.getPostExPickupAddresses = async (req, res) => {
    try {
        const response = await postexService.getPickupAddresses();
        res.status(200).json({ success: true, data: response });
    } catch (error) {
        res.status(500).json({ success: false, message: error.response?.data?.statusMessage || error.message });
    }
};

exports.getPostExOperationalCities = async (req, res) => {
    try {
        const response = await postexService.getOperationalCities();
        res.status(200).json({ success: true, data: response });
    } catch (error) {
        res.status(500).json({ success: false, message: error.response?.data?.statusMessage || error.message });
    }
};

exports.trackBulk = async (req, res) => {
    try {
        const { trackingNumbers } = req.body;
        if (!trackingNumbers || !Array.isArray(trackingNumbers)) {
            return res.status(400).json({ success: false, message: 'Invalid tracking numbers' });
        }
        const response = await postexService.trackBulkOrders(trackingNumbers);
        res.status(200).json({ success: true, data: response });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

exports.syncTracking = async (req, res) => {
    try {
        const orders = await Order.find({
            deliveryStatus: { $nin: ['Delivered', 'Returned', 'Cancelled'] },
            'postex.trackingNumber': { $ne: null }
        }).limit(50);

        if (!orders.length) return res.status(200).json({ success: true, message: 'No orders to sync' });

        const trackingNumbers = orders.map(o => o.postex.trackingNumber);
        const response = await postexService.trackBulkOrders(trackingNumbers);

        // Update each order based on bulk response
        const updates = [];
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
                            eventType: 'POSTEX_SYNC_UPDATE',
                            message: `Auto-synced status: ${newStatus}`,
                            actor_name: 'SYSTEM'
                        });
                        updates.push({ id: order._id, status: newStatus });
                    }
                }
            }
        }

        res.status(200).json({ success: true, updatesCount: updates.length, message: 'Sync complete' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.saveShipperAdvice = async (req, res) => {
    try {
        const { trackingNumber, statusId, remarks } = req.body;
        const response = await postexService.saveShipperAdvice(trackingNumber, statusId, remarks);
        res.status(200).json({ success: true, data: response });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.getPaymentStatus = async (req, res) => {
    try {
        const { trackingNumber } = req.params;
        const response = await postexService.getPaymentStatus(trackingNumber);
        res.status(200).json({ success: true, data: response });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.listPostExOrders = async (req, res) => {
    try {
        const { statusId, fromDate, toDate } = req.query;
        const response = await postexService.listPostExOrders(statusId, fromDate, toDate);
        res.status(200).json({ success: true, data: response });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.bulkPreparePostEx = async (req, res) => {
    try {
        const { orderIds } = req.body;
        if (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0) {
            return res.status(400).json({ success: false, message: 'orderIds array is required' });
        }

        const validIds = orderIds.filter((id) => mongoose.Types.ObjectId.isValid(id));
        if (!validIds.length) {
            return res.status(400).json({ success: false, message: 'No valid order IDs provided' });
        }

        const orders = await Order.find({ _id: { $in: validIds } })
            .populate('items.product', 'title')
            .lean();

        if (!orders.length) {
            return res.status(404).json({ success: false, message: 'No orders found for the selected IDs' });
        }

        const orderMap = new Map(orders.map((o) => [String(o._id), o]));
        const data = validIds
            .map((id) => orderMap.get(String(id)))
            .filter(Boolean)
            .map((order) => {
            const itemsCount = (order.items || []).reduce((acc, item) => acc + (Number(item.quantity) || 0), 0);
            const orderDetail = (order.items || [])
                .map((i) => `${i.product?.title || i.productName || 'Item'} x${i.quantity}`)
                .join(', ')
                .substring(0, 500);

            return {
                orderId: order._id,
                orderNumber: order.orderNumber || String(order._id),
                customerName: order.customerName || order.shippingAddress?.fullName || '',
                customerPhone: (order.customerPhone || order.shippingAddress?.phone || '').replace(/[\s\-()]/g, ''),
                originalCity: order.cityName || order.shippingAddress?.city || '',
                originalAddress: order.deliveryAddress || [
                    order.shippingAddress?.street,
                    order.shippingAddress?.city,
                    order.shippingAddress?.state,
                ].filter(Boolean).join(', '),
                totalAmount: order.paymentStatus === 'paid' ? 0 : Number(order.totalAmount || 0),
                itemsCount,
                orderDetail: orderDetail || 'Order items',
                isPostExBooked: !!order.isPostExBooked,
                orderStatus: order.orderStatus,
            };
        });

        res.status(200).json({ success: true, data, found: data.length, requested: validIds.length });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

const applyPostExBookingToOrder = async (order, response, req) => {
    const trackingNumber = response.dist?.trackingNumber || response.trackingNumber;
    if (!trackingNumber) {
        throw new Error(response.statusMessage || response.message || 'PostEx did not return a tracking number');
    }

    order.postex = order.postex || {};
    order.postex.trackingNumber = trackingNumber;
    order.deliveryStatus = 'Booked';
    order.isPostExBooked = true;
    order.postex.bookedAt = new Date();
    await order.save();

    await OrderEvent.create({
        orderId: order._id,
        eventType: 'POSTEX_BOOKED',
        message: `Bulk booked on PostEx: ${trackingNumber}`,
        createdBy: req.user?._id,
    }).catch(() => {});
};

exports.bulkBookPostEx = async (req, res) => {
    try {
        const { shipments, forceRebook, orderIds } = req.body;

        if (shipments && Array.isArray(shipments)) {
            let successCount = 0;
            const failedOrders = [];

            for (const entry of shipments) {
                const orderId = entry.orderId;
                const payload = entry.payload;
                try {
                    const order = await Order.findById(orderId);
                    if (!order) {
                        failedOrders.push({ orderId, reason: 'Order not found' });
                        continue;
                    }
                    if (order.isPostExBooked && !forceRebook) {
                        failedOrders.push({ orderId, reason: 'Already booked on PostEx' });
                        continue;
                    }
                    if (order.orderStatus === 'cancelled') {
                        failedOrders.push({ orderId, reason: 'Order is cancelled' });
                        continue;
                    }

                    const response = await postexService.createOrder(payload);
                    if (String(response.statusCode) !== '200') {
                        failedOrders.push({
                            orderId,
                            reason: response.statusMessage || response.message || 'PostEx rejected booking',
                        });
                        continue;
                    }

                    await applyPostExBookingToOrder(order, response, req);
                    successCount++;
                } catch (e) {
                    failedOrders.push({ orderId, reason: e.message });
                }
            }

            return res.status(200).json({
                success: true,
                summary: { successCount, failedCount: failedOrders.length },
                failedOrders,
            });
        }

        const ids = orderIds || [];
        const orders = await Order.find({ _id: { $in: ids }, isPostExBooked: false, orderStatus: { $ne: 'cancelled' } });

        let successCount = 0;
        for (const order of orders) {
            try {
                const customerName = order.customerName || order.shippingAddress?.fullName;
                const customerPhone = order.shippingAddress?.phone;
                const deliveryAddress = `${order.shippingAddress?.street}, ${order.shippingAddress?.city}`;
                const cityName = order.shippingAddress?.city;
                const itemsCount = order.items.reduce((acc, item) => acc + item.quantity, 0);

                const payload = {
                    cityName,
                    customerName,
                    customerPhone,
                    deliveryAddress,
                    invoiceDivision: 1,
                    invoicePayment: order.totalAmount,
                    items: itemsCount,
                    orderDetail: 'Order Items',
                    orderRefNumber: order._id.toString(),
                    orderType: 'Normal',
                    pickupAddressCode: 'DEFAULT',
                };

                const response = await postexService.createOrder(payload);
                if (String(response.statusCode) === '200') {
                    await applyPostExBookingToOrder(order, response, req);
                    successCount++;
                }
            } catch (e) {
                console.error(`Bulk booking failed for order ${order._id}:`, e.message);
            }
        }

        res.status(200).json({ success: true, count: successCount });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

exports.getFailedLogs = async (req, res) => {
    try {
        const logs = await ShipmentLog.find({ success: false })
            .populate('orderId', 'orderNumber customerName totalAmount')
            .sort({ createdAt: -1 })
            .limit(100);
        res.status(200).json({ success: true, data: logs });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

exports.bulkInvoicePostEx = async (req, res) => {
    try {
        const { orderIds } = req.body;
        const orders = await Order.find({ _id: { $in: orderIds }, isPostExBooked: true });
        const trackingNumbers = orders.map(o => o.postex.trackingNumber).filter(Boolean);

        if (trackingNumbers.length === 0) {
            return res.status(400).json({ success: false, message: 'No booked orders selected' });
        }

        const response = await postexService.getAirwayBillUrl(trackingNumbers);
        res.status(200).json({ success: true, data: response });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

