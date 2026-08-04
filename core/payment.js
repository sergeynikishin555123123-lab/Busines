const database = require('../database');
const logger = require('../logger');
const config = require('../config');

class PaymentService {
  async createPayment(userId, amount, gateway = null) {
    const paymentGateway = gateway || config.payment.defaultGateway;
    
    const result = await database.query(
      `INSERT INTO payments (user_id, amount, payment_gateway, status) 
       VALUES ($1, $2, $3, 'pending') RETURNING *`,
      [userId, amount, paymentGateway]
    );

    logger.info(`Payment created: ${result.rows[0].id}, amount: ${amount}, gateway: ${paymentGateway}`);
    return result.rows[0];
  }

  async confirmPayment(paymentId, gatewayPaymentId, metaData = {}) {
    const result = await database.query(
      `UPDATE payments 
       SET status = 'success', 
           gateway_payment_id = $1, 
           meta_data = $2,
           updated_at = NOW() 
       WHERE id = $3 
       RETURNING *`,
      [gatewayPaymentId, JSON.stringify(metaData), paymentId]
    );

    if (result.rows.length === 0) {
      throw new Error('Платеж не найден');
    }

    const payment = result.rows[0];

    if (payment.user_id) {
      const courses = await database.query(
        'SELECT * FROM courses WHERE price > 0 AND is_active = true ORDER BY price ASC'
      );

      for (const course of courses.rows) {
        if (payment.amount >= parseFloat(course.price)) {
          await database.query(
            `INSERT INTO user_course_access (user_id, course_id) 
             VALUES ($1, $2) 
             ON CONFLICT (user_id, course_id) DO NOTHING`,
            [payment.user_id, course.id]
          );
          logger.info(`Course access granted via payment: user=${payment.user_id}, course=${course.id}`);
        }
      }
    }

    return payment;
  }

  async failPayment(paymentId, metaData = {}) {
    const result = await database.query(
      `UPDATE payments 
       SET status = 'failed', 
           meta_data = $1,
           updated_at = NOW() 
       WHERE id = $2 
       RETURNING *`,
      [JSON.stringify(metaData), paymentId]
    );
    return result.rows[0];
  }

  async getPaymentById(paymentId) {
    const result = await database.query('SELECT * FROM payments WHERE id = $1', [paymentId]);
    return result.rows[0] || null;
  }

  async getPaymentByGatewayId(gatewayPaymentId) {
    const result = await database.query(
      'SELECT * FROM payments WHERE gateway_payment_id = $1',
      [gatewayPaymentId]
    );
    return result.rows[0] || null;
  }

  async getUserPayments(userId) {
    const result = await database.query(
      'SELECT * FROM payments WHERE user_id = $1 ORDER BY created_at DESC',
      [userId]
    );
    return result.rows;
  }

  async getAllPayments(page = 1, limit = 50) {
    const offset = (page - 1) * limit;
    const result = await database.query(
      `SELECT p.*, u.first_name, u.last_name, u.platform 
       FROM payments p 
       LEFT JOIN users u ON p.user_id = u.id 
       ORDER BY p.created_at DESC 
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    
    const countResult = await database.query('SELECT COUNT(*) as total FROM payments');
    
    return {
      payments: result.rows,
      total: parseInt(countResult.rows[0].total),
      page,
      limit,
    };
  }

  async handleWebhook(gateway, data) {
    logger.info(`Payment webhook received from ${gateway}`, data);
    
    switch (gateway) {
      case 'vkpay':
        return this.handleVkPayWebhook(data);
      case 'yookassa':
        return this.handleYooKassaWebhook(data);
      case 'cloudpayments':
        return this.handleCloudPaymentsWebhook(data);
      default:
        throw new Error(`Unknown payment gateway: ${gateway}`);
    }
  }

  async handleVkPayWebhook(data) {
    if (data.status === 'success' && data.transaction_id) {
      const payment = await this.getPaymentByGatewayId(data.transaction_id);
      if (!payment) {
        const newPayment = await database.query(
          `INSERT INTO payments (user_id, amount, payment_gateway, gateway_payment_id, status, meta_data) 
           VALUES ($1, $2, 'vkpay', $3, 'success', $4) RETURNING *`,
          [data.user_id, data.amount, data.transaction_id, JSON.stringify(data)]
        );
        return newPayment.rows[0];
      }
      return this.confirmPayment(payment.id, data.transaction_id, data);
    }
    return null;
  }

  async handleYooKassaWebhook(data) {
    if (data.event === 'payment.succeeded' && data.object) {
      const paymentId = data.object.id;
      const payment = await this.getPaymentByGatewayId(paymentId);
      if (payment) {
        return this.confirmPayment(payment.id, paymentId, data.object);
      }
    }
    return null;
  }

  async handleCloudPaymentsWebhook(data) {
    if (data.Status === 'Completed' && data.TransactionId) {
      const payment = await this.getPaymentByGatewayId(data.TransactionId);
      if (payment) {
        return this.confirmPayment(payment.id, data.TransactionId, data);
      }
    }
    return null;
  }
}

module.exports = new PaymentService();
