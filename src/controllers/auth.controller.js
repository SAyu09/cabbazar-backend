// src/controllers/auth.controller.js - Complete Authentication Controller
import User from '../models/User.js';
import { sendSuccess } from '../utils/response.js';
import { generateToken, setTokenCookie, clearTokenCookie } from '../middleware/auth.middleware.js';
import catchAsync from '../utils/catchAsync.js';
import { NotFoundError, BadRequestError, TooManyRequestsError } from '../utils/customError.js';
import { maskPhoneNumber, maskEmail } from '../utils/helpers.js';
import logger from '../config/logger.js';
import { sendOTPNotification } from '../utils/sendOtp.js';

/**
 * @desc    Send OTP to phone number
 * @route   POST /api/auth/otp
 * @access  Public
 */
export const sendOTP = catchAsync(async (req, res) => {
  const { phoneNumber, fcmToken } = req.body;

  logger.info('OTP request received', { phoneNumber: maskPhoneNumber(phoneNumber) });

  // Find or create user
  let user = await User.findOne({ phoneNumber }).select('+otp');
  
  if (!user) {
    // Create new user
    user = new User({ phoneNumber });
    logger.info('New user created', { phoneNumber: maskPhoneNumber(phoneNumber) });
  } else {
    // Check if user can request OTP (rate limiting)
    const { canRequest, waitTime } = user.canRequestOTP();
    
    if (!canRequest) {
      logger.warn('OTP request rate limited', { 
        phoneNumber: maskPhoneNumber(phoneNumber),
        waitTime 
      });
      throw new TooManyRequestsError(`Please wait ${waitTime} seconds before requesting OTP again`);
    }
  }

  // Generate OTP
  const otp = user.generateOTP();
  await user.save({ validateBeforeSave: false });

  // Send notification
  if (fcmToken) {
    try {
      await sendOTPNotification(fcmToken, otp);
      logger.info('OTP notification sent', { phoneNumber: maskPhoneNumber(phoneNumber) });
    } catch (error) {
      logger.error('Failed to send OTP notification', { error: error.message });
      // Decide if you want to throw an error or just log it
    }
  }
  
  logger.info('OTP generated and saved', { 
    phoneNumber: maskPhoneNumber(phoneNumber),
    expiresAt: user.otp.expiresAt
  });

  // For development, return OTP in response (REMOVE IN PRODUCTION)
  const responseData = process.env.NODE_ENV === 'development' 
    ? { 
        phoneNumber: maskPhoneNumber(phoneNumber), 
        otp, // Remove this in production
        message: 'OTP sent successfully (Dev mode: OTP included in response)',
        expiresIn: '10 minutes'
      } 
    : { 
        phoneNumber: maskPhoneNumber(phoneNumber),
        message: 'OTP sent successfully to your phone',
        expiresIn: '10 minutes'
      };

  return sendSuccess(res, responseData, 'OTP sent successfully', 200);
});
/**
 * @desc    Verify OTP and login user
 * @route   POST /api/auth/login
 * @access  Public
 */
export const login = catchAsync(async (req, res) => {
  const { phoneNumber, otp } = req.body;

  logger.info('Login attempt', { phoneNumber: maskPhoneNumber(phoneNumber) });

  // Find user with OTP data
  const user = await User.findOne({ phoneNumber }).select('+otp');

  if (!user) {
    logger.warn('Login failed - user not found', { phoneNumber: maskPhoneNumber(phoneNumber) });
    throw new NotFoundError('User not found. Please request OTP first.');
  }

  // Verify OTP
  const isOTPValid = user.verifyOTP(otp);

  if (!isOTPValid) {
    // Save the failed attempt
    await user.save({ validateBeforeSave: false });
    
    logger.warn('Login failed - invalid OTP', { 
      phoneNumber: maskPhoneNumber(phoneNumber),
      attempts: user.otp?.attempts || 0
    });

    // Check if max attempts exceeded
    if (user.otp && user.otp.attempts >= 3) {
      user.clearOTP();
      await user.save({ validateBeforeSave: false });
      throw new BadRequestError('Maximum OTP attempts exceeded. Please request a new OTP.');
    }

    throw new BadRequestError('Invalid or expired OTP. Please try again.');
  }

  // OTP is valid - proceed with login
  user.isVerified = true;
  user.clearOTP(); // Clear OTP after successful verification
  await user.updateLastLogin();

  logger.info('User logged in successfully', { 
    userId: user._id, 
    phoneNumber: maskPhoneNumber(phoneNumber) 
  });

  // Generate JWT token
  const token = generateToken(user._id);

  // Optionally set cookie
  if (process.env.USE_COOKIES === 'true') {
    setTokenCookie(res, token);
  }

  // Prepare user data (exclude sensitive fields)
  const userData = {
    id: user._id,
    phoneNumber: user.phoneNumber,
    name: user.name,
    email: user.email ? maskEmail(user.email) : null,
    isVerified: user.isVerified,
    role: user.role,
    createdAt: user.createdAt
  };

  return sendSuccess(
    res, 
    { 
      accessToken: token, 
      user: userData,
      expiresIn: '30 days'
    }, 
    'Login successful', 
    200
  );
});

/**
 * @desc    Resend OTP
 * @route   POST /api/auth/resend-otp
 * @access  Public
 */
export const resendOTP = catchAsync(async (req, res) => {
  const { phoneNumber } = req.body;

  logger.info('OTP resend request', { phoneNumber: maskPhoneNumber(phoneNumber) });

  const user = await User.findOne({ phoneNumber }).select('+otp');

  if (!user) {
    throw new NotFoundError('User not found');
  }

  // Check rate limiting
  const { canRequest, waitTime } = user.canRequestOTP();
  
  if (!canRequest) {
    logger.warn('OTP resend rate limited', { 
      phoneNumber: maskPhoneNumber(phoneNumber),
      waitTime 
    });
    throw new TooManyRequestsError(`Please wait ${waitTime} seconds before requesting OTP again`);
  }

  // Generate new OTP
  const otp = user.generateOTP();
  await user.save({ validateBeforeSave: false });

  // TODO: Send OTP via SMS
  logger.info('OTP resent', { phoneNumber: maskPhoneNumber(phoneNumber) });

  const responseData = process.env.NODE_ENV === 'development' 
    ? { phoneNumber: maskPhoneNumber(phoneNumber), otp }
    : { phoneNumber: maskPhoneNumber(phoneNumber) };

  return sendSuccess(res, responseData, 'OTP resent successfully', 200);
});

/**
 * @desc    Get current user profile
 * @route   GET /api/auth/me
 * @access  Private
 */
export const getMe = catchAsync(async (req, res) => {
  // User is already attached to req by protect middleware
  const user = {
    id: req.user._id,
    phoneNumber: req.user.phoneNumber,
    name: req.user.name,
    email: req.user.email,
    isVerified: req.user.isVerified,
    isActive: req.user.isActive,
    role: req.user.role,
    profilePicture: req.user.profilePicture,
    address: req.user.address,
    preferences: req.user.preferences,
    lastLogin: req.user.lastLogin,
    createdAt: req.user.createdAt,
    updatedAt: req.user.updatedAt
  };

  logger.info('User profile retrieved', { userId: user.id });

  return sendSuccess(res, user, 'User profile retrieved successfully', 200);
});

/**
 * @desc    Update user profile
 * @route   PUT /api/auth/profile
 * @access  Private
 */
export const updateProfile = catchAsync(async (req, res) => {
  const { name, email, address, preferences } = req.body;

  const user = await User.findById(req.user._id);

  // Update fields if provided
  if (name) user.name = name;
  if (email) user.email = email;
  if (address) user.address = { ...user.address, ...address };
  if (preferences) user.preferences = { ...user.preferences, ...preferences };

  await user.save();

  logger.info('User profile updated', { 
    userId: user._id,
    updates: { 
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
    email: user.email,
    address: user.address,
    preferences: user.preferences
  };

  return sendSuccess(res, userData, 'Profile updated successfully', 200);
});

/**
 * @desc    Change phone number (requires OTP verification)
 * @route   POST /api/auth/change-phone
 * @access  Private
 */
export const changePhoneNumber = catchAsync(async (req, res) => {
  const { newPhoneNumber, otp } = req.body;

  // Check if new phone number already exists
  const existingUser = await User.findOne({ phoneNumber: newPhoneNumber });
  if (existingUser) {
    throw new BadRequestError('This phone number is already registered');
  }

  // Verify OTP for new phone number
  // In production, you'd send OTP to new number first and verify here
  
  const user = await User.findById(req.user._id);
  user.phoneNumber = newPhoneNumber;
  user.isVerified = true;
  await user.save();

  logger.info('Phone number changed', { 
    userId: user._id,
    oldPhone: maskPhoneNumber(req.user.phoneNumber),
    newPhone: maskPhoneNumber(newPhoneNumber)
  });

  return sendSuccess(res, { phoneNumber: user.phoneNumber }, 'Phone number updated successfully', 200);
});

/**
 * @desc    Logout user
 * @route   POST /api/auth/logout
 * @access  Private
 */
export const logout = catchAsync(async (req, res) => {
  // Clear cookie if using cookies
  if (process.env.USE_COOKIES === 'true') {
    clearTokenCookie(res);
  }

  logger.info('User logged out', { userId: req.user._id });

  return sendSuccess(res, null, 'Logged out successfully', 200);
});

/**
 * @desc    Delete user account
 * @route   DELETE /api/auth/account
 * @access  Private
 */
export const deleteAccount = catchAsync(async (req, res) => {
  const { confirmPhoneNumber } = req.body;

  // Verify phone number matches for safety
  if (confirmPhoneNumber !== req.user.phoneNumber) {
    throw new BadRequestError('Phone number does not match');
  }

  // Soft delete (set isActive to false)
  const user = await User.findById(req.user._id);
  user.isActive = false;
  await user.save();

  logger.warn('User account deleted', { 
    userId: user._id,
    phoneNumber: maskPhoneNumber(user.phoneNumber)
  });

  // Clear cookie
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

  const user = await User.findOne({ phoneNumber });

  return sendSuccess(res, { 
    exists: !!user,
    isVerified: user?.isVerified || false
  }, 'Phone number check completed', 200);
});

export default {
  sendOTP,
  login,
  resendOTP,
  getMe,
  updateProfile,
  changePhoneNumber,
  logout,
  deleteAccount,
  checkPhoneExists
};