// src/routes/user.routes.js - Complete User Routes
import express from 'express';
import { query } from 'express-validator';
import * as userController from '../controllers/user.controller.js';
import { protect } from '../middleware/auth.middleware.js';
import validate, { validatePagination } from '../middleware/validation.middleware.js';

const router = express.Router();

// ============================================
// ALL ROUTES REQUIRE AUTHENTICATION
// ============================================
router.use(protect);

// ============================================
// VALIDATION RULES
// ============================================

const searchValidation = [
  query('query')
    .optional()
    .trim()
    .isLength({ min: 2 }).withMessage('Search query must be at least 2 characters'),
  query('fromDate')
    .optional()
    .isISO8601().withMessage('Invalid from date format'),
  query('toDate')
    .optional()
    .isISO8601().withMessage('Invalid to date format'),
  validate
];

// ============================================
// BOOKING RELATED ROUTES
// ============================================

/**
 * @route   GET /api/users/me/bookings
 * @desc    Get user's booking history with filters
 * @access  Private
 */
router.get('/getMyBookings', protect , userController.getMyBookings);

/**
 * @route   GET /api/users/me/bookings/upcoming
 * @desc    Get upcoming bookings
 * @access  Private
 */
router.get('/me/bookings/upcoming', userController.getUpcomingBookings);

/**
 * @route   GET /api/users/me/bookings/past
 * @desc    Get past/completed bookings
 * @access  Private
 */
router.get('/me/bookings/past', validatePagination, userController.getPastBookings);

/**
 * @route   GET /api/users/me/bookings/active
 * @desc    Get active/ongoing booking
 * @access  Private
 */
router.get('/me/bookings/active', userController.getActiveBooking);

/**
 * @route   GET /api/users/me/bookings/search
 * @desc    Search user's booking history
 * @access  Private
 */
router.get('/me/bookings/search', searchValidation, userController.searchBookings);

// ============================================
// STATISTICS & INSIGHTS
// ============================================

/**
 * @route   GET /api/users/me/stats
 * @desc    Get user statistics and insights
 * @access  Private
 */
router.get('/me/stats', userController.getUserStats);

/**
 * @route   GET /api/users/me/notifications
 * @desc    Get user notifications
 * @access  Private
 */
router.get('/me/notifications', userController.getNotifications);

// ============================================
// USER PREFERENCES & DATA
// ============================================

/**
 * @route   GET /api/users/me/addresses
 * @desc    Get saved addresses
 * @access  Private
 */
router.get('/me/addresses', userController.getSavedAddresses);

/**
 * @route   GET /api/users/me/export
 * @desc    Export user's booking data
 * @access  Private
 */
router.get('/me/export', userController.exportBookingData);

export default router;