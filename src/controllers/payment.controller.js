// src/controllers/payment.controller.js
import paymentService from '../services/payment.service.js';
import Booking from '../models/Booking.js';
import Payment from '../models/Payment.js';
import { catchAsync } from '../utils/catchAsync.js';
import { BadRequestError } from '../utils/customError.js';
import {
  BOOKING_STATUS,
  PAYMENT_STATUS,
  PAYMENT_METHODS,
} from '../config/constants.js';
import logger from '../config/logger.js';
import { sendBookingNotification, sendAdminNotification } from '../utils/notification.utils.js';
import User from '../models/User.js';

/**
 * @desc    Handle Razorpay Webhooks
 * @route   POST /api/payments/webhook
 * @access  Public (Secured by signature)
 */
export const handleRazorpayWebhook = catchAsync(async (req, res) => {
  const signature = req.headers['x-razorpay-signature'];
  const rawBody = req.rawBody;

  if (!signature) throw new BadRequestError('Missing Razorpay signature');

  const isValid = paymentService.verifyWebhookSignature(rawBody, signature);
  if (!isValid) throw new BadRequestError('Invalid webhook signature');

  const event = req.body.event;
  const payload = req.body.payload;

  logger.info(`Processing Razorpay webhook event: ${event}`, { event });

  if (event === 'payment.captured' || event === 'order.paid') {
    const razorpayPayment = payload.payment.entity;
    const razorpayOrder = payload.order.entity;

    const payment = await Payment.findOne({ razorpayOrderId: razorpayOrder.id });

    if (!payment) {
      return res.status(200).json({ status: 'ok', message: 'Ignored: Payment not found' });
    }

    if (payment.status === PAYMENT_STATUS.PENDING) {
      const booking = await Booking.findById(payment.bookingId);
      if (!booking) {
        return res.status(200).json({ status: 'ok', message: 'Ignored: Booking missing' });
      }

      // --- [UPDATED STATUS LOGIC FOR WEBHOOK] ---
      const totalFare = booking.fareDetails.finalAmount;
      const paidAmount = payment.amount;

      if (paidAmount < totalFare) {
        payment.status = PAYMENT_STATUS.ADVANCED;
      } else {
        payment.status = PAYMENT_STATUS.COMPLETED;
      }

      payment.razorpayPaymentId = razorpayPayment.id;
      if (razorpayPayment.method === 'card') payment.method = PAYMENT_METHODS.CARD;
      else if (razorpayPayment.method === 'upi') payment.method = PAYMENT_METHODS.UPI;
      else if (razorpayPayment.method === 'wallet') payment.method = PAYMENT_METHODS.WALLET;
      else if (razorpayPayment.method === 'netbanking') payment.method = PAYMENT_METHODS.NET_BANKING;

      await payment.save();

      booking.status = BOOKING_STATUS.CONFIRMED;
      await booking.save();

      logger.info('Webhook: Booking confirmed successfully', { bookingId: booking.bookingId, paymentStatus: payment.status });

      sendAdminNotification(
        'New Online Booking (Webhook)',
        `Booking ${booking.bookingId} confirmed via webhook. Paid: ${paidAmount}, Status: ${payment.status}`,
        { bookingId: booking.bookingId }
      ).catch(err => logger.error('Failed to send admin notification', { err: err.message }));

      const user = await User.findById(booking.userId).select('deviceInfo');
      if (user?.deviceInfo?.length > 0 && user.deviceInfo[0].fcmToken) {
        sendBookingNotification(user.deviceInfo[0].fcmToken, booking.bookingId, 'confirmed', 'Payment successful! Booking confirmed.')
          .catch(err => logger.error('Webhook notification failed', { err: err.message }));
      }
    }
  }

  if (event === 'payment.failed') {
    const razorpayPayment = payload.payment.entity;
    const razorpayOrder = payload.order.entity;
    const payment = await Payment.findOne({ razorpayOrderId: razorpayOrder.id }).populate('bookingId');

    if (payment && payment.status === PAYMENT_STATUS.PENDING) {
      payment.status = PAYMENT_STATUS.FAILED;
      payment.failureReason = razorpayPayment.error_description || 'Payment failed at gateway';
      await payment.save();

      if (payment.bookingId && payment.bookingId.status === BOOKING_STATUS.PENDING) {
        payment.bookingId.status = BOOKING_STATUS.REJECTED;
        await payment.bookingId.save();
      }
    }
  }

  res.status(200).json({ status: 'ok' });
});