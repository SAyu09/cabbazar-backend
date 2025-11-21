// src/models/User.js - Updated without OTP fields
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';

const userSchema = new mongoose.Schema({
  phoneNumber: {
    type: String,
    required: [true, 'Phone number is required'],
    unique: true,
    trim: true,
    validate: {
      validator: function (v) {
        // Remove any spaces, hyphens, or plus signs
        const cleaned = v.replace(/[\s\-+]/g, '');
        // Check if it's a valid Indian number (with or without country code)
        return /^(91)?[6-9]\d{9}$/.test(cleaned);
      },
      message: 'Please provide a valid Indian phone number'
    }
  },
  name: {
    type: String,
    trim: true,
    minlength: [2, 'Name must be at least 2 characters long'],
    maxlength: [50, 'Name cannot exceed 50 characters']
  },
  email: {
    type: String,
    trim: true,
    lowercase: true,
    match: [/^\S+@\S+\.\S+$/, 'Please provide a valid email address']
  },
  token: {
    type: String,
  },
  isVerified: {
    type: Boolean,
    default: false
  },
  isActive: {
    type: Boolean,
    default: true
  },
  role: {
    type: String,
    enum: ['CUSTOMER', 'DRIVER', 'ADMIN'],
    default: 'CUSTOMER'
  },
  profilePicture: {
    type: String,
    default: null
  },
  address: {
    street: String,
    city: String,
    state: String,
    pincode: String,
    country: {
      type: String,
      default: 'India'
    }
  },
  preferences: {
    language: {
      type: String,
      enum: ['en', 'hi'],
      default: 'en'
    },
    notifications: {
      email: { type: Boolean, default: true },
      sms: { type: Boolean, default: true },
      push: { type: Boolean, default: true }
    }
  },
  lastLogin: {
    type: Date
  },
  // --- [NEW FIELD] ---
  includeTolls: {
    type: Boolean,
    default: false
  },
  fcmToken: String,
  deviceInfo: [{
    deviceId: String,
    deviceType: String,
    //fcmToken: String,
    lastUsed: Date
  }]
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes
userSchema.index({ email: 1 });
userSchema.index({ isActive: 1, isVerified: 1 });
userSchema.index({ createdAt: -1 });

// Virtuals
userSchema.virtual('fullName').get(function () {
  return this.name || 'User';
});

userSchema.virtual('maskedPhone').get(function () {
  if (!this.phoneNumber) return '';
  return 'XXXXXX' + this.phoneNumber.slice(-4);
});

// Instance Methods
userSchema.methods.getJWTToken = function () {
  return jwt.sign(
    { id: this._id },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRE || '30d' }
  );
};

userSchema.methods.updateLastLogin = function () {
  this.lastLogin = new Date();
  return this.save({ validateBeforeSave: false });
};

// Static Methods
userSchema.statics.findByPhoneNumber = function (phoneNumber) {
  return this.findOne({ phoneNumber });
};

userSchema.statics.findVerified = function () {
  return this.find({ isVerified: true, isActive: true });
};

userSchema.statics.countActive = function () {
  return this.countDocuments({ isActive: true });
};

const User = mongoose.model('User', userSchema);

export default User;