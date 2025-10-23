// src/controllers/booking.controller.js - Complete with Socket.IO for Driver Acceptance
import Booking from '../models/Booking.js';
import { Vehicle, Driver } from '../models/Vehicle.js';
import User from '../models/User.js';
import pricingService from '../services/pricing.service.js';
import { sendSuccess, sendPaginatedResponse } from '../utils/response.js';
import catchAsync from '../utils/catchAsync.js';
import { NotFoundError, BadRequestError, ConflictError, ValidationError } from '../utils/customError.js';
import { BOOKING_STATUS, BOOKING_TYPES, BOOKING_CONFIG } from '../config/constants.js';
import { parsePagination, addDays, addHours, addMinutes } from '../utils/helpers.js';
import logger from '../config/logger.js';

// Socket.IO instance (will be set from server.js)
let io = null;

/**
 * Set Socket.IO instance
 * @param {Object} socketIO - Socket.IO instance
 */
export const setSocketIO = (socketIO) => {
  io = socketIO;
  logger.info('Socket.IO instance set for booking controller');
};

/**
 * Emit event to specific user
 */
const emitToUser = (userId, event, data) => {
  if (io) {
    io.to(`user:${userId}`).emit(event, data);
    logger.info('Socket event emitted', { userId, event });
  }
};

/**
 * Emit event to specific driver
 */
const emitToDriver = (driverId, event, data) => {
  if (io) {
    io.to(`driver:${driverId}`).emit(event, data);
    logger.info('Socket event emitted to driver', { driverId, event });
  }
};

/**
 * Broadcast booking request to available drivers
 */
const broadcastToAvailableDrivers = async (booking, vehicleType) => {
  if (!io) return;

  try {
    // Find available drivers with matching vehicle type
    const availableDrivers = await Driver.find({
      isAvailable: true,
      isVerified: true
    }).populate({
      path: 'vehicleId',
      match: { type: vehicleType, isAvailable: true }
    });

    const matchingDrivers = availableDrivers.filter(driver => driver.vehicleId);

    logger.info('Broadcasting to available drivers', {
      bookingId: booking.bookingId,
      driversCount: matchingDrivers.length
    });

    // Emit to each driver
    matchingDrivers.forEach(driver => {
      io.to(`driver:${driver._id}`).emit('new-booking-request', {
        bookingId: booking.bookingId,
        booking: {
          id: booking._id,
          bookingId: booking.bookingId,
          pickupLocation: booking.pickupLocation,
          dropLocation: booking.dropLocation,
          startDateTime: booking.startDateTime,
          vehicleType: booking.vehicleType,
          fareDetails: booking.fareDetails,
          passengerDetails: {
            name: booking.passengerDetails.name,
            phone: booking.passengerDetails.phone
          }
        },
        expiresAt: new Date(Date.now() + 5 * 60 * 1000) // 5 minutes to accept
      });
    });

    return matchingDrivers.length;
  } catch (error) {
    logger.error('Error broadcasting to drivers', { error: error.message });
    return 0;
  }
};

/**
 * @desc    Search for available cabs and get pricing
 * @route   POST /api/bookings/search
 * @access  Public
 */
export const searchCabs = catchAsync(async (req, res) => {
  const { from, to, date, type, distance, startDateTime, fromCoordinates, toCoordinates } = req.body;

  // ========================================
  // VALIDATION
  // ========================================

  if (!from || !to) {
    throw new BadRequestError('Pickup and drop locations are required');
  }

  if (!type) {
    throw new BadRequestError('Booking type is required');
  }

  if (!Object.values(BOOKING_TYPES).includes(type)) {
    throw new BadRequestError(`Invalid booking type: ${type}`);
  }

  // Validate date (must be at least 2 hours in future)
  const tripDate = new Date(date || startDateTime);
  
  if (isNaN(tripDate.getTime())) {
    throw new BadRequestError('Invalid date format');
  }

  const minBookingTime = addHours(new Date(), BOOKING_CONFIG.MIN_BOOKING_HOURS_AHEAD);
  
  if (tripDate < minBookingTime) {
    throw new BadRequestError(
      `Booking must be at least ${BOOKING_CONFIG.MIN_BOOKING_HOURS_AHEAD} hours in advance`
    );
  }

  const maxBookingTime = addDays(new Date(), BOOKING_CONFIG.ADVANCE_BOOKING_DAYS);
  
  if (tripDate > maxBookingTime) {
    throw new BadRequestError(
      `Cannot book more than ${BOOKING_CONFIG.ADVANCE_BOOKING_DAYS} days in advance`
    );
  }

  // ========================================
  // DISTANCE CALCULATION
  // ========================================

  let estimatedDistance = distance;

  // Calculate distance from coordinates if provided
  if (!estimatedDistance && fromCoordinates && toCoordinates) {
    try {
      estimatedDistance = pricingService.calculateDistanceFromCoordinates(
        fromCoordinates,
        toCoordinates
      );
      logger.info('Distance calculated from coordinates', { estimatedDistance });
    } catch (error) {
      logger.warn('Failed to calculate distance from coordinates', { error: error.message });
      estimatedDistance = 100; // Default fallback
    }
  }

  if (!estimatedDistance) {
    estimatedDistance = 100; // Default fallback
  }

  logger.info('Cab search initiated', { 
    from, 
    to, 
    type, 
    distance: estimatedDistance,
    userId: req.user?._id || 'guest',
    tripDate: tripDate.toISOString()
  });

  // ========================================
  // GET VEHICLE OPTIONS WITH PRICING
  // ========================================

  const vehicleOptions = pricingService.getVehicleOptions(type, {
    distance: estimatedDistance,
    startDateTime: tripDate
  });

  // ========================================
  // CHECK ACTUAL VEHICLE AVAILABILITY (Optional)
  // ========================================

  // Get available vehicle counts
  const vehicleAvailability = await Promise.all(
    vehicleOptions.map(async (option) => {
      const count = await Vehicle.countDocuments({
        type: option.vehicleType,
        isAvailable: true
      });
      return { vehicleType: option.vehicleType, availableCount: count };
    })
  );

  // Add availability info to options
  vehicleOptions.forEach(option => {
    const availability = vehicleAvailability.find(
      v => v.vehicleType === option.vehicleType
    );
    option.availableVehicles = availability?.availableCount || 0;
    option.available = option.availableVehicles > 0;
  });

  // ========================================
  // RESPONSE
  // ========================================

  const searchResults = {
    searchId: `SRCH${Date.now()}${Math.random().toString(36).substring(7)}`.toUpperCase(),
    from,
    to,
    date: tripDate,
    type,
    distance: estimatedDistance,
    options: vehicleOptions,
    validUntil: addHours(new Date(), 1), // Valid for 1 hour
    timestamp: new Date(),
    hasCoordinates: !!(fromCoordinates && toCoordinates)
  };

  logger.info('Search results generated', {
    searchId: searchResults.searchId,
    optionsCount: vehicleOptions.length,
    availableOptionsCount: vehicleOptions.filter(o => o.available).length
  });

  return sendSuccess(res, searchResults, 'Search results retrieved successfully', 200);
});

/**
 * @desc    Create a new booking
 * @route   POST /api/bookings
 * @access  Private
 */
export const createBooking = catchAsync(async (req, res) => {
  const {
    bookingType,
    pickupLocation,
    dropLocation,
    startDateTime,
    endDateTime,
    vehicleType,
    passengerDetails,
    fareDetails,
    specialRequests,
    notes,
    searchId
  } = req.body;

  // ========================================
  // VALIDATION
  // ========================================

  // Validate booking date
  const tripDate = new Date(startDateTime);
  
  if (isNaN(tripDate.getTime())) {
    throw new BadRequestError('Invalid start date/time');
  }

  const minBookingTime = addHours(new Date(), BOOKING_CONFIG.MIN_BOOKING_HOURS_AHEAD);
  const maxBookingTime = addDays(new Date(), BOOKING_CONFIG.ADVANCE_BOOKING_DAYS);

  if (tripDate < minBookingTime) {
    throw new BadRequestError(
      `Booking must be at least ${BOOKING_CONFIG.MIN_BOOKING_HOURS_AHEAD} hours in advance`
    );
  }

  if (tripDate > maxBookingTime) {
    throw new BadRequestError(
      `Cannot book more than ${BOOKING_CONFIG.ADVANCE_BOOKING_DAYS} days in advance`
    );
  }

  // Check for duplicate bookings (same user, same time, not cancelled)
  const existingBooking = await Booking.findOne({
    userId: req.user._id,
    startDateTime: {
      $gte: new Date(tripDate.getTime() - 30 * 60 * 1000), // 30 min before
      $lte: new Date(tripDate.getTime() + 30 * 60 * 1000)  // 30 min after
    },
    status: { $nin: [BOOKING_STATUS.CANCELLED, BOOKING_STATUS.COMPLETED] }
  });

  if (existingBooking) {
    throw new ConflictError(
      `You already have a booking at ${existingBooking.startDateTime.toLocaleString()}. Please cancel it first or choose a different time.`
    );
  }

  // Validate fare amount
  if (!fareDetails || !fareDetails.finalAmount || fareDetails.finalAmount < 0) {
    throw new BadRequestError('Invalid fare details');
  }

  logger.info('Creating new booking', { 
    userId: req.user._id,
    bookingType,
    vehicleType,
    startDateTime: tripDate.toISOString()
  });

  // ========================================
  // CREATE BOOKING
  // ========================================

  const booking = await Booking.create({
    userId: req.user._id,
    bookingType,
    pickupLocation,
    dropLocation,
    startDateTime: tripDate,
    endDateTime: endDateTime ? new Date(endDateTime) : null,
    vehicleType,
    passengerDetails,
    fareDetails,
    status: BOOKING_STATUS.CONFIRMED,
    specialRequests: specialRequests || [],
    notes,
    metadata: {
      source: 'MOBILE_APP',
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
      searchId
    }
  });

  // Populate user details
  await booking.populate('userId', 'phoneNumber name email');

  logger.info('Booking created successfully', { 
    bookingId: booking.bookingId,
    userId: req.user._id,
    status: booking.status,
    fareAmount: booking.fareDetails.finalAmount
  });

  // ========================================
  // REAL-TIME DRIVER NOTIFICATION
  // ========================================

  // Broadcast to available drivers via Socket.IO
  const driversNotified = await broadcastToAvailableDrivers(booking, vehicleType);

  // Emit to user
  emitToUser(req.user._id, 'booking-created', {
    bookingId: booking.bookingId,
    status: booking.status,
    driversNotified
  });

  // ========================================
  // ADDITIONAL ACTIONS (Production)
  // ========================================

  // TODO: Send confirmation SMS to user
  // TODO: Send booking confirmation email
  // TODO: Create payment intent if prepayment required
  // TODO: Schedule driver assignment job (2 hours before trip)

  return sendSuccess(
    res, 
    {
      booking,
      driversNotified,
      message: 'Your booking has been confirmed. Nearby drivers have been notified.'
    }, 
    'Booking created successfully', 
    201
  );
});

/**
 * @desc    Driver accepts booking request
 * @route   POST /api/bookings/:id/accept
 * @access  Private (Driver only)
 */
export const acceptBookingByDriver = catchAsync(async (req, res) => {
  const { driverId, estimatedArrival } = req.body;

  if (!driverId) {
    throw new BadRequestError('Driver ID is required');
  }

  // Find booking
  const booking = await Booking.findById(req.params.id);

  if (!booking) {
    throw new NotFoundError('Booking not found');
  }

  // Check if already assigned
  if (booking.status === BOOKING_STATUS.ASSIGNED) {
    throw new ConflictError('This booking has already been accepted by another driver');
  }

  if (booking.status !== BOOKING_STATUS.CONFIRMED) {
    throw new BadRequestError(`Cannot accept booking with status: ${booking.status}`);
  }

  // Verify driver exists and is available
  const driver = await Driver.findById(driverId).populate('vehicleId');

  if (!driver) {
    throw new NotFoundError('Driver not found');
  }

  if (!driver.isAvailable) {
    throw new BadRequestError('Driver is not available');
  }

  if (!driver.isVerified) {
    throw new BadRequestError('Driver is not verified');
  }

  // Check if driver has matching vehicle type
  if (!driver.vehicleId || driver.vehicleId.type !== booking.vehicleType) {
    throw new BadRequestError('Driver vehicle type does not match booking requirement');
  }

  // ========================================
  // ASSIGN DRIVER TO BOOKING
  // ========================================

  await booking.assignDriver(driverId, driver.vehicleId._id);

  // Update driver availability
  driver.isAvailable = false;
  await driver.save();

  logger.info('Booking accepted by driver', {
    bookingId: booking.bookingId,
    driverId: driver._id,
    driverName: driver.name
  });

  // ========================================
  // REAL-TIME NOTIFICATIONS
  // ========================================

  // Notify user via Socket.IO
  emitToUser(booking.userId, 'driver-assigned', {
    bookingId: booking.bookingId,
    driver: {
      id: driver._id,
      name: driver.name,
      phone: driver.phoneNumber,
      rating: driver.rating,
      vehicleNumber: driver.vehicleId.licensePlate,
      vehicleModel: driver.vehicleId.modelName,
      estimatedArrival
    }
  });

  // Notify other drivers that booking is taken
  if (io) {
    io.emit('booking-assigned', {
      bookingId: booking.bookingId,
      message: 'This booking has been accepted by another driver'
    });
  }

  // ========================================
  // SEND NOTIFICATIONS
  // ========================================

  // TODO: Send SMS to user with driver details
  // TODO: Send push notification to user
  // TODO: Send confirmation to driver

  // Populate full booking details
  await booking.populate([
    { path: 'userId', select: 'phoneNumber name email' },
    { path: 'vehicleId' },
    { path: 'driverId', select: 'name phoneNumber rating totalRides' }
  ]);

  return sendSuccess(
    res,
    {
      booking,
      message: 'Booking accepted successfully. Customer has been notified.'
    },
    'Booking accepted successfully',
    200
  );
});

/**
 * @desc    Driver rejects booking request
 * @route   POST /api/bookings/:id/reject
 * @access  Private (Driver only)
 */
export const rejectBookingByDriver = catchAsync(async (req, res) => {
  const { driverId, reason } = req.body;

  if (!driverId) {
    throw new BadRequestError('Driver ID is required');
  }

  const booking = await Booking.findById(req.params.id);

  if (!booking) {
    throw new NotFoundError('Booking not found');
  }

  logger.info('Booking rejected by driver', {
    bookingId: booking.bookingId,
    driverId,
    reason
  });

  // Emit to specific driver that rejection was recorded
  emitToDriver(driverId, 'booking-rejection-recorded', {
    bookingId: booking.bookingId,
    message: 'Rejection recorded'
  });

  return sendSuccess(
    res,
    { message: 'Rejection recorded. Booking will be offered to other drivers.' },
    'Rejection recorded',
    200
  );
});

/**
 * @desc    Get booking by database ID
 * @route   GET /api/bookings/:id
 * @access  Private
 */
export const getBooking = catchAsync(async (req, res) => {
  const booking = await Booking.findOne({
    _id: req.params.id,
    userId: req.user._id
  })
    .populate('userId', 'phoneNumber name email')
    .populate('vehicleId')
    .populate('driverId', 'name phoneNumber rating totalRides');

  if (!booking) {
    logger.warn('Booking not found', { 
      bookingId: req.params.id,
      userId: req.user._id 
    });
    throw new NotFoundError('Booking not found');
  }

  logger.info('Booking retrieved', { 
    bookingId: booking.bookingId,
    userId: req.user._id 
  });

  return sendSuccess(res, booking, 'Booking retrieved successfully', 200);
});

/**
 * @desc    Get booking by booking code
 * @route   GET /api/bookings/code/:bookingId
 * @access  Private
 */
export const getBookingByCode = catchAsync(async (req, res) => {
  const booking = await Booking.findOne({
    bookingId: req.params.bookingId,
    userId: req.user._id
  })
    .populate('userId', 'phoneNumber name email')
    .populate('vehicleId')
    .populate('driverId', 'name phoneNumber rating totalRides currentLocation');

  if (!booking) {
    logger.warn('Booking not found by code', { 
      bookingId: req.params.bookingId,
      userId: req.user._id 
    });
    throw new NotFoundError('Booking not found');
  }

  logger.info('Booking retrieved by code', { 
    bookingId: booking.bookingId 
  });

  return sendSuccess(res, booking, 'Booking retrieved successfully', 200);
});

/**
 * @desc    Get all bookings for current user
 * @route   GET /api/bookings
 * @access  Private
 */
export const getAllBookings = catchAsync(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const { status, bookingType, fromDate, toDate } = req.query;

  // Build query
  const query = { userId: req.user._id };

  if (status) {
    const statuses = status.split(',').map(s => s.toUpperCase());
    query.status = { $in: statuses };
  }

  if (bookingType) {
    query.bookingType = bookingType.toUpperCase();
  }

  if (fromDate || toDate) {
    query.startDateTime = {};
    if (fromDate) {
      const from = new Date(fromDate);
      if (!isNaN(from.getTime())) {
        query.startDateTime.$gte = from;
      }
    }
    if (toDate) {
      const to = new Date(toDate);
      if (!isNaN(to.getTime())) {
        query.startDateTime.$lte = to;
      }
    }
  }

  // Get bookings with pagination
  const bookings = await Booking.find(query)
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .populate('vehicleId', 'type modelName licensePlate')
    .populate('driverId', 'name phoneNumber rating');

  // Get total count
  const total = await Booking.countDocuments(query);

  logger.info('User bookings retrieved', { 
    userId: req.user._id,
    count: bookings.length,
    total,
    filters: { status, bookingType, fromDate, toDate }
  });

  return sendPaginatedResponse(
    res,
    bookings,
    page,
    limit,
    total,
    'Bookings retrieved successfully'
  );
});

/**
 * @desc    Cancel booking
 * @route   PATCH /api/bookings/:id/cancel
 * @access  Private
 */
export const cancelBooking = catchAsync(async (req, res) => {
  const { reason } = req.body;

  const booking = await Booking.findOne({
    _id: req.params.id,
    userId: req.user._id
  }).populate('driverId');

  if (!booking) {
    throw new NotFoundError('Booking not found');
  }

  // Check if booking can be cancelled
  const { canCancel, reason: cancelReason, charge } = booking.canBeCancelled();

  if (!canCancel) {
    throw new BadRequestError(cancelReason);
  }

  // Cancel the booking
  await booking.cancelBooking('USER', reason || 'User requested cancellation');

  // If driver was assigned, make driver available again
  if (booking.driverId) {
    const driver = await Driver.findById(booking.driverId);
    if (driver) {
      driver.isAvailable = true;
      await driver.save();

      // Notify driver via Socket.IO
      emitToDriver(driver._id, 'booking-cancelled', {
        bookingId: booking.bookingId,
        message: 'Customer cancelled the booking',
        reason
      });
    }
  }

  logger.info('Booking cancelled', { 
    bookingId: booking.bookingId,
    userId: req.user._id,
    cancellationCharge: charge,
    reason
  });

  // Emit to user
  emitToUser(req.user._id, 'booking-cancelled-confirmed', {
    bookingId: booking.bookingId,
    refundAmount: booking.fareDetails.finalAmount - charge
  });

  // TODO: Process refund if applicable
  // TODO: Send cancellation confirmation SMS/email

  return sendSuccess(
    res, 
    {
      booking,
      cancellationCharge: charge,
      refundAmount: booking.fareDetails.finalAmount - charge,
      refundNote: charge > 0 
        ? `₹${charge} cancellation charge will be deducted. Refund of ₹${booking.fareDetails.finalAmount - charge} will be processed within 5-7 business days.`
        : 'Full refund will be processed within 5-7 business days.'
    }, 
    'Booking cancelled successfully', 
    200
  );
});

/**
 * @desc    Start trip (Driver)
 * @route   POST /api/bookings/:id/start
 * @access  Private (Driver)
 */
export const startTrip = catchAsync(async (req, res) => {
  const { startOdometer, driverId } = req.body;

  const booking = await Booking.findById(req.params.id);

  if (!booking) {
    throw new NotFoundError('Booking not found');
  }

  if (booking.driverId.toString() !== driverId) {
    throw new BadRequestError('Only assigned driver can start the trip');
  }

  await booking.startTrip(startOdometer);

  logger.info('Trip started', {
    bookingId: booking.bookingId,
    driverId,
    startOdometer
  });

  // Notify user
  emitToUser(booking.userId, 'trip-started', {
    bookingId: booking.bookingId,
    startTime: booking.trip.actualStartTime,
    driver: {
      name: booking.driverId.name,
      phone: booking.driverId.phoneNumber
    }
  });

  return sendSuccess(res, booking, 'Trip started successfully', 200);
});

/**
 * @desc    Complete trip (Driver)
 * @route   POST /api/bookings/:id/complete
 * @access  Private (Driver)
 */
export const completeTrip = catchAsync(async (req, res) => {
  const { endOdometer, driverId } = req.body;

  const booking = await Booking.findById(req.params.id);

  if (!booking) {
    throw new NotFoundError('Booking not found');
  }

  if (booking.driverId.toString() !== driverId) {
    throw new BadRequestError('Only assigned driver can complete the trip');
  }

  await booking.completeTrip(endOdometer);

  // Make driver available again
  const driver = await Driver.findById(driverId);
  if (driver) {
    driver.isAvailable = true;
    driver.completedRides += 1;
    await driver.save();
  }

  logger.info('Trip completed', {
    bookingId: booking.bookingId,
    driverId,
    endOdometer,
    actualDistance: booking.trip.actualDistance
  });

  // Notify user
  emitToUser(booking.userId, 'trip-completed', {
    bookingId: booking.bookingId,
    endTime: booking.trip.actualEndTime,
    actualDistance: booking.trip.actualDistance,
    finalAmount: booking.fareDetails.finalAmount
  });

  return sendSuccess(res, booking, 'Trip completed successfully', 200);
});

/**
 * @desc    Add rating to completed booking
 * @route   POST /api/bookings/:id/rating
 * @access  Private
 */
export const addRating = catchAsync(async (req, res) => {
  const { rating, comment } = req.body;

  if (!rating || rating < 1 || rating > 5) {
    throw new BadRequestError('Rating must be between 1 and 5');
  }

  const booking = await Booking.findOne({
    _id: req.params.id,
    userId: req.user._id
  }).populate('driverId');

  if (!booking) {
    throw new NotFoundError('Booking not found');
  }

  if (booking.status !== BOOKING_STATUS.COMPLETED) {
    throw new BadRequestError('Can only rate completed bookings');
  }

  if (booking.rating && booking.rating.value) {
    throw new ConflictError('Booking has already been rated');
  }

  await booking.addRating(rating, comment);

  // Update driver rating
  if (booking.driverId) {
    await booking.driverId.updateRating(rating);
    
    // Notify driver
    emitToDriver(booking.driverId._id, 'rating-received', {
      bookingId: booking.bookingId,
      rating,
      comment,
      newOverallRating: booking.driverId.rating
    });
  }

  logger.info('Rating added to booking', {
    bookingId: booking.bookingId,
    rating,
    driverId: booking.driverId?._id
  });

  return sendSuccess(res, booking, 'Rating submitted successfully', 200);
});

/**
 * @desc    Get booking statistics
 * @route   GET /api/bookings/stats
 * @access  Private
 */
export const getBookingStats = catchAsync(async (req, res) => {
  const userId = req.user._id;

  const [totalBookings, stats, favoriteVehicle] = await Promise.all([
    Booking.countDocuments({ userId }),
    Booking.aggregate([
      { $match: { userId } },
      {
        $group: {
          _id: null,
          completed: {
            $sum: { $cond: [{ $eq: ['$status', BOOKING_STATUS.COMPLETED] }, 1, 0] }
          },
          cancelled: {
            $sum: { $cond: [{ $eq: ['$status', BOOKING_STATUS.CANCELLED] }, 1, 0] }
          },
          totalSpent: {
            $sum: {
              $cond: [
                { $eq: ['$status', BOOKING_STATUS.COMPLETED] },
                '$fareDetails.finalAmount',
                0
              ]
            }
          }
        }
      }
    ]),
    Booking.aggregate([
      { $match: { userId } },
      { $group: { _id: '$vehicleType', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 1 }
    ])
  ]);

  const result = {
    totalBookings,
    completedBookings: stats[0]?.completed || 0,
    cancelledBookings: stats[0]?.cancelled || 0,
    upcomingBookings: await Booking.countDocuments({
      userId,
      startDateTime: { $gte: new Date() },
      status: { $in: [BOOKING_STATUS.CONFIRMED, BOOKING_STATUS.ASSIGNED] }
    }),
    totalSpent: Math.round(stats[0]?.totalSpent || 0),
    favoriteVehicleType: favoriteVehicle[0]?._id || null,
    completionRate: totalBookings > 0
      ? Math.round(((stats[0]?.completed || 0) / totalBookings) * 100)
      : 0
  };

  return sendSuccess(res, result, 'Statistics retrieved successfully', 200);
});

export default {
  setSocketIO,
  searchCabs,
  createBooking,
  acceptBookingByDriver,
  rejectBookingByDriver,
  getBooking,
  getBookingByCode,
  getAllBookings,
  cancelBooking,
  startTrip,
  completeTrip,
  addRating,
  getBookingStats
};