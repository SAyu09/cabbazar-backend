import mongoose from 'mongoose';
import { PAYMENT_STATUS, PAYMENT_METHODS } from '../config/constants.js';
import logger from '../config/logger.js';

const paymentSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    bookingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Booking',
      required: true,
      index: true,
    },
    amount: {
      type: Number,
      required: [true, 'Payment amount is required'],
      min: 0,
    },
    currency: {
      type: String,
      required: true,
      default: 'INR',
    },
    status: {
      type: String,
      enum: Object.values(PAYMENT_STATUS),
      default: PAYMENT_STATUS.PENDING,
      index: true,
    },
    method: {
      type: String,
      enum: Object.values(PAYMENT_METHODS),
    },
    // --- Razorpay Specific Fields ---
    razorpayOrderId: {
      type: String,
      index: true,
    },
    razorpayPaymentId: {
      type: String,
      index: true,
    },
    razorpaySignature: {
      type: String,
    },
    receiptId: {
      type: String,
    },
    notes: {
      type: Object,
    },
    failureReason: {
      type: String,
    },
  },
  {
    timestamps: true,
  }
);

paymentSchema.pre('save', function (next) {
  if (this.isModified('status')) {
    logger.info(`Payment status changed for booking ${this.bookingId}`, {
      paymentId: this._id,
      newStatus: this.status,
    });
  }
  next();
});

const Payment = mongoose.model('Payment', paymentSchema);

export default Payment;

