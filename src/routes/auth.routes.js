// src/routes/auth.routes.js - Complete Authentication Routes
import express from 'express';
import { body } from 'express-validator';
import * as authController from '../controllers/auth.controller.js';
import { protect } from '../middleware/auth.middleware.js';
import validate from '../middleware/validation.middleware.js';

const router = express.Router();

// ============================================
// VALIDATION RULES
// ============================================

const otpValidation = [
  body('phoneNumber')
    .trim()
    .notEmpty().withMessage('Phone number is required')
    .isMobilePhone('en-IN').withMessage('Please provide a valid 10-digit Indian phone number')
    .isLength({ min: 10, max: 10 }).withMessage('Phone number must be exactly 10 digits'),
  validate
];

const loginValidation = [
  body('phoneNumber')
    .trim()
    .notEmpty().withMessage('Phone number is required')
    .isMobilePhone('en-IN').withMessage('Please provide a valid phone number'),
  body('otp')
    .trim()
    .notEmpty().withMessage('OTP is required')
    .isLength({ min: 6, max: 6 }).withMessage('OTP must be exactly 6 digits')
    .isNumeric().withMessage('OTP must contain only numbers'),
  validate
];

const profileValidation = [
  body('name')
    .optional()
    .trim()
    .notEmpty().withMessage('Name cannot be empty')
    .isLength({ min: 2, max: 50 }).withMessage('Name must be between 2 and 50 characters'),
  body('email')
    .optional()
    .trim()
    .isEmail().withMessage('Please provide a valid email address')
    .normalizeEmail(),
  body('address.street').optional().trim(),
  body('address.city').optional().trim(),
  body('address.state').optional().trim(),
  body('address.pincode')
    .optional()
    .trim()
    .isLength({ min: 6, max: 6 }).withMessage('Pincode must be 6 digits')
    .isNumeric().withMessage('Pincode must contain only numbers'),
  body('preferences.language')
    .optional()
    .isIn(['en', 'hi']).withMessage('Language must be either en or hi'),
  validate
];

const changePhoneValidation = [
  body('newPhoneNumber')
    .trim()
    .notEmpty().withMessage('New phone number is required')
    .isMobilePhone('en-IN').withMessage('Please provide a valid phone number'),
  body('otp')
    .trim()
    .notEmpty().withMessage('OTP is required')
    .isLength({ min: 6, max: 6 }).withMessage('OTP must be 6 digits'),
  validate
];

const deleteAccountValidation = [
  body('confirmPhoneNumber')
    .trim()
    .notEmpty().withMessage('Please confirm your phone number')
    .isMobilePhone('en-IN').withMessage('Invalid phone number'),
  validate
];

const checkPhoneValidation = [
  body('phoneNumber')
    .trim()
    .notEmpty().withMessage('Phone number is required')
    .isMobilePhone('en-IN').withMessage('Invalid phone number'),
  validate
];

// ============================================
// PUBLIC ROUTES (No Authentication Required)
// ============================================

/**
 * @route   POST /api/auth/otp
 * @desc    Send OTP to phone number
 * @access  Public
 */
router.post('/otp', otpValidation, authController.sendOTP);

/**
 * @route   POST /api/auth/login
 * @desc    Verify OTP and login
 * @access  Public
 */
router.post('/login', loginValidation, authController.login);

/**
 * @route   POST /api/auth/resend-otp
 * @desc    Resend OTP to phone number
 * @access  Public
 */
router.post('/resend-otp', otpValidation, authController.resendOTP);

/**
 * @route   POST /api/auth/check-phone
 * @desc    Check if phone number exists
 * @access  Public
 */
router.post('/check-phone', checkPhoneValidation, authController.checkPhoneExists);

// ============================================
// PROTECTED ROUTES (Authentication Required)
// ============================================

/**
 * @route   GET /api/auth/me
 * @desc    Get current user profile
 * @access  Private
 */
router.get('/me', protect, authController.getMe);

/**
 * @route   PUT /api/auth/profile
 * @desc    Update user profile
 * @access  Private
 */
router.put('/profile', protect, profileValidation, authController.updateProfile);

/**
 * @route   POST /api/auth/change-phone
 * @desc    Change phone number
 * @access  Private
 */
router.post('/change-phone', protect, changePhoneValidation, authController.changePhoneNumber);

/**
 * @route   POST /api/auth/logout
 * @desc    Logout user
 * @access  Private
 */
router.post('/logout', protect, authController.logout);

/**
 * @route   DELETE /api/auth/account
 * @desc    Delete user account (soft delete)
 * @access  Private
 */
router.delete('/account', protect, deleteAccountValidation, authController.deleteAccount);

export default router;