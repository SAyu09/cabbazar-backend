import paymentService from '../services/payment.service.js';
import Booking from '../models/Booking.js';
import Payment from '../models/Payment.js'; // Import Payment model
import { catchAsync } from '../utils/catchAsync.js';
import { BadRequestError } from '../utils/customError.js';
import {
  BOOKING_STATUS,
  PAYMENT_STATUS,
  PAYMENT_METHODS,
} from '../config/constants.js';
import logger from '../config/logger.js';
import { sendBookingNotification } from '../utils/notification.utils.js';
import User from '../models/User.js';

/**
 * @desc    Handle Razorpay Webhooks
 * @route   POST /api/payments/webhook
 * @access  Public (Secured by signature)
 */
export const handleRazorpayWebhook = catchAsync(async (req, res) => {
  const signature = req.headers['x-razorpay-signature'];
  const rawBody = req.rawBody; // We get this from express.raw() middleware

  if (!signature) {
    throw new BadRequestError('Missing Razorpay signature');
  }

  // 1. Verify Webhook Signature
  const isValid = paymentService.verifyWebhookSignature(rawBody, signature);
  if (!isValid) {
    throw new BadRequestError('Invalid webhook signature');
  }

  // 2. Process the event
  const event = req.body.event;
  const payload = req.body.payload;

  logger.info(`Processing Razorpay webhook event: ${event}`, { event });

  // 3. Handle 'payment.captured' or 'order.paid'
  if (event === 'payment.captured' || event === 'order.paid') {
    const razorpayPayment = payload.payment.entity;
    const razorpayOrder = payload.order.entity;
    
    // Find Payment doc by razorpayOrderId
    const payment = await Payment.findOne({
      razorpayOrderId: razorpayOrder.id,
    });

    if (!payment) {
      logger.warn('Webhook: Payment doc not found for razorpayOrderId', {
        razorpayOrderId: razorpayOrder.id,
      });
      return res
        .status(200)
        .json({ status: 'ok', message: 'Ignored: Payment not found' });
    }

    // 4. Idempotency Check: Only update if payment is PENDING
    if (payment.status === PAYMENT_STATUS.PENDING) {
      const booking = await Booking.findById(payment.bookingId);
      if (!booking) {
         logger.error('Webhook: Booking reference missing or not found', {
           paymentId: payment._id,
           bookingId: payment.bookingId
         });
         return res.status(200).json({ status: 'ok', message: 'Ignored: Booking missing' });
      }

      // 5. Update Payment Document
      payment.status = PAYMENT_STATUS.COMPLETED;
      payment.razorpayPaymentId = razorpayPayment.id;
      if (razorpayPayment.method === 'card') payment.method = PAYMENT_METHODS.CARD;
      else if (razorpayPayment.method === 'upi') payment.method = PAYMENT_METHODS.UPI;
      else if (razorpayPayment.method === 'wallet') payment.method = PAYMENT_METHODS.WALLET;
      else if (razorpayPayment.method === 'netbanking') payment.method = PAYMENT_METHODS.NET_BANKING;
      await payment.save();

      // 6. Update Booking Document
      booking.status = BOOKING_STATUS.CONFIRMED;
      await booking.save();

      logger.info('Webhook: Booking confirmed successfully', {
        bookingId: booking.bookingId,
        paymentId: payment._id,
      });

      // 7. Send Notification
      const user = await User.findById(booking.userId).select('deviceInfo');
      if (user?.deviceInfo?.length > 0) {
        const fcmToken = user.deviceInfo[0].fcmToken;
        if (fcmToken) {
          sendBookingNotification(
            fcmToken,
            booking.bookingId,
            'confirmed',
            `Your payment was successful! Booking ${booking.bookingId} is confirmed.`
          ).catch(err => logger.error('Webhook notification failed', { err: err.message }));
        }
      }
    } else {
      logger.info('Webhook: Payment already processed, skipping update', {
        paymentId: payment._id,
        status: payment.status,
      });
    }
  }

  // Handle failed payments
  if (event === 'payment.failed') {
     const razorpayPayment = payload.payment.entity;
     const razorpayOrder = payload.order.entity;
     const payment = await Payment.findOne({
       razorpayOrderId: razorpayOrder.id,
     }).populate('bookingId');
     
     if (payment && payment.status === PAYMENT_STATUS.PENDING) {
       payment.status = PAYMENT_STATUS.FAILED;
       payment.failureReason = razorpayPayment.error_description || 'Payment failed at gateway';
       await payment.save();
       
       if (payment.bookingId && payment.bookingId.status === BOOKING_STATUS.PENDING) {
         payment.bookingId.status = BOOKING_STATUS.REJECTED;
         await payment.bookingId.save();
       }
       logger.warn('Webhook: Payment failed and booking rejected', {
         bookingId: payment.bookingId?.bookingId,
         paymentId: payment._id
       });
     }
  }

  // Acknowledge the webhook
  res.status(200).json({ status: 'ok' });
});

