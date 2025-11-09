// src/services/payment.service.js
import Razorpay from 'razorpay';
import crypto from 'crypto';
import logger from '../config/logger.js';
import { ServiceUnavailableError, BadRequestError } from '../utils/customError.js';

class PaymentService {
  constructor() {
    this.initializeRazorpay();
    this.transactionCount = 0;
    this.successCount = 0;
    this.failureCount = 0;
  }

  /**
   * Initialize Razorpay client
   */
  initializeRazorpay() {
    if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
      logger.error('Razorpay credentials not configured', {
        hasKeyId: !!process.env.RAZORPAY_KEY_ID,
        hasKeySecret: !!process.env.RAZORPAY_KEY_SECRET
      });
      throw new Error('Razorpay credentials are not configured');
    }

    try {
      this.razorpay = new Razorpay({
        key_id: process.env.RAZORPAY_KEY_ID,
        key_secret: process.env.RAZORPAY_KEY_SECRET,
      });

      logger.info('Razorpay service initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize Razorpay service', {
        error: error.message,
        stack: error.stack
      });
      throw new ServiceUnavailableError('Payment service could not be started');
    }
  }

  /**
   * Validate amount
   */
  validateAmount(amount, context = '') {
    if (amount === null || amount === undefined) {
      throw new BadRequestError(`Amount is required${context ? ` (${context})` : ''}`);
    }

    if (typeof amount !== 'number' || isNaN(amount)) {
      throw new BadRequestError(`Amount must be a valid number${context ? ` (${context})` : ''}`);
    }

    if (amount <= 0) {
      throw new BadRequestError(`Amount must be greater than zero${context ? ` (${context})` : ''}`);
    }

    if (amount > 10000000) { // 1 crore paise = 10 lakh rupees
      throw new BadRequestError(`Amount exceeds maximum limit${context ? ` (${context})` : ''}`);
    }

    return Math.round(amount);
  }

  /**
   * Validate receipt ID
   */
  validateReceiptId(receiptId, context = '') {
    if (!receiptId || typeof receiptId !== 'string') {
      throw new BadRequestError(`Receipt ID is required${context ? ` (${context})` : ''}`);
    }

    const cleanId = receiptId.trim();

    if (cleanId.length === 0) {
      throw new BadRequestError(`Receipt ID cannot be empty${context ? ` (${context})` : ''}`);
    }

    if (cleanId.length > 40) {
      throw new BadRequestError(`Receipt ID too long (max 40 characters)${context ? ` (${context})` : ''}`);
    }

    if (!/^[a-zA-Z0-9_-]+$/.test(cleanId)) {
      throw new BadRequestError(`Receipt ID contains invalid characters${context ? ` (${context})` : ''}`);
    }

    return cleanId;
  }

  /**
   * Create a new Razorpay order
   * @param {number} amount - Amount in paise
   * @param {string} receiptId - Unique receipt ID
   * @param {object} notes - Additional notes
   * @returns {Promise<object>} Razorpay order object
   */
  async createOrder(amount, receiptId, notes = {}) {
    try {
      const validAmount = this.validateAmount(amount, 'create order');
      const validReceiptId = this.validateReceiptId(receiptId, 'create order');

      // Validate notes
      if (notes && typeof notes !== 'object') {
        throw new BadRequestError('Notes must be an object');
      }

      const cleanNotes = notes || {};

      const options = {
        amount: validAmount,
        currency: 'INR',
        receipt: validReceiptId,
        notes: cleanNotes,
      };

      const order = await this.razorpay.orders.create(options);

      this.transactionCount++;

      logger.info('Razorpay order created successfully', {
        orderId: order.id,
        receiptId: validReceiptId,
        amount: validAmount
      });

      return order;
    } catch (error) {
      if (error instanceof BadRequestError) {
        throw error;
      }

      logger.error('Failed to create Razorpay order', {
        error: error.message,
        stack: error.stack,
        receiptId,
        amount,
        razorpayError: error.error
      });

      if (error.statusCode === 400) {
        throw new BadRequestError(`Invalid order parameters: ${error.error?.description || error.message}`);
      }

      if (error.statusCode === 401) {
        throw new ServiceUnavailableError('Payment service authentication failed');
      }

      throw new ServiceUnavailableError(`Failed to create payment order: ${error.message}`);
    }
  }

  /**
   * Verify Razorpay payment signature
   * @param {string} order_id - Razorpay Order ID
   * @param {string} payment_id - Razorpay Payment ID
   * @param {string} signature - Razorpay Signature
   * @returns {boolean} True if signature is valid
   */
  verifyPaymentSignature(order_id, payment_id, signature) {
    try {
      // Validate inputs
      if (!order_id || typeof order_id !== 'string') {
        throw new BadRequestError('Valid order_id is required');
      }

      if (!payment_id || typeof payment_id !== 'string') {
        throw new BadRequestError('Valid payment_id is required');
      }

      if (!signature || typeof signature !== 'string') {
        throw new BadRequestError('Valid signature is required');
      }

      const body = `${order_id}|${payment_id}`;

      const expectedSignature = crypto
        .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
        .update(body.toString())
        .digest('hex');

      const isValid = crypto.timingSafeEqual(
        Buffer.from(expectedSignature),
        Buffer.from(signature)
      );

      if (isValid) {
        this.successCount++;
        logger.info('Payment signature verified successfully', {
          order_id,
          payment_id
        });
      } else {
        this.failureCount++;
        logger.warn('Invalid payment signature', {
          order_id,
          payment_id
        });
      }

      return isValid;
    } catch (error) {
      if (error instanceof BadRequestError) {
        throw error;
      }

      logger.error('Error verifying payment signature', {
        error: error.message,
        stack: error.stack,
        order_id
      });

      this.failureCount++;
      return false;
    }
  }

  /**
   * Verify Razorpay webhook signature
   * @param {string} rawBody - Raw request body
   * @param {string} signature - Signature from header
   * @returns {boolean} True if signature is valid
   */
  verifyWebhookSignature(rawBody, signature) {
    try {
      if (!process.env.RAZORPAY_WEBHOOK_SECRET) {
        logger.error('Razorpay webhook secret not configured');
        throw new ServiceUnavailableError('Webhook verification not configured');
      }

      if (!rawBody || typeof rawBody !== 'string') {
        throw new BadRequestError('Valid raw body is required');
      }

      if (!signature || typeof signature !== 'string') {
        throw new BadRequestError('Valid signature is required');
      }

      const expectedSignature = crypto
        .createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET)
        .update(rawBody.toString())
        .digest('hex');

      const isValid = crypto.timingSafeEqual(
        Buffer.from(expectedSignature),
        Buffer.from(signature)
      );

      if (isValid) {
        logger.info('Webhook signature verified successfully');
      } else {
        logger.warn('Invalid webhook signature');
      }

      return isValid;
    } catch (error) {
      if (error instanceof BadRequestError || error instanceof ServiceUnavailableError) {
        throw error;
      }

      logger.error('Error verifying webhook signature', {
        error: error.message,
        stack: error.stack
      });

      return false;
    }
  }

  /**
   * Create a refund
   * @param {string} paymentId - Razorpay Payment ID
   * @param {number} amount - Amount in paise
   * @returns {Promise<object>} Refund entity
   */
  async createRefund(paymentId, amount) {
    try {
      // Validate payment ID
      if (!paymentId || typeof paymentId !== 'string') {
        throw new BadRequestError('Valid payment ID is required');
      }

      if (!/^pay_[a-zA-Z0-9]+$/.test(paymentId)) {
        throw new BadRequestError('Invalid payment ID format');
      }

      // Validate amount
      const validAmount = this.validateAmount(amount, 'create refund');

      const refundOptions = {
        amount: validAmount,
        speed: 'optimum',
        notes: {
          refundedAt: new Date().toISOString()
        }
      };

      const refund = await this.razorpay.payments.refund(paymentId, refundOptions);

      logger.info('Refund created successfully', {
        paymentId,
        refundId: refund.id,
        amount: validAmount,
        status: refund.status
      });

      return refund;
    } catch (error) {
      if (error instanceof BadRequestError) {
        throw error;
      }

      logger.error('Failed to create refund', {
        error: error.message,
        stack: error.stack,
        paymentId,
        amount,
        razorpayError: error.error
      });

      if (error.statusCode === 400) {
        const errorDesc = error.error?.description || error.message;
        throw new BadRequestError(`Invalid refund parameters: ${errorDesc}`);
      }

      if (error.statusCode === 404) {
        throw new BadRequestError('Payment not found or already refunded');
      }

      if (error.statusCode === 401) {
        throw new ServiceUnavailableError('Payment service authentication failed');
      }

      throw new ServiceUnavailableError(`Failed to process refund: ${error.message}`);
    }
  }

  /**
   * Fetch payment details
   * @param {string} paymentId - Razorpay Payment ID
   * @returns {Promise<object>} Payment details
   */
  async fetchPayment(paymentId) {
    try {
      if (!paymentId || typeof paymentId !== 'string') {
        throw new BadRequestError('Valid payment ID is required');
      }

      if (!/^pay_[a-zA-Z0-9]+$/.test(paymentId)) {
        throw new BadRequestError('Invalid payment ID format');
      }

      const payment = await this.razorpay.payments.fetch(paymentId);

      logger.info('Payment fetched successfully', {
        paymentId,
        status: payment.status,
        amount: payment.amount
      });

      return payment;
    } catch (error) {
      if (error instanceof BadRequestError) {
        throw error;
      }

      logger.error('Failed to fetch payment', {
        error: error.message,
        stack: error.stack,
        paymentId,
        razorpayError: error.error
      });

      if (error.statusCode === 404) {
        throw new BadRequestError('Payment not found');
      }

      if (error.statusCode === 401) {
        throw new ServiceUnavailableError('Payment service authentication failed');
      }

      throw new ServiceUnavailableError(`Failed to fetch payment: ${error.message}`);
    }
  }

  /**
   * Fetch order details
   * @param {string} orderId - Razorpay Order ID
   * @returns {Promise<object>} Order details
   */
  async fetchOrder(orderId) {
    try {
      if (!orderId || typeof orderId !== 'string') {
        throw new BadRequestError('Valid order ID is required');
      }

      if (!/^order_[a-zA-Z0-9]+$/.test(orderId)) {
        throw new BadRequestError('Invalid order ID format');
      }

      const order = await this.razorpay.orders.fetch(orderId);

      logger.info('Order fetched successfully', {
        orderId,
        status: order.status,
        amount: order.amount
      });

      return order;
    } catch (error) {
      if (error instanceof BadRequestError) {
        throw error;
      }

      logger.error('Failed to fetch order', {
        error: error.message,
        stack: error.stack,
        orderId,
        razorpayError: error.error
      });

      if (error.statusCode === 404) {
        throw new BadRequestError('Order not found');
      }

      if (error.statusCode === 401) {
        throw new ServiceUnavailableError('Payment service authentication failed');
      }

      throw new ServiceUnavailableError(`Failed to fetch order: ${error.message}`);
    }
  }

  /**
   * Fetch refund details
   * @param {string} refundId - Razorpay Refund ID
   * @returns {Promise<object>} Refund details
   */
  async fetchRefund(refundId) {
    try {
      if (!refundId || typeof refundId !== 'string') {
        throw new BadRequestError('Valid refund ID is required');
      }

      if (!/^rfnd_[a-zA-Z0-9]+$/.test(refundId)) {
        throw new BadRequestError('Invalid refund ID format');
      }

      const refund = await this.razorpay.refunds.fetch(refundId);

      logger.info('Refund fetched successfully', {
        refundId,
        status: refund.status,
        amount: refund.amount
      });

      return refund;
    } catch (error) {
      if (error instanceof BadRequestError) {
        throw error;
      }

      logger.error('Failed to fetch refund', {
        error: error.message,
        stack: error.stack,
        refundId,
        razorpayError: error.error
      });

      if (error.statusCode === 404) {
        throw new BadRequestError('Refund not found');
      }

      if (error.statusCode === 401) {
        throw new ServiceUnavailableError('Payment service authentication failed');
      }

      throw new ServiceUnavailableError(`Failed to fetch refund: ${error.message}`);
    }
  }

  /**
   * List all payments for an order
   * @param {string} orderId - Razorpay Order ID
   * @returns {Promise<Array>} List of payments
   */
  async fetchOrderPayments(orderId) {
    try {
      if (!orderId || typeof orderId !== 'string') {
        throw new BadRequestError('Valid order ID is required');
      }

      if (!/^order_[a-zA-Z0-9]+$/.test(orderId)) {
        throw new BadRequestError('Invalid order ID format');
      }

      const payments = await this.razorpay.orders.fetchPayments(orderId);

      logger.info('Order payments fetched successfully', {
        orderId,
        count: payments.items?.length || 0
      });

      return payments;
    } catch (error) {
      if (error instanceof BadRequestError) {
        throw error;
      }

      logger.error('Failed to fetch order payments', {
        error: error.message,
        stack: error.stack,
        orderId,
        razorpayError: error.error
      });

      if (error.statusCode === 404) {
        throw new BadRequestError('Order not found');
      }

      if (error.statusCode === 401) {
        throw new ServiceUnavailableError('Payment service authentication failed');
      }

      throw new ServiceUnavailableError(`Failed to fetch order payments: ${error.message}`);
    }
  }

  /**
   * Capture a payment (for authorized payments)
   * @param {string} paymentId - Razorpay Payment ID
   * @param {number} amount - Amount in paise
   * @returns {Promise<object>} Captured payment
   */
  async capturePayment(paymentId, amount) {
    try {
      if (!paymentId || typeof paymentId !== 'string') {
        throw new BadRequestError('Valid payment ID is required');
      }

      if (!/^pay_[a-zA-Z0-9]+$/.test(paymentId)) {
        throw new BadRequestError('Invalid payment ID format');
      }

      const validAmount = this.validateAmount(amount, 'capture payment');

      const capturedPayment = await this.razorpay.payments.capture(
        paymentId,
        validAmount,
        'INR'
      );

      logger.info('Payment captured successfully', {
        paymentId,
        amount: validAmount,
        status: capturedPayment.status
      });

      return capturedPayment;
    } catch (error) {
      if (error instanceof BadRequestError) {
        throw error;
      }

      logger.error('Failed to capture payment', {
        error: error.message,
        stack: error.stack,
        paymentId,
        amount,
        razorpayError: error.error
      });

      if (error.statusCode === 400) {
        throw new BadRequestError(`Payment capture failed: ${error.error?.description || error.message}`);
      }

      if (error.statusCode === 404) {
        throw new BadRequestError('Payment not found');
      }

      if (error.statusCode === 401) {
        throw new ServiceUnavailableError('Payment service authentication failed');
      }

      throw new ServiceUnavailableError(`Failed to capture payment: ${error.message}`);
    }
  }

  /**
   * Get payment statistics
   */
  getStats() {
    return {
      totalTransactions: this.transactionCount,
      successfulVerifications: this.successCount,
      failedVerifications: this.failureCount,
      successRate: this.transactionCount > 0
        ? ((this.successCount / this.transactionCount) * 100).toFixed(2) + '%'
        : '0%'
    };
  }

  /**
   * Health check
   */
  async healthCheck() {
    try {
      // Try to fetch a non-existent order to test API connectivity
      // This will fail but confirm the API is reachable
      await this.razorpay.orders.fetch('order_test_health');
      return {
        status: 'healthy',
        message: 'Service is operational'
      };
    } catch (error) {
      if (error.statusCode === 404) {
        // 404 means API is working, just order not found
        return {
          status: 'healthy',
          message: 'Service is operational'
        };
      }

      if (error.statusCode === 401) {
        return {
          status: 'unhealthy',
          message: 'Authentication failed - check API credentials'
        };
      }

      return {
        status: 'unhealthy',
        message: error.message
      };
    }
  }

  /**
   * Reset statistics (useful for testing)
   */
  resetStats() {
    this.transactionCount = 0;
    this.successCount = 0;
    this.failureCount = 0;
    logger.info('Payment service statistics reset');
  }
}

export default new PaymentService();