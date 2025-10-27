// src/routes/auth.routes.js - Clean Authentication Routes
import express from 'express';
import { body } from 'express-validator';
import * as authController from '../controllers/auth.controller.js';
import { protect } from '../middleware/auth.middleware.js';
import { validate } from '../middleware/validation.middleware.js';

const router = express.Router();

// ============================================
// VALIDATION RULES
// ============================================

// Phone number validation (Indian format)
const phoneValidation = [
  body('phoneNumber')
    .trim()
    .notEmpty().withMessage('Phone number is required')
    .matches(/^[6-9]\d{9}$/).withMessage('Please provide a valid 10-digit Indian phone number')
    .isLength({ min: 10, max: 10 }).withMessage('Phone number must be exactly 10 digits'),
  validate
];

// Send OTP validation
const sendOtpValidation = [
  body('phoneNumber')
    .trim()
    .notEmpty().withMessage('Phone number is required')
    .matches(/^[6-9]\d{9}$/).withMessage('Please provide a valid 10-digit Indian phone number'),
  body('fcmToken')
    .optional()
    .trim()
    .notEmpty().withMessage('FCM token cannot be empty'),
  validate
];

// Verify OTP validation
const verifyOtpValidation = [
  body('phoneNumber')
    .trim()
    .notEmpty().withMessage('Phone number is required')
    .matches(/^[6-9]\d{9}$/).withMessage('Please provide a valid phone number'),
  body('otp')
    .trim()
    .notEmpty().withMessage('OTP is required')
    .isLength({ min: 6, max: 6 }).withMessage('OTP must be exactly 6 digits')
    .isNumeric().withMessage('OTP must contain only numbers'),
  validate
];

// Registration validation
const registerValidation = [
  body('name')
    .trim()
    .notEmpty().withMessage('Name is required')
    .isLength({ min: 2, max: 50 }).withMessage('Name must be between 2 and 50 characters')
    .matches(/^[a-zA-Z\s]+$/).withMessage('Name can only contain letters and spaces'),
  body('email')
    .optional()
    .trim()
    .isEmail().withMessage('Please provide a valid email address')
    .normalizeEmail(),
  body('address.street')
    .optional()
    .trim()
    .isLength({ max: 200 }).withMessage('Street address is too long'),
  body('address.city')
    .optional()
    .trim()
    .isLength({ max: 50 }).withMessage('City name is too long'),
  body('address.state')
    .optional()
    .trim()
    .isLength({ max: 50 }).withMessage('State name is too long'),
  body('address.pincode')
    .optional()
    .trim()
    .isLength({ min: 6, max: 6 }).withMessage('Pincode must be exactly 6 digits')
    .isNumeric().withMessage('Pincode must contain only numbers'),
  body('preferences.language')
    .optional()
    .isIn(['en', 'hi']).withMessage('Language must be either "en" or "hi"'),
  body('preferences.notifications.email')
    .optional()
    .isBoolean().withMessage('Email notification preference must be boolean'),
  body('preferences.notifications.sms')
    .optional()
    .isBoolean().withMessage('SMS notification preference must be boolean'),
  body('preferences.notifications.push')
    .optional()
    .isBoolean().withMessage('Push notification preference must be boolean'),
  validate
];

// Profile update validation
const updateProfileValidation = [
  body('name')
    .optional()
    .trim()
    .notEmpty().withMessage('Name cannot be empty')
    .isLength({ min: 2, max: 50 }).withMessage('Name must be between 2 and 50 characters')
    .matches(/^[a-zA-Z\s]+$/).withMessage('Name can only contain letters and spaces'),
  body('email')
    .optional()
    .trim()
    .isEmail().withMessage('Please provide a valid email address')
    .normalizeEmail(),
  body('address.street')
    .optional()
    .trim()
    .isLength({ max: 200 }).withMessage('Street address is too long'),
  body('address.city')
    .optional()
    .trim()
    .isLength({ max: 50 }).withMessage('City name is too long'),
  body('address.state')
    .optional()
    .trim()
    .isLength({ max: 50 }).withMessage('State name is too long'),
  body('address.pincode')
    .optional()
    .trim()
    .isLength({ min: 6, max: 6 }).withMessage('Pincode must be exactly 6 digits')
    .isNumeric().withMessage('Pincode must contain only numbers'),
  body('preferences.language')
    .optional()
    .isIn(['en', 'hi']).withMessage('Language must be either "en" or "hi"'),
  validate
];

// Delete account validation
const deleteAccountValidation = [
  body('confirmPhoneNumber')
    .trim()
    .notEmpty().withMessage('Please confirm your phone number')
    .matches(/^[6-9]\d{9}$/).withMessage('Invalid phone number format'),
  validate
];

// Resend OTP validation
const resendOtpValidation = [
  body('phoneNumber')
    .trim()
    .notEmpty().withMessage('Phone number is required')
    .matches(/^[6-9]\d{9}$/).withMessage('Please provide a valid phone number'),
  body('fcmToken')
    .optional()
    .trim()
    .notEmpty().withMessage('FCM token cannot be empty'),
  validate
];

// ============================================
// PUBLIC ROUTES (No Authentication Required)
// ============================================

/**
 * @route   POST /api/auth/send-otp
 * @desc    Send OTP to phone number
 * @access  Public
 * @body    { phoneNumber: string, fcmToken?: string }
 */
router.post('/send_otp', authController.sendOtp);

/**
 * @route   POST /api/auth/verify-otp
 * @desc    Verify OTP and authenticate user
 * @access  Public
 * @body    { phoneNumber: string, otp: string }
 */
router.post('/verify_otp', authController.verifyOtp);

/**
 * @route   POST /api/auth/resend-otp
 * @desc    Resend OTP to phone number
 * @access  Public
 * @body    { phoneNumber: string, fcmToken?: string }
 */
router.post('/resend-otp', resendOtpValidation, authController.resendOtp);

/**
 * @route   POST /api/auth/check-phone
 * @desc    Check if phone number exists in system
 * @access  Public
 * @body    { phoneNumber: string }
 */
router.post('/check-phone', phoneValidation, authController.checkPhoneExists);

// ============================================
// PRIVATE ROUTES (Authentication Required)
// ============================================

/**
 * @route   POST /api/auth/register
 * @desc    Complete user registration/profile after OTP verification
 * @access  Private
 * @body    { name: string, email?: string, address?: object, preferences?: object }
 */
router.post('/register', authController.register);

/**
 * @route   GET /api/auth/user
 * @desc    Get current authenticated user profile
 * @access  Private
 */
router.get('/user', protect, authController.getUser);

/**
 * @route   PUT /api/auth/profile
 * @desc    Update user profile
 * @access  Private
 * @body    { name?: string, email?: string, address?: object, preferences?: object }
 */
router.put('/updateProfile', protect, authController.updateProfile);

/**
 * @route   POST /api/auth/logout
 * @desc    Logout user (clear cookies)
 * @access  Private
 */
router.post('/logout', protect, authController.logout);

/**
 * @route   DELETE /api/auth/account
 * @desc    Delete user account (soft delete)
 * @access  Private
 * @body    { confirmPhoneNumber: string }
 */
router.delete('/account', protect, deleteAccountValidation, authController.deleteAccount);

export default router;