// src/controllers/auth.controller.js - REVISED AUTH FLOW
import User from '../models/User.js';
import { Otp } from '../models/Otp.js';
import { sendSuccess } from '../utils/response.js';
import { setTokenCookie, clearTokenCookie, generateToken } from '../middleware/auth.middleware.js'; // Import generateToken
import { catchAsync } from '../utils/catchAsync.js';
import { NotFoundError, BadRequestError, TooManyRequestsError, ConflictError } from '../utils/customError.js';
import { maskPhoneNumber, maskEmail } from '../utils/helpers.js';
import logger from '../config/logger.js';
import { sendOTPNotification } from '../utils/sendOtp.js';
import { OTP_CONFIG } from '../config/constants.js'; // Import config from constants

/**
 * @desc    Send OTP to phone number
 * @route   POST /api/auth/send-otp
 * @access  Public
 */
export const sendOtp = catchAsync(async (req, res) => {
  const { phoneNumber, fcmToken } = req.body;

  if (!phoneNumber) {
    throw new BadRequestError('Phone number is required');
  }

  const normalizedPhone = phoneNumber.replace(/\D/g, ''); // Clean number
  logger.info('OTP request received', {
    phoneNumber: maskPhoneNumber(normalizedPhone)
  });

  // Check for existing OTP
  const existingOtp = await Otp.findOne({ phoneNumber: normalizedPhone });

  if (existingOtp) {
    // Check rate limiting
    const timeSinceLastRequest = (Date.now() - existingOtp.lastRequestedAt.getTime()) / 1000;
    const waitTime = Math.max(0, OTP_CONFIG.RESEND_TIMEOUT_SECONDS - timeSinceLastRequest);

    if (waitTime > 0) {
      logger.warn('OTP request rate limited', {
        phoneNumber: maskPhoneNumber(normalizedPhone),
        waitTime: Math.ceil(waitTime)
      });
      throw new TooManyRequestsError(
        `Please wait ${Math.ceil(waitTime)} seconds before requesting a new OTP`
      );
    }
    // Delete old OTP to issue a new one
    await Otp.deleteOne({ phoneNumber: normalizedPhone });
  }

  // Generate new OTP
  const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
  const expiresAt = new Date(Date.now() + OTP_CONFIG.EXPIRY_MINUTES * 60 * 1000);

  // Create OTP document
  const otp = await Otp.create({
    phoneNumber: normalizedPhone,
    code: otpCode,
    expiresAt,
    attempts: 0,
    lastRequestedAt: new Date()
  });

  logger.info('OTP generated successfully', {
    phoneNumber: maskPhoneNumber(normalizedPhone),
    expiresAt: otp.expiresAt
  });

  // Send push notification (non-blocking)
  if (fcmToken) {
    sendOTPNotification(fcmToken, otpCode)
      .then(() => {
        logger.info('OTP push notification sent successfully', {
          phoneNumber: maskPhoneNumber(normalizedPhone)
        });
      })
      .catch((error) => {
        logger.error('Failed to send OTP push notification', {
          phoneNumber: maskPhoneNumber(normalizedPhone),
          error: error.message
        });
      });
  }
  
  // TODO: Implement SMS sending logic here
  // e.g., await sendSms(normalizedPhone, `Your OTP is ${otpCode}`);

  // Prepare response
  const responseData = {
    phoneNumber: maskPhoneNumber(normalizedPhone),
    message: 'OTP sent successfully',
    expiresIn: `${OTP_CONFIG.EXPIRY_MINUTES} minutes`,
    resendAfter: `${OTP_CONFIG.RESEND_TIMEOUT_SECONDS}s`
  };

  // Include OTP in development mode only
  if (process.env.NODE_ENV === 'development') {
    responseData.otp = otpCode;
    responseData.message = 'OTP sent successfully (Dev mode: OTP included)';
  }

  return sendSuccess(res, responseData, 'OTP sent successfully', 200);
});

/**
 * @desc    Verify OTP and check user status (Login or Register)
 * @route   POST /api/auth/verify-otp
 * @access  Public
 */
export const verifyOtp = catchAsync(async (req, res) => {
  const { phoneNumber, otp } = req.body;
  
  if (!phoneNumber || !otp) {
    throw new BadRequestError('Phone number and OTP are required');
  }

  const normalizedPhone = phoneNumber.replace(/\D/g, '');
  logger.info('OTP verification attempt', {
    phoneNumber: maskPhoneNumber(normalizedPhone)
  });

  // 1. Find OTP document
  const otpDoc = await Otp.findOne({ phoneNumber: normalizedPhone });

  if (!otpDoc) {
    logger.warn('Verification failed - no OTP found', {
      phoneNumber: maskPhoneNumber(normalizedPhone)
    });
    throw new BadRequestError('Invalid OTP or OTP not requested. Please request an OTP first.');
  }

  // 2. Check if OTP has expired
  if (new Date() > otpDoc.expiresAt) {
    logger.warn('Verification failed - OTP expired', {
      phoneNumber: maskPhoneNumber(normalizedPhone),
      expiredAt: otpDoc.expiresAt
    });
    await Otp.deleteOne({ phoneNumber: normalizedPhone }); // Clean up expired OTP
    throw new BadRequestError('OTP has expired. Please request a new OTP.');
  }

  // 3. Check if max attempts already exceeded
  if (otpDoc.attempts >= OTP_CONFIG.MAX_ATTEMPTS) {
    logger.warn('Verification failed - max attempts exceeded', {
      phoneNumber: maskPhoneNumber(normalizedPhone),
      attempts: otpDoc.attempts
    });
    await Otp.deleteOne({ phoneNumber: normalizedPhone }); // Clean up locked OTP
    throw new BadRequestError('Maximum OTP attempts exceeded. Please request a new OTP.');
  }

  // 4. Verify OTP code
  const isOTPCorrect = otpDoc.code === otp;

  if (!isOTPCorrect) {
    // Increment failed attempts
    otpDoc.attempts += 1;
    await otpDoc.save();

    const attemptsLeft = OTP_CONFIG.MAX_ATTEMPTS - otpDoc.attempts;

    logger.warn('OTP verification failed - incorrect code', {
      phoneNumber: maskPhoneNumber(normalizedPhone),
      attempts: otpDoc.attempts,
      attemptsLeft
    });

    // If this was the last attempt, delete OTP
    if (attemptsLeft <= 0) {
      await Otp.deleteOne({ phoneNumber: normalizedPhone });
      throw new BadRequestError('Invalid OTP. Maximum attempts exceeded. Please request a new OTP.');
    }

    throw new BadRequestError(
      `Invalid OTP. ${attemptsLeft} attempt(s) remaining.`
    );
  }

  // 5. ✅ OTP verified successfully - Delete OTP document
  await Otp.deleteOne({ phoneNumber: normalizedPhone });

  logger.info('OTP verified successfully. Checking user database.', {
    phoneNumber: maskPhoneNumber(normalizedPhone)
  });

  // 6. Check if user exists in User database
  const user = await User.findOne({ phoneNumber: normalizedPhone });

  // --- FLOW: EXISTING USER (LOGIN) ---
  if (user) {
    logger.info('Existing user found. Logging in.', { userId: user._id });

    // Update user record for login
    user.isVerified = true; // Ensure verified status
    user.lastLogin = new Date();
    
    // Generate JWT token
    const token = user.getJWTToken();
    user.token = token; // Save token to user document

    await user.save(); // Save lastLogin, token, etc.

    // Set cookie if enabled
    if (process.env.USE_COOKIES === 'true') {
      setTokenCookie(res, token);
    }

    // Prepare user data for response
    const userData = {
      id: user._id,
      phoneNumber: user.phoneNumber,
      name: user.name,
      email: user.email,
      isVerified: user.isVerified,
      role: user.role,
      profilePicture: user.profilePicture,
      address: user.address,
      preferences: user.preferences
    };

    return sendSuccess(
      res,
      {
        token,
        user: userData,
        newUser: false,
        expiresIn: process.env.JWT_EXPIRE || '30d'
      },
      'Login successful',
      200
    );
  }

  // --- FLOW: NEW USER (REGISTRATION NEEDED) ---
  else {
    logger.info('New user detected. Proceed to registration.', {
      phoneNumber: maskPhoneNumber(normalizedPhone)
    });

    // DO NOT create user here.
    // Return success response indicating verification is done and registration is next.
    return sendSuccess(
      res,
      {
        newUser: true, // Flag for client
        phoneNumber: normalizedPhone, // Send back the verified phone number
        message: 'Phone number verified. Please complete your registration.'
      },
      'OTP verified successfully',
      200
    );
  }
});

/**
 * @desc    Register (create) a new user after OTP verification
 * @route   POST /api/auth/register
 * @access  Public
 */
export const register = catchAsync(async (req, res) => {
  const { name, phoneNumber, email, address, preferences } = req.body;

  // 1. Validate required fields
  if (!name || !phoneNumber) {
    throw new BadRequestError('Name and phone number are required for registration');
  }

  const normalizedPhone = phoneNumber.replace(/\D/g, '');

  logger.info('Registration attempt', {
    phoneNumber: maskPhoneNumber(normalizedPhone),
    name,
    email
  });

  // 2. Check if phone number is already registered
  const existingUser = await User.findOne({ phoneNumber: normalizedPhone });
  if (existingUser) {
    logger.warn('Registration failed - phone number already exists', {
       phoneNumber: maskPhoneNumber(normalizedPhone)
    });
    throw new ConflictError('This phone number is already registered. Please log in.');
  }

  // 3. Check if email already exists (if provided)
  if (email) {
    const existingEmail = await User.findOne({ email });
    if (existingEmail) {
       logger.warn('Registration failed - email already exists', { email });
      throw new BadRequestError('This email is already registered by another account.');
    }
  }
  
  // 4. Create new user
  // isVerified is true because they *must* have passed verifyOtp to get here
  // (We trust the client to call this endpoint only after verifyOtp returns newUser: true)
  const user = new User({
    name,
    phoneNumber: normalizedPhone,
    email,
    address,
    preferences,
    isVerified: true, // User is verified
    isActive: true,
    role: 'CUSTOMER', // Default role
    lastLogin: new Date() // Set first login time
  });

  // 5. Generate token
  const token = user.getJWTToken();
  user.token = token; // Save token

  // 6. Save user to database
  try {
    await user.save();
  } catch (error) {
    // Handle potential race condition or validation error
    if (error.code === 11000) {
      logger.error('Registration race condition - duplicate key', { error: error.message });
      throw new ConflictError('This phone number was registered just now. Please log in.');
    }
    logger.error('Error saving new user', { error: error.message });
    throw error; // Rethrow other validation errors
  }

  logger.info('New user registered and logged in', {
    userId: user._id,
    phoneNumber: maskPhoneNumber(user.phoneNumber)
  });

  // 7. Set cookie if enabled
  if (process.env.USE_COOKIES === 'true') {
    setTokenCookie(res, token);
  }

  // 8. Prepare response data
  const userData = {
    id: user._id,
    phoneNumber: user.phoneNumber,
    name: user.name,
    email: user.email,
    isVerified: user.isVerified,
    role: user.role,
    profilePicture: user.profilePicture,
    address: user.address,
    preferences: user.preferences
  };

  return sendSuccess(
    res,
    {
      token,
      user: userData,
      newUser: true, // Flag for client
      expiresIn: process.env.JWT_EXPIRE || '30d'
    },
    'Registration successful. Welcome!',
    201 // 201 Created
  );
});

/**
 * @desc    Get current user profile
 * @route   GET /api/auth/user
 * @access  Private (Requires Token)
 */
export const getUser = catchAsync(async (req, res) => {
  // req.user is attached by the 'protect' middleware
  const userId = req.user._id;

  logger.info('Fetching user profile', { userId });

  // Return all relevant, non-sensitive user data
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
    preferences: req.user.preferences,
    lastLogin: req.user.lastLogin,
    createdAt: req.user.createdAt,
    updatedAt: req.user.updatedAt
    // Do not send 'token' back in profile requests
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
 * @access  Private (Requires Token)
 */
export const updateProfile = catchAsync(async (req, res) => {
  const { name, email, address, preferences } = req.body;
  const userId = req.user._id;

  logger.info('Profile update attempt', { userId });

  // User is already attached by 'protect' middleware
  const user = req.user; 

  // Check if email is being changed and if it's already taken
  if (email && email !== user.email) {
    const existingEmail = await User.findOne({
      email: email.toLowerCase(),
      _id: { $ne: userId } // Find other users with this email
    });

    if (existingEmail) {
      logger.warn('Profile update failed - email already in use', { userId, email });
      throw new ConflictError('This email is already registered by another account.');
    }
     user.email = email; // Update email
  }

  // Update other fields if provided
  if (name) user.name = name;
  if (address) user.address = { ...(user.address || {}), ...address };
  if (preferences) user.preferences = { ...(user.preferences || {}), ...preferences };

  // Save the updated user document
  await user.save();

  logger.info('Profile updated successfully', {
    userId,
    updatedFields: {
      name: !!name,
      email: !!email,
      address: !!address,
      preferences: !!preferences
    }
  });

  // Prepare response data
  const userData = {
    id: user._id,
    phoneNumber: user.phoneNumber,
    name: user.name,
    email: user.email,
    address: user.address,
    preferences: user.preferences,
    updatedAt: user.updatedAt,
    profilePicture: user.profilePicture,
    role: user.role,
    isVerified: user.isVerified
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
  // sendOtp handles rate limiting and re-issuing
  return sendOtp(req, res);
});

/**
 * @desc    Logout user
 * @route   POST /api/auth/logout
 * @access  Private (Requires Token)
 */
export const logout = catchAsync(async (req, res) => {
  const userId = req.user._id;
  logger.info('User logout request', { userId });

  // Remove token from user document in database
  await User.findByIdAndUpdate(userId, { $unset: { token: 1 } });

  // Clear cookie if using cookies
  if (process.env.USE_COOKIES === 'true') {
    clearTokenCookie(res);
  }

  return sendSuccess(res, null, 'Logged out successfully', 200);
});

/**
 * @desc    Delete user account (soft delete)
 * @route   DELETE /api/auth/account
 * @access  Private (Requires Token)
 */
export const deleteAccount = catchAsync(async (req, res) => {
  const { confirmPhoneNumber } = req.body;
  const userId = req.user._id;

  logger.info('Account deletion request', { userId });

  // Verify phone number matches for safety
  if (confirmPhoneNumber !== req.user.phoneNumber) {
    logger.warn('Account deletion failed - phone number mismatch', { userId });
    throw new BadRequestError('Phone number confirmation does not match. Account not deleted.');
  }

  const user = req.user;

  // Soft delete (set isActive to false)
  user.isActive = false;
  user.token = undefined; // Remove token
  // Consider anonymizing data here or in a background job
  // user.email = `deleted-${userId}@example.com`;
  // user.name = "Deleted User";
  
  await user.save();

  logger.warn('User account soft-deleted', {
    userId,
    phoneNumber: maskPhoneNumber(user.phoneNumber)
  });

  // Clear authentication cookie
  if (process.env.USE_COOKIES === 'true') {
      clearTokenCookie(res);
  }

  return sendSuccess(res, null, 'Account deleted successfully', 200);
});

/**
 * @desc    Check if phone number exists
 * @route   POST /api/auth/check-phone
 * @access  Public
 */
export const checkPhoneExists = catchAsync(async (req, res) => {
  const { phoneNumber } = req.body;

  if (!phoneNumber) {
    throw new BadRequestError('Phone number is required');
  }
  
  const normalizedPhone = phoneNumber.replace(/\D/g, '');
  logger.info('Phone number existence check', {
    phoneNumber: maskPhoneNumber(normalizedPhone)
  });

  const user = await User.findOne({ phoneNumber: normalizedPhone });

  return sendSuccess(
    res,
    {
      phoneNumber: normalizedPhone,
      exists: !!user,
      isRegistered: user?.name ? true : false // Check if name is set
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
