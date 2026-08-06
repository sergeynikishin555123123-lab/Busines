// core/payment.js - ПОЛНАЯ СИСТЕМА ОПЛАТЫ

const database = require('../database');
const logger = require('../logger');
const config = require('../config');
const crypto = require('crypto');
const axios = require('axios');

class PaymentService {
    
    // ============================================================
    // СОЗДАНИЕ ПЛАТЕЖА
    // ============================================================

    async createPayment(userId, amount, currency = 'RUB', gateway = null) {
        try {
            const payments = database.readTable('payments');
            const paymentGateway = gateway || config.payment?.defaultGateway || 'manual';
            
            const payment = {
                id: database.generateId(),
                user_id: String(userId),
                amount: parseFloat(amount),
                currency: currency || 'RUB',
                status: 'pending',
                payment_gateway: paymentGateway,
                gateway_payment_id: null,
                gateway_payment_url: null,
                meta_data: JSON.stringify({}),
                created_at: database.now(),
                updated_at: database.now(),
            };

            payments.push(payment);
            database.writeTable('payments', payments);

            let paymentUrl = null;
            if (paymentGateway !== 'manual') {
                try {
                    const gatewayResult = await this.initiateGatewayPayment(payment, userId);
                    if (gatewayResult && gatewayResult.payment_url) {
                        paymentUrl = gatewayResult.payment_url;
                        payment.gateway_payment_id = gatewayResult.gateway_payment_id;
                        payment.gateway_payment_url = gatewayResult.payment_url;
                        database.writeTable('payments', payments);
                    }
                } catch (gatewayError) {
                    logger.error('Gateway payment initiation failed:', gatewayError.message);
                }
            }

            logger.info(`Payment created: ${payment.id}, amount: ${amount}, gateway: ${paymentGateway}`);
            return {
                ...payment,
                payment_url: paymentUrl,
            };
        } catch (error) {
            logger.error('Error creating payment:', error);
            throw error;
        }
    }

    // ============================================================
    // ИНИЦИАЛИЗАЦИЯ ПЛАТЕЖА В ШЛЮЗЕ
    // ============================================================

    async initiateGatewayPayment(payment, userId) {
        try {
            const gateway = payment.payment_gateway;
            const users = database.readTable('users');
            const user = users.find(u => String(u.id) === String(userId));
            
            switch (gateway) {
                case 'yookassa':
                    return await this.initiateYooKassa(payment, user);
                case 'stripe':
                    return await this.initiateStripe(payment, user);
                case 'robokassa':
                    return await this.initiateRobokassa(payment, user);
                default:
                    return {
                        gateway_payment_id: `manual_${payment.id}`,
                        payment_url: null,
                    };
            }
        } catch (error) {
            logger.error('Gateway initiation error:', error);
            return {
                gateway_payment_id: `failed_${payment.id}`,
                payment_url: null,
            };
        }
    }

    async initiateYooKassa(payment, user) {
        try {
            const yookassaConfig = config.payment?.yookassa || {};
            
            if (!yookassaConfig.shopId || !yookassaConfig.secretKey) {
                return { gateway_payment_id: `manual_${payment.id}`, payment_url: null };
            }

            const auth = Buffer.from(`${yookassaConfig.shopId}:${yookassaConfig.secretKey}`).toString('base64');
            
            const response = await axios.post(
                'https://api.yookassa.ru/v3/payments',
                {
                    amount: {
                        value: payment.amount.toFixed(2),
                        currency: payment.currency || 'RUB',
                    },
                    capture: true,
                    confirmation: {
                        type: 'redirect',
                        return_url: yookassaConfig.returnUrl || `${config.server.publicUrl}/payment/success`,
                    },
                    description: `Оплата доступа к курсу`,
                    metadata: {
                        payment_id: payment.id,
                        user_id: payment.user_id,
                    },
                },
                {
                    headers: {
                        'Content-Type': 'application/json',
                        'Idempotence-Key': `${payment.id}-${Date.now()}`,
                        'Authorization': `Basic ${auth}`,
                    },
                    timeout: 30000,
                }
            );

            if (response.data && response.data.id) {
                return {
                    gateway_payment_id: response.data.id,
                    payment_url: response.data.confirmation?.confirmation_url || null,
                };
            }

            return { gateway_payment_id: `manual_${payment.id}`, payment_url: null };
        } catch (error) {
            logger.error('YooKassa initiation error:', error.response?.data || error.message);
            return { gateway_payment_id: `manual_${payment.id}`, payment_url: null };
        }
    }

    async initiateStripe(payment, user) {
        try {
            const stripeConfig = config.payment?.stripe || {};
            
            if (!stripeConfig.secretKey) {
                return { gateway_payment_id: `manual_${payment.id}`, payment_url: null };
            }

            const response = await axios.post(
                'https://api.stripe.com/v1/checkout/sessions',
                new URLSearchParams({
                    success_url: `${config.server.publicUrl}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
                    cancel_url: `${config.server.publicUrl}/payment/cancel`,
                    mode: 'payment',
                    line_items: JSON.stringify([{
                        price_data: {
                            currency: (payment.currency || 'rub').toLowerCase(),
                            product_data: {
                                name: 'Доступ к курсу',
                            },
                            unit_amount: Math.round(payment.amount * 100),
                        },
                        quantity: 1,
                    }]),
                    metadata: {
                        payment_id: payment.id,
                        user_id: payment.user_id,
                    },
                    customer_email: user?.email || undefined,
                }).toString(),
                {
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded',
                        'Authorization': `Bearer ${stripeConfig.secretKey}`,
                    },
                    timeout: 30000,
                }
            );

            if (response.data && response.data.id) {
                return {
                    gateway_payment_id: response.data.id,
                    payment_url: response.data.url || null,
                };
            }

            return { gateway_payment_id: `manual_${payment.id}`, payment_url: null };
        } catch (error) {
            logger.error('Stripe initiation error:', error.response?.data || error.message);
            return { gateway_payment_id: `manual_${payment.id}`, payment_url: null };
        }
    }

    async initiateRobokassa(payment, user) {
        try {
            const robokassaConfig = config.payment?.robokassa || {};
            
            if (!robokassaConfig.merchantLogin || !robokassaConfig.password1) {
                return { gateway_payment_id: `manual_${payment.id}`, payment_url: null };
            }

            const signature = crypto
                .createHash('md5')
                .update(`${robokassaConfig.merchantLogin}:${payment.amount}:${payment.id}:${robokassaConfig.password1}`)
                .digest('hex');

            const paymentUrl = `https://auth.robokassa.ru/Merchant/Index.aspx?` +
                `MerchantLogin=${robokassaConfig.merchantLogin}&` +
                `OutSum=${payment.amount.toFixed(2)}&` +
                `InvId=${payment.id}&` +
                `SignatureValue=${signature}&` +
                `Description=Оплата+доступа+к+курсу&` +
                `Culture=ru`;

            return {
                gateway_payment_id: `robokassa_${payment.id}`,
                payment_url: paymentUrl,
            };
        } catch (error) {
            logger.error('Robokassa initiation error:', error.message);
            return { gateway_payment_id: `manual_${payment.id}`, payment_url: null };
        }
    }

    // ============================================================
    // ПОДТВЕРЖДЕНИЕ ПЛАТЕЖА
    // ============================================================

    async confirmPayment(paymentId, gatewayPaymentId = null, metaData = {}) {
        try {
            const payments = database.readTable('payments');
            const index = payments.findIndex(p => p.id === paymentId);

            if (index === -1) {
                throw new Error('Платеж не найден');
            }

            if (payments[index].status === 'success') {
                return payments[index];
            }

            payments[index].status = 'success';
            payments[index].gateway_payment_id = gatewayPaymentId || payments[index].gateway_payment_id;
            
            const existingMeta = payments[index].meta_data ? JSON.parse(payments[index].meta_data) : {};
            payments[index].meta_data = JSON.stringify({ ...existingMeta, ...metaData });
            payments[index].updated_at = database.now();

            database.writeTable('payments', payments);

            if (payments[index].user_id) {
                await this.grantAccessToCourses(payments[index].user_id, payments[index].amount);
            }

            logger.info(`Payment confirmed: ${paymentId}`);
            return payments[index];
        } catch (error) {
            logger.error('Error confirming payment:', error);
            throw error;
        }
    }

    // ============================================================
    // ПРЕДОСТАВЛЕНИЕ ДОСТУПА К КУРСАМ
    // ============================================================

    async grantAccessToCourses(userId, amount) {
        try {
            const courses = database.readTable('courses');
            const access = database.readTable('user_course_access');
            
            const paidCourses = courses.filter(c => 
                c.price > 0 && 
                c.is_active !== false &&
                parseFloat(c.price) <= parseFloat(amount)
            );

            let grantedCount = 0;
            for (const course of paidCourses) {
                const exists = access.find(a => 
                    String(a.user_id) === String(userId) && 
                    a.course_id === course.id
                );
                if (!exists) {
                    access.push({
                        id: database.generateId(),
                        user_id: String(userId),
                        course_id: course.id,
                        granted_at: database.now(),
                    });
                    grantedCount++;
                }
            }

            if (grantedCount > 0) {
                database.writeTable('user_course_access', access);
                logger.info(`Access granted for user ${userId} to ${grantedCount} courses`);
            }

            return grantedCount;
        } catch (error) {
            logger.error('Error granting access:', error);
            return 0;
        }
    }

    // ============================================================
    // ОТМЕНА ПЛАТЕЖА
    // ============================================================

    async failPayment(paymentId, reason = null) {
        try {
            const payments = database.readTable('payments');
            const index = payments.findIndex(p => p.id === paymentId);

            if (index === -1) return null;

            payments[index].status = 'failed';
            const existingMeta = payments[index].meta_data ? JSON.parse(payments[index].meta_data) : {};
            payments[index].meta_data = JSON.stringify({ ...existingMeta, fail_reason: reason });
            payments[index].updated_at = database.now();

            database.writeTable('payments', payments);
            logger.info(`Payment failed: ${paymentId}, reason: ${reason}`);
            return payments[index];
        } catch (error) {
            logger.error('Error failing payment:', error);
            throw error;
        }
    }

    // ============================================================
    // ПОЛУЧЕНИЕ ИНФОРМАЦИИ О ПЛАТЕЖАХ
    // ============================================================

    async getPaymentById(paymentId) {
        try {
            const payments = database.readTable('payments');
            return payments.find(p => p.id === paymentId) || null;
        } catch (error) {
            logger.error('Error getting payment by id:', error);
            return null;
        }
    }

    async getPaymentByGatewayId(gatewayPaymentId) {
        try {
            const payments = database.readTable('payments');
            return payments.find(p => p.gateway_payment_id === gatewayPaymentId) || null;
        } catch (error) {
            logger.error('Error getting payment by gateway id:', error);
            return null;
        }
    }

    async getUserPayments(userId) {
        try {
            const payments = database.readTable('payments');
            return payments
                .filter(p => String(p.user_id) === String(userId))
                .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        } catch (error) {
            logger.error('Error getting user payments:', error);
            return [];
        }
    }

    async getUserSuccessfulPayments(userId) {
        try {
            const payments = database.readTable('payments');
            return payments
                .filter(p => String(p.user_id) === String(userId) && p.status === 'success')
                .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        } catch (error) {
            logger.error('Error getting user successful payments:', error);
            return [];
        }
    }

    async getTotalPaidByUser(userId) {
        try {
            const payments = await this.getUserSuccessfulPayments(userId);
            return payments.reduce((sum, p) => sum + parseFloat(p.amount || 0), 0);
        } catch (error) {
            logger.error('Error getting total paid by user:', error);
            return 0;
        }
    }

    async getAllPayments(page = 1, limit = 50, status = null) {
        try {
            let payments = database.readTable('payments');
            
            if (status) {
                payments = payments.filter(p => p.status === status);
            }

            const users = database.readTable('users');
            
            const enriched = payments
                .map(p => {
                    const user = users.find(u => String(u.id) === String(p.user_id));
                    return {
                        ...p,
                        meta_data: p.meta_data ? JSON.parse(p.meta_data) : {},
                        user_name: user ? `${user.first_name || ''} ${user.last_name || ''}`.trim() || user?.login || 'Неизвестно' : 'Неизвестно',
                    };
                })
                .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

            const offset = (page - 1) * limit;

            return {
                payments: enriched.slice(offset, offset + limit),
                total: payments.length,
                page,
                limit,
                totalPages: Math.ceil(payments.length / limit),
                stats: {
                    total_amount: enriched.reduce((sum, p) => sum + parseFloat(p.amount || 0), 0),
                    successful: enriched.filter(p => p.status === 'success').length,
                    pending: enriched.filter(p => p.status === 'pending').length,
                    failed: enriched.filter(p => p.status === 'failed').length,
                },
            };
        } catch (error) {
            logger.error('Error getting all payments:', error);
            return { payments: [], total: 0, page, limit, totalPages: 0, stats: { total_amount: 0, successful: 0, pending: 0, failed: 0 } };
        }
    }

    // ============================================================
    // ПРОВЕРКА СТАТУСА ПЛАТЕЖА
    // ============================================================

    async checkPaymentStatus(paymentId) {
        try {
            const payment = await this.getPaymentById(paymentId);
            if (!payment) {
                return { status: 'not_found', payment: null };
            }

            if (payment.status === 'success' || payment.status === 'failed') {
                return { status: payment.status, payment };
            }

            if (payment.payment_gateway !== 'manual') {
                try {
                    const gatewayStatus = await this.checkGatewayStatus(payment);
                    if (gatewayStatus === 'success') {
                        await this.confirmPayment(paymentId);
                        return { status: 'success', payment: await this.getPaymentById(paymentId) };
                    } else if (gatewayStatus === 'failed') {
                        await this.failPayment(paymentId);
                        return { status: 'failed', payment: await this.getPaymentById(paymentId) };
                    }
                } catch (error) {
                    logger.error('Gateway status check error:', error);
                }
            }

            return { status: payment.status, payment };
        } catch (error) {
            logger.error('Error checking payment status:', error);
            return { status: 'error', payment: null };
        }
    }

    async checkGatewayStatus(payment) {
        try {
            const gateway = payment.payment_gateway;
            
            switch (gateway) {
                case 'yookassa':
                    return await this.checkYooKassaStatus(payment);
                case 'stripe':
                    return await this.checkStripeStatus(payment);
                default:
                    return payment.status;
            }
        } catch (error) {
            logger.error('Gateway status check error:', error);
            return payment.status;
        }
    }

    async checkYooKassaStatus(payment) {
        try {
            const yookassaConfig = config.payment?.yookassa || {};
            
            if (!yookassaConfig.shopId || !yookassaConfig.secretKey) {
                return payment.status;
            }

            const auth = Buffer.from(`${yookassaConfig.shopId}:${yookassaConfig.secretKey}`).toString('base64');
            
            const response = await axios.get(
                `https://api.yookassa.ru/v3/payments/${payment.gateway_payment_id}`,
                {
                    headers: {
                        'Authorization': `Basic ${auth}`,
                    },
                    timeout: 10000,
                }
            );

            if (response.data && response.data.status) {
                const status = response.data.status;
                if (status === 'succeeded' || status === 'waiting_for_capture') {
                    return 'success';
                } else if (status === 'canceled') {
                    return 'failed';
                }
                return 'pending';
            }

            return payment.status;
        } catch (error) {
            logger.error('YooKassa status check error:', error);
            return payment.status;
        }
    }

    async checkStripeStatus(payment) {
        try {
            const stripeConfig = config.payment?.stripe || {};
            
            if (!stripeConfig.secretKey) {
                return payment.status;
            }

            const response = await axios.get(
                `https://api.stripe.com/v1/checkout/sessions/${payment.gateway_payment_id}`,
                {
                    headers: {
                        'Authorization': `Bearer ${stripeConfig.secretKey}`,
                    },
                    timeout: 10000,
                }
            );

            if (response.data && response.data.payment_status) {
                if (response.data.payment_status === 'paid') {
                    return 'success';
                }
                return 'pending';
            }

            return payment.status;
        } catch (error) {
            logger.error('Stripe status check error:', error);
            return payment.status;
        }
    }

    // ============================================================
    // СТАТИСТИКА ПЛАТЕЖЕЙ
    // ============================================================

    async getPaymentStats(startDate = null, endDate = null) {
        try {
            let payments = database.readTable('payments');
            
            if (startDate) {
                payments = payments.filter(p => p.created_at >= startDate);
            }
            if (endDate) {
                payments = payments.filter(p => p.created_at <= endDate);
            }

            const successful = payments.filter(p => p.status === 'success');
            const pending = payments.filter(p => p.status === 'pending');
            const failed = payments.filter(p => p.status === 'failed');

            return {
                total_payments: payments.length,
                successful_count: successful.length,
                pending_count: pending.length,
                failed_count: failed.length,
                total_amount: successful.reduce((sum, p) => sum + parseFloat(p.amount || 0), 0),
                average_amount: successful.length > 0 
                    ? successful.reduce((sum, p) => sum + parseFloat(p.amount || 0), 0) / successful.length 
                    : 0,
                by_gateway: this.groupPaymentsByGateway(payments),
                by_date: this.groupPaymentsByDate(payments),
            };
        } catch (error) {
            logger.error('Error getting payment stats:', error);
            return null;
        }
    }

    groupPaymentsByGateway(payments) {
        const groups = {};
        for (const p of payments) {
            const gateway = p.payment_gateway || 'manual';
            if (!groups[gateway]) {
                groups[gateway] = { total: 0, successful: 0, amount: 0 };
            }
            groups[gateway].total++;
            if (p.status === 'success') {
                groups[gateway].successful++;
                groups[gateway].amount += parseFloat(p.amount || 0);
            }
        }
        return groups;
    }

    groupPaymentsByDate(payments) {
        const groups = {};
        for (const p of payments) {
            const date = p.created_at ? p.created_at.split('T')[0] : 'unknown';
            if (!groups[date]) {
                groups[date] = { total: 0, successful: 0, amount: 0 };
            }
            groups[date].total++;
            if (p.status === 'success') {
                groups[date].successful++;
                groups[date].amount += parseFloat(p.amount || 0);
            }
        }
        return groups;
    }
}

module.exports = new PaymentService();
