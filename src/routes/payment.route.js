import express from 'express';
import * as paymentController from '../controllers/payment.controller.js';

const router = express.Router();

/**
 * @route   POST /api/payments/webhook
 * @desc    Razorpay webhook listener
 * @access  Public
 */
router.post(
  '/webhook',
  // We MUST use express.raw() to get the raw body for signature verification
  // This must come *before* express.json()
  (req, res, next) => {
    express.raw({ type: 'application/json' })(req, res, (err) => {
      if (err) return next(err);
      try {
        // Store raw body
        req.rawBody = req.body;
        // Parse it as JSON for the controller to use
        req.body = JSON.parse(req.body.toString());
      } catch (parseError) {
        // Handle invalid JSON payload
        return next(new Error('Invalid JSON payload for webhook'));
      }
      next();
    });
  },
  paymentController.handleRazorpayWebhook
);

export default router;
