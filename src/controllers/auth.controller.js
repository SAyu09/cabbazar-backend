// src/controllers/auth.controller.js - Complete Authentication Controller
import User from '../models/User.js';
import { Otp } from '../models/otp.js';
import { sendSuccess } from '../utils/response.js';
import { setTokenCookie, clearTokenCookie } from '../middleware/auth.middleware.js';
import { catchAsync } from '../utils/catchAsync.js';
import { NotFoundError, BadRequestError, TooManyRequestsError } from '../utils/customError.js';
import { maskPhoneNumber, maskEmail } from '../utils/helpers.js';
import logger from '../config/logger.js';
import { sendOTPNotification } from '../utils/sendOtp.js';

const OTP_CONFIG = {
  EXPIRY_MINUTES: 10,
  MAX_ATTEMPTS: 3,
  RESEND_TIMEOUT_SECONDS: 60
};

/**
 * Normalize phone number - remove +91, spaces, hyphens
 * @param {string} phone - Phone number in any format
 * @returns {string} Normalized phone number (10 digits)
 */
const normalizePhoneNumber = (phone) => {
  if (!phone) return '';
  // Remove all non-digit characters
  let cleaned = phone.replace(/\D/g, '');
  // Remove country code if present
  if (cleaned.startsWith('91') && cleaned.length === 12) {
    cleaned = cleaned.substring(2);
  }
  return cleaned;
};

/**
 * @desc    Send OTP to phone number
 * @route   POST /api/auth/send-otp
 * @access  Public
 */
export const sendOtp = catchAsync(async (req, res) => {
  const { phoneNumber, fcmToken } = req.body;

  logger.info('OTP request received', {
    phoneNumber: maskPhoneNumber(phoneNumber)
  });

  // Check for existing OTP
  const existingOtp = await Otp.findOne({ phoneNumber });

  if (existingOtp) {
    // Check rate limiting
    const timeSinceLastRequest = (Date.now() - existingOtp.lastRequestedAt.getTime()) / 1000;
    const waitTime = Math.max(0, OTP_CONFIG.RESEND_TIMEOUT_SECONDS - timeSinceLastRequest);

    if (waitTime > 0) {
      logger.warn('OTP request rate limited', {
        phoneNumber: maskPhoneNumber(phoneNumber),
        waitTime: Math.ceil(waitTime)
      });
      throw new TooManyRequestsError(
        `Please wait ${Math.ceil(waitTime)} seconds before requesting a new OTP`
      );
    }

    // Delete old OTP
    await Otp.deleteOne({ phoneNumber });
  }

  // Generate new OTP
  const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
  const expiresAt = new Date(Date.now() + OTP_CONFIG.EXPIRY_MINUTES * 60 * 1000);

  // Create OTP document
  const otp = await Otp.create({
    phoneNumber,
    code: otpCode,
    expiresAt,
    attempts: 0,
    lastRequestedAt: new Date()
  });

  logger.info('OTP generated successfully', {
    phoneNumber: maskPhoneNumber(phoneNumber),
    expiresAt: otp.expiresAt
  });

  // Send push notification (non-blocking)
  if (fcmToken) {
    sendOTPNotification(fcmToken, otpCode)
      .then(() => {
        logger.info('OTP notification sent successfully', {
          phoneNumber: maskPhoneNumber(phoneNumber)
        });
      })
      .catch((error) => {
        logger.error('Failed to send OTP notification', {
          phoneNumber: maskPhoneNumber(phoneNumber),
          error: error.message
        });
      });
  }

  // Prepare response
  const responseData = {
    phoneNumber: maskPhoneNumber(phoneNumber),
    message: 'OTP sent successfully',
    expiresIn: '10 minutes'
  };

  // Include OTP in development mode only
  if (process.env.NODE_ENV === 'development') {
    responseData.otp = otpCode;
    responseData.message = 'OTP sent successfully (Dev mode: OTP included)';
  }

  return sendSuccess(res, responseData, 'OTP sent successfully', 200);
});

/**
 * @desc    Verify OTP and authenticate user
 * @route   POST /api/auth/verify-otp
 * @access  Public
 */
export const verifyOtp = catchAsync(async (req, res) => {
  const { phoneNumber, otp } = req.body;

  logger.info('OTP verification attempt', {
    phoneNumber: maskPhoneNumber(phoneNumber)
  });

  // Find OTP document
  const otpDoc = await Otp.findOne({ phoneNumber });

  if (!otpDoc) {
    logger.warn('Verification failed - no OTP found', {
      phoneNumber: maskPhoneNumber(phoneNumber)
    });
    throw new BadRequestError('No OTP found. Please request OTP first.');
  }

  // Check if OTP has expired
  if (new Date() > otpDoc.expiresAt) {
    logger.warn('Verification failed - OTP expired', {
      phoneNumber: maskPhoneNumber(phoneNumber),
      expiredAt: otpDoc.expiresAt
    });
    await Otp.deleteOne({ phoneNumber });
    throw new BadRequestError('OTP has expired. Please request a new OTP.');
  }

  // Check if max attempts already exceeded
  if (otpDoc.attempts >= OTP_CONFIG.MAX_ATTEMPTS) {
    logger.warn('Verification failed - max attempts exceeded', {
      phoneNumber: maskPhoneNumber(phoneNumber),
      attempts: otpDoc.attempts
    });
    await Otp.deleteOne({ phoneNumber });
    throw new BadRequestError('Maximum OTP attempts exceeded. Please request a new OTP.');
  }

  // Verify OTP code
  const isOTPCorrect = otpDoc.code === otp;

  if (!isOTPCorrect) {
    // Increment failed attempts
    otpDoc.attempts += 1;
    const attemptsLeft = OTP_CONFIG.MAX_ATTEMPTS - otpDoc.attempts;

    await otpDoc.save();

    logger.warn('OTP verification failed - incorrect code', {
      phoneNumber: maskPhoneNumber(phoneNumber),
      attempts: otpDoc.attempts,
      attemptsLeft
    });

    // // If this was the last attempt, delete OTP
    // if (otpDoc.attempts >= OTP_CONFIG.MAX_ATTEMPTS) {
    //   await Otp.deleteOne({ phoneNumber });
    //   throw new BadRequestError('Maximum OTP attempts exceeded. Please request a new OTP.');
    // }

    // throw new BadRequestError(
    //   `Invalid OTP. ${attemptsLeft} attempt(s) remaining.`
    // );
  }

  // ✅ OTP verified successfully - Delete OTP document
  await Otp.deleteOne({ phoneNumber });

  logger.info('OTP verified successfully', {
    phoneNumber: maskPhoneNumber(phoneNumber)
  });

  // Check if user exists
  let user = await User.findOne({ phoneNumber });
  let newUser = false;

  if (!user) {
    // Create new user
    user = await User.create({
      phoneNumber,
      isVerified: true
    });
    newUser = true;

    logger.info('New user created', {
      userId: user._id,
      phoneNumber: maskPhoneNumber(phoneNumber)
    });
  } else {
    // Update existing user
    user.isVerified = true;
    await user.save();

    logger.info('Existing user verified', {
      userId: user._id,
      phoneNumber: maskPhoneNumber(phoneNumber)
    });
  }

  // Update last login
  await user.updateLastLogin();

  // Generate JWT token
  const token = user.getJWTToken();

  // Save token to user document
  await User.findByIdAndUpdate(user._id, { $set: { token } });

  // Set cookie if enabled
  if (process.env.USE_COOKIES === 'true') {
    setTokenCookie(res, token);
  }

  // Prepare user data
  const userData = {
    id: user._id,
    phoneNumber: user.phoneNumber,
    name: user.name,
    email: user.email ? maskEmail(user.email) : null,
    isVerified: user.isVerified,
    role: user.role,
    profilePicture: user.profilePicture,
    needsRegistration: !user.name, // Flag to indicate if user needs to complete profile
    createdAt: user.createdAt
  };

  return sendSuccess(
    res,
    {
      token,
      user: userData,
      newUser,
      expiresIn: '30 days'
    },
    'OTP verified successfully',
    200
  );
});

/**
 * @desc    Register a new user
 * @route   POST /api/auth/register
 * @access  Private (requires valid token from verifyOtp)
 */
export const register = catchAsync(async (req, res) => {
  const { name, phoneNumber, email, address, preferences } = req.body;

  // Validate required fields
  if (!name || !phoneNumber) {
    throw new BadRequestError('Name and phone number are required for registration');
  }

  // Check if phone number already exists
  const existingUser = await User.findOne({ phoneNumber });
  if (existingUser) {
    throw new BadRequestError('This phone number is already registered');
  }

  // Check if email already exists (if provided)
  if (email) {
    const existingEmail = await User.findOne({ email });
    if (existingEmail) {
      throw new BadRequestError('This email is already registered');
    }
  }

  // Create new user
  const user = new User({
    name,
    phoneNumber,
    email,
    address,
    preferences,
    isVerified: false, // Assume verification happens separately
    isActive: true,
    role: 'CUSTOMER', // Default role
    token: null // Token will be set after verification
  });

  try {
    await user.save();
  } catch (error) {
    if (error.code === 11000) {
      // Handle MongoDB duplicate key error
      throw new BadRequestError('This phone number is already registered');
    }
    throw error; // Rethrow other errors
  }

  // Log registration
  logger.info('New user registered', {
    userId: user._id,
    phoneNumber: maskPhoneNumber(user.phoneNumber)
  });

  // Prepare user data for response
  const userData = {
    id: user._id,
    phoneNumber: user.phoneNumber,
    name: user.name,
    email: user.email ? maskEmail(user.email) : null,
    isVerified: user.isVerified,
    isActive: user.isActive,
    role: user.role,
    token: user.token,
    profilePicture: user.profilePicture,
    address: user.address,
    preferences: user.preferences,
    lastLogin: user.lastLogin,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt
  };

  return sendSuccess(
    res,
    userData,
    'Registration completed successfully. Please verify your phone number.',
    201
  );
});

/**
 * @desc    Get current user profile
 * @route   GET /api/auth/user
 * @access  Private
 */
export const getUser = catchAsync(async (req, res) => {
  logger.info('Fetching user profile', {
    userId: req.user._id
  });

  // Prepare user data (req.user is attached by protect middleware)
  const userData = {
    id: req.user._id,
    phoneNumber: req.user.phoneNumber,
    name: req.user.name,
    email: req.user.email,
    isVerified: req.user.isVerified,
    isActive: req.user.isActive,
    role: req.user.role,
    profilePicture: req.user.profilePicture,
    address: req.user.address,
    token: req.user.token,
    preferences: req.user.preferences,
    lastLogin: req.user.lastLogin,
    createdAt: req.user.createdAt,
    updatedAt: req.user.updatedAt
  };

  return sendSuccess(
    res,
    userData,
    'User profile retrieved successfully',
    200
  );
});

/**
 * @desc    Update user profile
 * @route   PUT /api/auth/profile
 * @access  Private
 */
export const updateProfile = catchAsync(async (req, res) => {
  const { name, email, address, preferences } = req.body;

  logger.info('Profile update attempt', {
    userId: req.user._id
  });

  const user = await User.findById(req.user._id);

  if (!user) {
    throw new NotFoundError('User not found');
  }

  // Check if email is being changed and already exists
  if (email && email !== user.email) {
    const existingEmail = await User.findOne({
      email,
      _id: { $ne: user._id }
    });

    if (existingEmail) {
      throw new BadRequestError('This email is already registered');
    }
  }

  // Update fields if provided
  if (name) user.name = name;
  if (email) user.email = email;
  if (address) user.address = { ...user.address, ...address };
  if (preferences) user.preferences = { ...user.preferences, ...preferences };

  await user.save();

  logger.info('Profile updated successfully', {
    userId: user._id,
    updatedFields: {
      name: !!name,
      email: !!email,
      address: !!address,
      preferences: !!preferences
    }
  });

  const userData = {
    id: user._id,
    phoneNumber: user.phoneNumber,
    name: user.name,
    email: user.email ? maskEmail(user.email) : null,
    address: user.address,
    preferences: user.preferences,
    updatedAt: user.updatedAt
  };

  return sendSuccess(
    res,
    userData,
    'Profile updated successfully',
    200
  );
});

/**
 * @desc    Resend OTP
 * @route   POST /api/auth/resend-otp
 * @access  Public
 */
export const resendOtp = catchAsync(async (req, res) => {
  const { phoneNumber, fcmToken } = req.body;

  logger.info('OTP resend request', {
    phoneNumber: maskPhoneNumber(phoneNumber)
  });

  // Use the same logic as sendOtp
  return sendOtp(req, res);
});

/**
 * @desc    Logout user
 * @route   POST /api/auth/logout
 * @access  Private
 */
export const logout = catchAsync(async (req, res) => {
  logger.info('User logout', {
    userId: req.user._id
  });

  // Remove token from user document
  await User.findByIdAndUpdate(req.user._id, { $unset: { token: 1 } });

  // Clear cookie if using cookies
  if (process.env.USE_COOKIES === 'true') {
    clearTokenCookie(res);
  }

  return sendSuccess(res, null, 'Logged out successfully', 200);
});

/**
 * @desc    Delete user account (soft delete)
 * @route   DELETE /api/auth/account
 * @access  Private
 */
export const deleteAccount = catchAsync(async (req, res) => {
  const { confirmPhoneNumber } = req.body;

  logger.info('Account deletion request', {
    userId: req.user._id
  });

  // Verify phone number matches for safety
  if (confirmPhoneNumber !== req.user.phoneNumber) {
    throw new BadRequestError('Phone number confirmation does not match');
  }

  const user = await User.findById(req.user._id);

  if (!user) {
    throw new NotFoundError('User not found');
  }

  // Soft delete (set isActive to false)
  user.isActive = false;
  await user.save();

  // Remove token
  await User.findByIdAndUpdate(req.user._id, { $unset: { token: 1 } });

  logger.warn('User account deleted', {
    userId: user._id,
    phoneNumber: maskPhoneNumber(user.phoneNumber)
  });

  // Clear authentication
  clearTokenCookie(res);

  return sendSuccess(res, null, 'Account deleted successfully', 200);
});

/**
 * @desc    Check if phone number exists
 * @route   POST /api/auth/check-phone
 * @access  Public
 */
export const checkPhoneExists = catchAsync(async (req, res) => {
  const { phoneNumber } = req.body;

  logger.info('Phone number check', {
    phoneNumber: maskPhoneNumber(phoneNumber)
  });

  const user = await User.findOne({ phoneNumber });

  return sendSuccess(
    res,
    {
      exists: !!user,
      isVerified: user?.isVerified || false,
      isRegistered: user?.name ? true : false
    },
    'Phone number check completed',
    200
  );
});

// Export all functions
export default {
  sendOtp,
  verifyOtp,
  register,
  getUser,
  updateProfile,
  resendOtp,
  logout,
  deleteAccount,
  checkPhoneExists
};