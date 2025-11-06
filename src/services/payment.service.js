// src/services/payment.service.js - Razorpay Service
import Razorpay from 'razorpay';
import crypto from 'crypto';
import logger from '../config/logger.js';
import { ServiceUnavailableError } from '../utils/customError.js';

class PaymentService {
  constructor() {
    if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
      logger.error('Razorpay KEY_ID or KEY_SECRET is not defined');
      throw new Error('Razorpay credentials are not configured.');
    }

    try {
      this.razorpay = new Razorpay({
        key_id: process.env.RAZORPAY_KEY_ID,
        key_secret: process.env.RAZORPAY_KEY_SECRET,
      });
      logger.info('Razorpay service initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize Razorpay service', { error: error.message });
      throw new ServiceUnavailableError('Payment service could not be started.');
    }
  }

  /**
   * Create a new Razorpay order
   * @param {number} amount - Amount in *paise*
   * @param {string} receiptId - A unique receipt ID
   * @param {object} notes - Any notes to attach (e.g., bookingDbId)
   * @returns {Promise<object>} Razorpay order object
   */
  async createOrder(amount, receiptId, notes = {}) {
    try {
      const options = {
        amount, // amount in the smallest currency unit (paise)
        currency: 'INR',
        receipt: receiptId,
        notes,
      };
      
      const order = await this.razorpay.orders.create(options);
      
      logger.info('Razorpay order created successfully', { orderId: order.id, receiptId });
      return order;
    } catch (error) {
      logger.error('Failed to create Razorpay order', {
        error: error.message,
        receiptId,
        amount,
      });
      throw new ServiceUnavailableError(`Failed to create payment order: ${error.message}`);
    }
  }

  /**
   * Verify Razorpay payment signature (from client)
   * @param {string} order_id - Razorpay Order ID
   * @param {string} payment_id - Razorpay Payment ID
   * @param {string} signature - Razorpay Signature
   * @returns {boolean} True if signature is valid
   */
  verifyPaymentSignature(order_id, payment_id, signature) {
    try {
      const body = `${order_id}|${payment_id}`;
      
      const expectedSignature = crypto
        .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
        .update(body.toString())
        .digest('hex');
      
      const isValid = expectedSignature === signature;
      
      if (!isValid) {
        logger.warn('Invalid payment signature received from client', { order_id, payment_id });
      }
      
      return isValid;
    } catch (error) {
      logger.error('Error verifying payment signature', { error: error.message, order_id });
      return false;
    }
  }

  /**
   * Verify Razorpay webhook signature
   * @param {string} rawBody - The raw request body
   * @param {string} signature - The signature from 'x-razorpay-signature' header
   * @returns {boolean} True if signature is valid
   */
  verifyWebhookSignature(rawBody, signature) {
    try {
      const expectedSignature = crypto
        .createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET)
        .update(rawBody.toString())
        .digest('hex');
      
      const isValid = expectedSignature === signature;
      
      if (!isValid) {
        logger.warn('Invalid Razorpay webhook signature');
      }
      
      return isValid;
    } catch (error) {
      logger.error('Error verifying webhook signature', { error: error.message });
      return false;
    }
  }

  /**
   * Create a refund
   * @param {string} paymentId - Razorpay Payment ID
   * @param {number} amount - Amount in *paise*
   * @returns {Promise<object>} Refund entity
   */
  async createRefund(paymentId, amount) {
    try {
      const refund = await this.razorpay.payments.refund(paymentId, {
        amount,
        speed: 'optimum',
      });
      logger.info('Refund created successfully', { paymentId, refundId: refund.id });
      return refund;
    } catch (error) {
      logger.error('Failed to create refund', { error: error.message, paymentId, amount });
      throw new ServiceUnavailableError(`Failed to process refund: ${error.message}`);
    }
  }
}

export default new PaymentService();
