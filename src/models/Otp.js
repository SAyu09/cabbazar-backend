// src/models/Otp.js - Separate OTP Collection
import mongoose from 'mongoose';

const otpSchema = new mongoose.Schema({
  phoneNumber: {
    type: String,
    required: [true, 'Phone number is required'],
    trim: true,
    validate: {
      validator: function(v) {
        // Remove any spaces, hyphens, or plus signs
        const cleaned = v.replace(/[\s\-+]/g, '');
        // Check if it's a valid Indian number (with or without country code)
        return /^(91)?[6-9]\d{9}$/.test(cleaned);
      },
      message: 'Please provide a valid Indian phone number'
    }
  },
  code: {
    type: String,
    required: true
  },
  expiresAt: {
    type: Date,
    required: true,
    index: { expires: 0 } // TTL index - auto delete when expired
  },
  attempts: {
    type: Number,
    default: 0
  },
  lastRequestedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Index for faster lookups
otpSchema.index({ phoneNumber: 1 });
otpSchema.index({ expiresAt: 1 });

// Static method to clean up expired OTPs manually (backup to TTL)
otpSchema.statics.cleanExpired = function() {
  return this.deleteMany({ expiresAt: { $lt: new Date() } });
};

export const Otp = mongoose.model('Otp', otpSchema);
