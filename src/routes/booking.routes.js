// src/routes/booking.routes.js - UPDATED with Multi-Day Round Trip Validation
import express from 'express';
import { body, query } from 'express-validator';
import * as bookingController from '../controllers/booking.controller.js';
import { protect, restrictTo } from '../middleware/auth.middleware.js';
import validate, { validateObjectId, validatePagination } from '../middleware/validation.middleware.js';
import { BOOKING_TYPES, BOOKING_STATUS } from '../config/constants.js';

const router = express.Router();

// ============================================
// VALIDATION RULES
// ============================================

const searchValidation = [
  body('from')
    .trim()
    .notEmpty().withMessage('Pickup location is required')
    .isLength({ min: 2 }).withMessage('Pickup location must be at least 2 characters'),
  body('to')
    .trim()
    .notEmpty().withMessage('Drop location is required')
    .isLength({ min: 2 }).withMessage('Drop location must be at least 2 characters'),
  body('date') // This acts as startDateTime
    .notEmpty().withMessage('Travel date is required')
    .isISO8601().withMessage('Invalid date format. Use ISO 8601 format'),
  // --- [MODIFIED] ---
  body('endDateTime')
    .optional()
    .isISO8601().withMessage('Invalid return date format (endDateTime)')
    .custom((value, { req }) => {
      if (value && new Date(value) < new Date(req.body.date)) {
        throw new Error('Return date (endDateTime) must be after start date (date)');
      }
      return true;
    }),
  // --- [END MODIFIED] ---
  body('type')
    .trim()
    .notEmpty().withMessage('Booking type is required')
    .isIn(Object.values(BOOKING_TYPES)).withMessage('Invalid booking type'),
  body('distance')
    .optional()
    .isNumeric().withMessage('Distance must be a number')
    .isFloat({ min: 0 }).withMessage('Distance must be positive'),
  body('fromCoordinates.lat').optional().isFloat({ min: -90, max: 90 }),
  body('fromCoordinates.lng').optional().isFloat({ min: -180, max: 180 }),
  body('toCoordinates.lat').optional().isFloat({ min: -90, max: 90 }),
  body('toCoordinates.lng').optional().isFloat({ min: -180, max: 180 }),
  validate
];

const createBookingValidation = [
  body('bookingType')
    .trim()
    .notEmpty().withMessage('Booking type is required')
    .isIn(Object.values(BOOKING_TYPES)).withMessage('Invalid booking type'),
  body('pickupLocation.city')
    .trim()
    .notEmpty().withMessage('Pickup city is required'),
  body('pickupLocation.address')
    .optional()
    .trim(),
  body('dropLocation.city')
    .trim()
    .notEmpty().withMessage('Drop city is required'),
  body('dropLocation.address')
    .optional()
    .trim(),
  body('startDateTime')
    .notEmpty().withMessage('Start date and time is required')
    .isISO8601().withMessage('Invalid date format'),
  body('endDateTime')
    .optional()
    .isISO8601().withMessage('Invalid date format')
    .custom((value, { req }) => {
      if (value && new Date(value) < new Date(req.body.startDateTime)) {
        throw new Error('End date/time must be after start date/time');
      }
      return true;
    }),
  body('vehicleType')
    .trim()
    .notEmpty().withMessage('Vehicle type is required'),
  body('passengerDetails.name')
    .trim()
    .notEmpty().withMessage('Passenger name is required')
    .isLength({ min: 2, max: 50 }).withMessage('Name must be between 2-50 characters'),
  body('passengerDetails.phone')
    .trim()
    .notEmpty().withMessage('Passenger phone is required')
    .isMobilePhone('en-IN').withMessage('Invalid phone number'),
  body('passengerDetails.email')
    .optional()
    .trim()
    .isEmail().withMessage('Invalid email address'),
  body('fareDetails.baseFare')
    .notEmpty().withMessage('Base fare is required')
    .isNumeric().withMessage('Base fare must be a number'),
  body('fareDetails.gst')
    .notEmpty().withMessage('GST is required')
    .isNumeric().withMessage('GST must be a number'),
  body('fareDetails.totalFare')
    .notEmpty().withMessage('Total fare is required')
    .isNumeric().withMessage('Total fare must be a number'),
  body('fareDetails.finalAmount')
    .notEmpty().withMessage('Final amount is required')
    .isNumeric().withMessage('Final amount must be a number')
    .isFloat({ min: 0 }).withMessage('Final amount must be positive'),
  body('specialRequests')
    .optional()
    .isArray().withMessage('Special requests must be an array'),
  body('notes')
    .optional()
    .trim()
    .isLength({ max: 500 }).withMessage('Notes cannot exceed 500 characters'),
  body('addOnCodes')
    .optional()
    .isArray().withMessage('Add-ons must be an array of codes'),
  validate
];

const statusValidation = [
  body('status')
    .trim()
    .notEmpty().withMessage('Status is required')
    .isIn(Object.values(BOOKING_STATUS)).withMessage('Invalid booking status'),
  validate
];

const ratingValidation = [
  body('rating')
    .notEmpty().withMessage('Rating is required')
    .isInt({ min: 1, max: 5 }).withMessage('Rating must be between 1 and 5'),
  body('comment')
    .optional()
    .trim()
    .isLength({ max: 500 }).withMessage('Comment cannot exceed 500 characters'),
  validate
];

const discountValidation = [
  body('discountCode')
    .trim()
    .notEmpty().withMessage('Discount code is required')
    .isLength({ min: 3, max: 20 }).withMessage('Invalid discount code format'),
  validate
];

const estimateFareValidation = [
  body('bookingType')
    .trim()
    .notEmpty().withMessage('Booking type is required')
    .isIn(Object.values(BOOKING_TYPES)).withMessage('Invalid booking type'),
  body('vehicleType')
    .trim()
    .notEmpty().withMessage('Vehicle type is required'),
  body('distance')
    .optional()
    .isNumeric().withMessage('Distance must be a number'),
  body('startDateTime')
    .optional()
    .isISO8601().withMessage('Invalid date format'),
  // --- [NEW] ---
  body('endDateTime')
    .optional()
    .isISO8601().withMessage('Invalid return date format (endDateTime)'),
  // --- [END NEW] ---
  validate
];

const cancelReasonValidation = [
  body('reason')
    .optional()
    .trim()
    .isLength({ max: 200 }).withMessage('Reason cannot exceed 200 characters'),
  validate
];

// ============================================
// PUBLIC ROUTES
// ============================================

/**
 * @route   POST /api/bookings/search
 * @desc    Search for available cabs
 * @access  Public
 */
router.post('/search', bookingController.searchCabs);
/**
 * @route   POST /api/bookings/estimate-fare
 * @desc    Estimate fare for a trip
 * @access  Public
 */
router.post('/estimate-fare', estimateFareValidation, bookingController.getFareEstimate);

// ============================================
// PROTECTED ROUTES
// ============================================

/**
 * @route   GET /api/bookings
 * @desc    Get all bookings for current user
 * @access  Private
 */
router.get('/getAllBookings', protect, bookingController.getAllBookings);

/**
 * @route   POST /api/bookings
 * @desc    Create a new booking
 * @access  Private
 */
router.post('/createBooking', protect, bookingController.createBooking);



router.post('/verifyBookingPayment', protect, bookingController.verifyBookingPayment);

/**
 * @route   GET /api/bookings/stats
 * @desc    Get booking statistics
 * @access  Private
 */
router.get('/stats', protect, bookingController.getBookingStats);

/**
 * @route   GET /api/bookings/code/:bookingId
 * @desc    Get booking by booking code
 * @access  Private
 */
router.get('/code/:bookingId', protect, bookingController.getBookingByCode);

/**
 * @route   GET /api/bookings/:id
 * @desc    Get booking by database ID
 * @access  Private
 */
router.get('/getBooking/:id', protect, validateObjectId('id'), bookingController.getBooking);

/**
 * @route   PATCH /api/bookings/:id/status
 * @desc    Update booking status
 * @access  Private
 */
router.patch(
  '/:id/status',
  protect,
  validateObjectId('id'),
  statusValidation,
  bookingController.updateBookingStatus
);

/**
 * @route   PATCH /api/bookings/:id/cancel
 * @desc    Cancel a booking
 * @access  Private
 */
router.patch(
  '/:id/cancel',
  protect,
  validateObjectId('id'),
  cancelReasonValidation,
  bookingController.cancelBooking
);

/**
 * @route   GET /api/bookings/:id/cancellation-charges
 * @desc    Get cancellation charges for a booking
 * @access  Private
 */
router.get(
  '/:id/cancellation-charges',
  protect,
  validateObjectId('id'),
  bookingController.getCancellationCharges
);

/**
 * @route   POST /api/bookings/:id/rating
 * @desc    Add rating to completed booking
 * @access  Private
 */
router.post(
  '/:id/rating',
  protect,
  validateObjectId('id'),
  ratingValidation,
  bookingController.addRating
);

/**
 * @route   POST /api/bookings/:id/apply-discount
 * @desc    Apply discount code to booking
 * @access  Private
 */
router.post(
  '/:id/apply-discount',
  protect,
  validateObjectId('id'),
  discountValidation,
  bookingController.applyDiscount
);

// ============================================
// ADMIN ROUTES
// ============================================

/**
 * @route   GET /api/bookings/admin/confirmed
 * @desc    Get all confirmed bookings (Admin only)
 * @access  Admin
 */
router.get(
  '/admin/confirmed',
  protect,
  restrictTo('ADMIN'),
  validatePagination,
  bookingController.getConfirmedBookings
);


export default router;