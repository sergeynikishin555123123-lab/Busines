const database = require('../database');
const logger = require('../logger');
const config = require('../config');

class PaymentService {
  async createPayment(userId, amount, gateway = null) {
    const payments = database.readTable('payments');
    const paymentGateway = gateway || config.payment.defaultGateway;
    
    const payment = {
      id: database.generateId(),
      user_id: userId,
      amount: parseFloat(amount),
      currency: 'RUB',
      status: 'pending',
      payment_gateway: paymentGateway,
      gateway_payment_id: null,
      meta_data: null,
      created_at: database.now(),
      updated_at: database.now(),
    };

    payments.push(payment);
    database.writeTable('payments', payments);

    logger.info(`Payment created: ${payment.id}, amount: ${amount}, gateway: ${paymentGateway}`);
    return payment;
  }

  async confirmPayment(paymentId, gatewayPaymentId, metaData = {}) {
    const payments = database.readTable('payments');
    const index = payments.findIndex(p => p.id === paymentId);

    if (index === -1) throw new Error('Платеж не найден');

    payments[index].status = 'success';
    payments[index].gateway_payment_id = gatewayPaymentId;
    payments[index].meta_data = JSON.stringify(metaData);
    payments[index].updated_at = database.now();

    database.writeTable('payments', payments);

    if (payments[index].user_id) {
      const courses = database.readTable('courses').filter(c => c.price > 0 && c.is_active);
      const access = database.readTable('user_course_access');

      for (const course of courses) {
        if (payments[index].amount >= parseFloat(course.price)) {
          const exists = access.find(a => a.user_id === payments[index].user_id && a.course_id === course.id);
          if (!exists) {
            access.push({
              id: database.generateId(),
              user_id: payments[index].user_id,
              course_id: course.id,
              granted_at: database.now(),
            });
          }
        }
      }

      database.writeTable('user_course_access', access);
    }

    return payments[index];
  }

  async failPayment(paymentId, metaData = {}) {
    const payments = database.readTable('payments');
    const index = payments.findIndex(p => p.id === paymentId);

    if (index === -1) return null;

    payments[index].status = 'failed';
    payments[index].meta_data = JSON.stringify(metaData);
    payments[index].updated_at = database.now();

    database.writeTable('payments', payments);
    return payments[index];
  }

  async getPaymentById(paymentId) {
    const payments = database.readTable('payments');
    return payments.find(p => p.id === paymentId) || null;
  }

  async getPaymentByGatewayId(gatewayPaymentId) {
    const payments = database.readTable('payments');
    return payments.find(p => p.gateway_payment_id === gatewayPaymentId) || null;
  }

  async getUserPayments(userId) {
    const payments = database.readTable('payments');
    return payments.filter(p => p.user_id === userId).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }

  async getAllPayments(page = 1, limit = 50) {
    const payments = database.readTable('payments');
    const users = database.readTable('users');
    
    const enriched = payments
      .map(p => {
        const user = users.find(u => u.id === p.user_id);
        return {
          ...p,
          first_name: user ? user.first_name : null,
          last_name: user ? user.last_name : null,
        };
      })
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    const offset = (page - 1) * limit;

    return {
      payments: enriched.slice(offset, offset + limit),
      total: payments.length,
      page,
      limit,
    };
  }

  async handleWebhook(gateway, data) {
    logger.info(`Payment webhook received from ${gateway}`, data);
    return null;
  }
}

module.exports = new PaymentService();
