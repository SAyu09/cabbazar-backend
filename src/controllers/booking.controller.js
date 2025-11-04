// src/controllers/booking.controller.js - REFACTORED
import axios from 'axios';
import { Booking, User, Vehicle } from '../models/index.js';
import pricingService from '../services/pricing.service.js';
// IMPORT THE NEW GEO SERVICE
import geoService from '../services/geo.service.js'; 
import { sendSuccess, sendPaginatedResponse } from '../utils/response.js';
import { catchAsync } from '../utils/catchAsync.js';
import {
  NotFoundError,
  BadRequestError,
  ConflictError,
  ServiceUnavailableError,
  AuthorizationError
} from '../utils/customError.js';
import {
  BOOKING_STATUS,
  BOOKING_TYPES,
  BOOKING_CONFIG,
  PAYMENT_STATUS,
  PAYMENT_METHODS,
  VEHICLE_TYPES,
  TAX_CONFIG
} from '../config/constants.js';
import {
  parsePagination,
  addDays,
  addHours,
  generateBookingReference,
  calculateGST
} from '../utils/helpers.js';
import logger from '../config/logger.js';
import {
  sendBookingNotification,
  sendDriverNotification
} from '../utils/notification.utils.js';

// --- Configuration ---
// All Nominatim and OSRM constants are removed

// Local rental types
const localRentalTypes = [
  BOOKING_TYPES.LOCAL_2_20,
  BOOKING_TYPES.LOCAL_4_40,
  BOOKING_TYPES.LOCAL_8_80,
  BOOKING_TYPES.LOCAL_12_120
];

// Fixed airport distances (in KM) - expand as needed
const AIRPORT_DISTANCES_KM = {
  'agra_agra airport (agr)': 7,
  'agra airport (agr)_agra': 7,
  'delhi_indira gandhi international (del)': 12,
  'indira gandhi international (del)_delhi': 12,
  'mumbai_chhatrapati shivaji (bom)': 15,
  'chhatrapati shivaji (bom)_mumbai': 15,
  // Add more as needed
};

// ========================================
// HELPER FUNCTIONS
// ========================================

// All Nominatim/OSRM helper functions (normalizeAddress, callNominatim, getCoordinatesFromAddressNominatim, getDrivingDistanceOSRM) are REMOVED.
// They are now handled by geo.service.js

/**
 * Get fixed airport distance if available
 */
function getAirportFixedDistance(pickup, drop) {
  if (!pickup || !drop) return null;
  const key = `${pickup.toLowerCase().trim()}_${drop.toLowerCase().trim()}`;
  const revKey = `${drop.toLowerCase().trim()}_${pickup.toLowerCase().trim()}`;
  return AIRPORT_DISTANCES_KM[key] ?? AIRPORT_DISTANCES_KM[revKey] ?? null;
}

/**
 * Build clean location object for database
 */
function buildLocationObject(locationData) {
  if (!locationData || !locationData.city) {
    throw new BadRequestError('Location must have at least a city');
  }
  return {
    city: locationData.city.trim(),
    address: locationData.address ? locationData.address.trim() : undefined,
    // Store coordinates if available
    lat: locationData.lat || undefined,
    lng: locationData.lng || undefined,
  };
}

// ========================================
// CONTROLLER FUNCTIONS
// ========================================

/**
 * @desc    Search for available cabs and get pricing
 * @route   POST /api/bookings/search
 * @access  Public
 */
export const searchCabs = catchAsync(async (req, res) => {
  const {
    from,
    to,
    date,
    type,
    distance,
    startDateTime,
    fromCoordinates,
    toCoordinates
  } = req.body;

  // Validation
  if (!from || !to) {
    throw new BadRequestError('Pickup (from) and drop-off (to) locations are required');
  }
  if (!type || !Object.values(BOOKING_TYPES).includes(type)) {
    throw new BadRequestError(`Invalid booking type: ${type}`);
  }

  const isLocalRental = localRentalTypes.includes(type);
  const isAirportTransfer = [BOOKING_TYPES.AIRPORT_DROP, BOOKING_TYPES.AIRPORT_PICKUP].includes(type);

  const tripDate = new Date(date || startDateTime);
  if (isNaN(tripDate.getTime())) throw new BadRequestError('Invalid date format');

  const minBookingTime = addHours(new Date(), BOOKING_CONFIG.MIN_BOOKING_HOURS_AHEAD);
  const maxBookingTime = addDays(new Date(), BOOKING_CONFIG.ADVANCE_BOOKING_DAYS);
  if (tripDate < minBookingTime) {
    throw new BadRequestError(`Booking must be at least ${BOOKING_CONFIG.MIN_BOOKING_HOURS_AHEAD} hours in advance`);
  }
  if (tripDate > maxBookingTime) {
    throw new BadRequestError(`Cannot book more than ${BOOKING_CONFIG.ADVANCE_BOOKING_DAYS} days in advance`);
  }

  // --- REFACTORED DISTANCE LOGIC ---
  let estimatedDistance = distance;
  let originCoords = fromCoordinates;
  let destinationCoords = toCoordinates;
  let distanceSource = 'user_provided';
  let duration = 0;

  if (isLocalRental) {
    estimatedDistance = 0;
    distanceSource = 'local_package';
  } else if (estimatedDistance && estimatedDistance > 0) {
    distanceSource = 'user_provided_distance';
  } else {
    // Geocoding and Distance calculation using Google Maps
    distanceSource = 'api_calculated (google)';

    if (!geoService.isAvailable()) {
      throw new ServiceUnavailableError('Geocoding/Distance service is not available. Please try again later.');
    }

    try {
      // 1. Get Origin Coords
      if (!originCoords || typeof originCoords.lat !== 'number') {
        logger.info('Geocoding origin address', { from });
        originCoords = await geoService.geocode(from);
      } else {
        distanceSource = 'user_provided_coordinates';
      }

      // 2. Get Destination Coords
      if (!destinationCoords || typeof destinationCoords.lat !== 'number') {
        logger.info('Geocoding destination address', { to });
        destinationCoords = await geoService.geocode(to);
      } else {
        distanceSource = 'user_provided_coordinates';
      }

      // 3. Get Distance Matrix
      // Use airport fixed distance as a fallback if Google fails
      if (isAirportTransfer) {
        estimatedDistance = getAirportFixedDistance(from, to);
        if (estimatedDistance) distanceSource = 'airport_fixed_table';
      }

      // If we still don't have a distance, call Google Distance Matrix
      if (!estimatedDistance && originCoords && destinationCoords) {
        const matrix = await geoService.getDistanceMatrix(originCoords, destinationCoords);
        estimatedDistance = matrix.distance; // in KM
        duration = matrix.duration; // in Minutes
        distanceSource = 'api_google_matrix';
      }
      
    } catch (error) {
      logger.error('Failed to get Google geo-data', { error: error.message, from, to });
      // Fallback to straight-line distance if API fails
      if (originCoords && destinationCoords && !estimatedDistance) {
         estimatedDistance = pricingService.calculateDistanceFromCoordinates(originCoords, destinationCoords);
         distanceSource = 'api_fallback_straight_line';
         logger.warn('Google Matrix failed, using fallback distance', { estimatedDistance });
      } else {
         throw new BadRequestError(`Could not determine distance: ${error.message}`);
      }
    }
  }

  if (!isLocalRental && (!estimatedDistance || estimatedDistance <= 0)) {
    throw new BadRequestError('Could not determine a valid distance for this route.');
  }

  const vehicleOptions = pricingService.getVehicleOptions(type, {
    distance: estimatedDistance,
    startDateTime: tripDate
  });

  const searchResults = {
    searchId: generateBookingReference(),
    from,
    to,
    date: tripDate,
    type,
    distance: estimatedDistance,
    durationMinutes: duration > 0 ? duration : null,
    distanceSource,
    originCoords,
    destinationCoords,
    options: vehicleOptions,
    validUntil: addHours(new Date(), 1),
    timestamp: new Date(),
  };

  logger.info('Search successful (Google)', { searchId: searchResults.searchId, distance: estimatedDistance, source: distanceSource });
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
    pickupLocation, // Expects { city, address, lat?, lng? }
    dropLocation,   // Expects { city, address, lat?, lng? }
    viaLocations,
    startDateTime,
    endDateTime,
    vehicleType,
    passengerDetails,
    fareDetails,
    specialRequests,
    notes,
    searchId
  } = req.body;

  // Validation
  if (!bookingType || !pickupLocation || !startDateTime || !vehicleType || !fareDetails) {
    throw new BadRequestError('Missing required booking information');
  }
  if (typeof pickupLocation !== 'object' || !pickupLocation.city) {
    throw new BadRequestError('Invalid pickupLocation: "city" is required.');
  }

  const isLocalRental = localRentalTypes.includes(bookingType);
  if (!isLocalRental && (!dropLocation || !dropLocation.city)) {
    throw new BadRequestError('dropLocation.city is required for this booking type.');
  }

  if (typeof fareDetails.finalAmount !== 'number' || fareDetails.finalAmount < 0) {
    throw new BadRequestError('Invalid finalAmount in fareDetails.');
  }
  if (!Object.values(VEHICLE_TYPES).includes(vehicleType)) {
    throw new BadRequestError(`Invalid vehicle type: ${vehicleType}`);
  }

  const tripDate = new Date(startDateTime);
  if (isNaN(tripDate)) throw new BadRequestError('Invalid start date/time.');

  const minBookingTime = addHours(new Date(), BOOKING_CONFIG.MIN_BOOKING_HOURS_AHEAD);
  const maxBookingTime = addDays(new Date(), BOOKING_CONFIG.ADVANCE_BOOKING_DAYS);
  if (tripDate < minBookingTime || tripDate > maxBookingTime) {
    throw new BadRequestError('Booking time outside allowed window.');
  }

  // Passenger details
  let finalPassengerDetails = {
    name: req.user.name || 'Guest User',
    phone: req.user.phoneNumber,
    email: req.user.email
  };
  if (passengerDetails) {
    if (!passengerDetails.name || !/^[6-9]\d{9}$/.test(passengerDetails.phone?.replace(/\D/g, ''))) {
      throw new BadRequestError('Valid passenger name and 10-digit phone required.');
    }
    finalPassengerDetails = {
      name: passengerDetails.name.trim(),
      phone: passengerDetails.phone.replace(/\D/g, ''),
      email: passengerDetails.email?.trim().toLowerCase() || null
    };
  }

  // Duplicate check
  const timeBuffer = 30 * 60 * 1000;
  const existing = await Booking.findOne({
    userId: req.user._id,
    startDateTime: { $gte: new Date(tripDate - timeBuffer), $lte: new Date(tripDate + timeBuffer) },
    status: { $nin: [BOOKING_STATUS.CANCELLED, BOOKING_STATUS.COMPLETED, BOOKING_STATUS.REJECTED] }
  });
  if (existing) throw new ConflictError(`Conflicting booking: ${existing.bookingId}`);

  // Build locations (now includes lat/lng)
  let cleanPickupLocation, cleanDropLocation;
  try {
    cleanPickupLocation = buildLocationObject(pickupLocation);
    cleanDropLocation = isLocalRental
      ? buildLocationObject(dropLocation || pickupLocation)
      : buildLocationObject(dropLocation);
  } catch (err) {
    throw new BadRequestError(`Invalid location: ${err.message}`);
  }

  // Create booking
  const booking = await Booking.create({
    userId: req.user._id,
    bookingType,
    pickupLocation: cleanPickupLocation,
    dropLocation: cleanDropLocation,
    viaLocations: viaLocations || [],
    startDateTime: tripDate,
    endDateTime: endDateTime ? new Date(endDateTime) : null,
    vehicleType,
    passengerDetails: finalPassengerDetails,
    fareDetails,
    status: BOOKING_STATUS.CONFIRMED,
    specialRequests: Array.isArray(specialRequests) ? specialRequests : [],
    notes: notes || null,
    metadata: { source: req.headers['x-app-source'] || 'API', ipAddress: req.ip, userAgent: req.get('user-agent'), searchId }
  });

  await booking.populate('userId', 'deviceInfo name email phoneNumber');
  logger.info('Booking created', { bookingId: booking.bookingId, userId: req.user._id });

  // Notification
  const user = booking.userId;
  if (user?.deviceInfo?.[0]?.fcmToken) {
    const dropText = isLocalRental ? 'local ride' : `to ${cleanDropLocation.city}`;
    sendBookingNotification(
      user.deviceInfo[0].fcmToken,
      booking.bookingId,
      'confirmed',
      `Booking ${booking.bookingId} from ${cleanPickupLocation.city} ${dropText} confirmed.`
    ).catch(() => { });
  }

  return sendSuccess(res, { booking: booking.toObject({ virtuals: true }) }, 'Booking created', 201);
});


// ... (The rest of your controller functions: getBooking, getBookingByCode, getAllBookings, etc., remain unchanged) ...
// ... (Make sure to export them all at the end) ...

export const getBooking = catchAsync(async (req, res) => {
  const bookingDbId = req.params.id;
  console.log("Booking DB ID:", bookingDbId);

  const booking = await Booking.findOne({
    _id: bookingDbId,
    userId: req.user._id
  })
    .populate('userId', 'phoneNumber name email profilePicture')
    .populate('vehicleId', 'type modelName licensePlate color capacity features year fuelType')
    .populate({
      path: 'driverId',
      select: 'name phoneNumber rating completedRides profilePicture vehicleId',
      model: 'User'
    });

  if (!booking) {
    logger.warn('Booking not found by DB ID or user mismatch', {
      bookingDbId,
      userId: req.user._id
    });
    throw new NotFoundError('Booking not found');
  }

  logger.info('Booking retrieved by DB ID', {
    bookingId: booking.bookingId,
    dbId: booking._id,
    userId: req.user._id
  });

  return sendSuccess(res, booking.toObject({ virtuals: true }), 'Booking retrieved successfully', 200);
});
export const getBookingByCode = catchAsync(async (req, res) => {
  const bookingCode = req.params.bookingId?.toUpperCase();
  if (!bookingCode) {
    throw new BadRequestError("Booking code parameter is required.");
  }

  const booking = await Booking.findOne({
    bookingId: bookingCode,
    userId: req.user._id
  })
    .populate('userId', 'phoneNumber name email profilePicture')
    .populate('vehicleId', 'type modelName licensePlate color capacity features year fuelType')
    .populate('driverId', 'name phoneNumber rating totalRides profilePicture vehicleId');

  if (!booking) {
    logger.warn('Booking not found by code or user mismatch', {
      bookingCode,
      userId: req.user._id
    });
    throw new NotFoundError(`Booking with code ${bookingCode} not found`);
  }

  logger.info('Booking retrieved by code', {
    bookingId: booking.bookingId,
    dbId: booking._id,
    userId: req.user._id
  });

  return sendSuccess(res, booking.toObject({ virtuals: true }), 'Booking retrieved successfully', 200);
});
export const getAllBookings = catchAsync(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const { status, bookingType, fromDate, toDate, sortBy = '-createdAt' } = req.query;
  const query = { userId: req.user._id };

  if (status) {
    const statuses = status.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
    if (statuses.length > 0) {
      const validStatuses = Object.values(BOOKING_STATUS);
      const invalid = statuses.filter(s => !validStatuses.includes(s));
      if (invalid.length > 0) {
        throw new BadRequestError(`Invalid status values: ${invalid.join(', ')}. Valid are: ${validStatuses.join(', ')}`);
      }
      query.status = { $in: statuses };
    }
  }

  if (bookingType) {
    const type = bookingType.trim().toUpperCase();
    if (!Object.values(BOOKING_TYPES).includes(type)) {
      throw new BadRequestError(`Invalid bookingType: ${bookingType}. Valid are: ${Object.values(BOOKING_TYPES).join(', ')}`);
    }
    query.bookingType = type;
  }

  if (fromDate || toDate) {
    query.startDateTime = {};
    if (fromDate) {
      const from = new Date(fromDate);
      if (!isNaN(from.getTime())) {
        from.setHours(0, 0, 0, 0);
        query.startDateTime.$gte = from;
      } else {
        throw new BadRequestError('Invalid fromDate format. Use YYYY-MM-DD or ISO 8601.');
      }
    }
    if (toDate) {
      const to = new Date(toDate);
      if (!isNaN(to.getTime())) {
        to.setHours(23, 59, 59, 999);
        query.startDateTime.$lte = to;
      } else {
        throw new BadRequestError('Invalid toDate format. Use YYYY-MM-DD or ISO 8601.');
      }
    }
    if (query.startDateTime.$gte && query.startDateTime.$lte && query.startDateTime.$gte > query.startDateTime.$lte) {
      throw new BadRequestError('fromDate cannot be after toDate.');
    }
  }

  const allowedSortFields = {
    'createdAt': 1, '-createdAt': -1,
    'startDateTime': 1, '-startDateTime': -1,
    'fare': 'fareDetails.finalAmount', '-fare': '-fareDetails.finalAmount',
    'status': 1, '-status': -1
  };

  let sortQuery = { createdAt: -1 };
  if (allowedSortFields[sortBy]) {
    if (typeof allowedSortFields[sortBy] === 'number') {
      sortQuery = { [sortBy.replace('-', '')]: allowedSortFields[sortBy] };
    } else {
      const field = allowedSortFields[sortBy].replace('-', '');
      const direction = allowedSortFields[sortBy].startsWith('-') ? -1 : 1;
      sortQuery = { [field]: direction };
    }
  } else if (sortBy) {
    logger.warn('Invalid sortBy parameter received, using default.', { sortBy, allowed: Object.keys(allowedSortFields) });
  }

  const total = await Booking.countDocuments(query);
  const bookings = await Booking.find(query)
    .sort(sortQuery)
    .skip(skip)
    .limit(limit)
    .populate('vehicleId', 'type modelName licensePlate')
    .populate('driverId', 'name phoneNumber rating')
    .select('-metadata -trip -cancellation -__v -updatedAt');

  logger.info('User bookings retrieved', {
    userId: req.user._id,
    count: bookings.length,
    total,
    page,
    limit,
    filters: { status, bookingType, fromDate, toDate },
    sortBy: Object.keys(sortQuery)[0] + (Object.values(sortQuery)[0] === -1 ? ' (desc)' : ' (asc)')
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
export const cancelBooking = catchAsync(async (req, res) => {
  const { reason } = req.body;
  const bookingId = req.params.id;

  const booking = await Booking.findOne({
    _id: bookingId,
    userId: req.user._id
  }).populate('driverId', 'deviceInfo name')
    .populate('userId', 'deviceInfo name email phoneNumber');

  if (!booking) {
    throw new NotFoundError('Booking not found or you do not have permission to cancel it.');
  }

  const cancellableStatuses = [
    BOOKING_STATUS.PENDING,
    BOOKING_STATUS.CONFIRMED,
    BOOKING_STATUS.ASSIGNED
  ];

  if (!cancellableStatuses.includes(booking.status)) {
    throw new BadRequestError(
      `Cannot cancel booking. Current status is: ${booking.status}.`
    );
  }

  const hoursUntilStart = (new Date(booking.startDateTime) - new Date()) / (1000 * 60 * 60);
  let cancellationCharge = 0;
  let chargeApplied = false;

  if (hoursUntilStart < BOOKING_CONFIG.CANCELLATION_WINDOW_HOURS && hoursUntilStart >= 0) {
    cancellationCharge = Math.round(
      (booking.fareDetails.finalAmount * BOOKING_CONFIG.CANCELLATION_CHARGE_PERCENT)
    );
    chargeApplied = true;
  }

  const originalStatus = booking.status;
  booking.status = BOOKING_STATUS.CANCELLED;
  booking.cancellation = {
    cancelledBy: 'USER',
    cancelledAt: new Date(),
    reason: reason ? reason.trim().substring(0, 200) : 'Cancelled by user',
    charge: cancellationCharge
  };

  await booking.save();

  logger.info('Booking cancelled by user', {
    bookingId: booking.bookingId,
    dbId: booking._id,
    userId: req.user._id,
    originalStatus,
    cancellationCharge,
    chargeApplied,
    hoursUntilStart: hoursUntilStart.toFixed(2),
  });

  // Notify User
  const user = booking.userId;
  if (user?.deviceInfo?.length > 0) {
    const latestDevice = user.deviceInfo.sort((a, b) => new Date(b.lastUsed) - new Date(a.lastUsed))[0];
    const userFcmToken = latestDevice?.fcmToken;
    if (userFcmToken) {
      const notificationMsg = `Your booking ${booking.bookingId} has been cancelled. ${chargeApplied
        ? `Cancellation charge: ₹${cancellationCharge}.`
        : 'No cancellation charge applied.'
        }`;
      sendBookingNotification(userFcmToken, booking.bookingId, 'cancelled', notificationMsg)
        .catch(error => logger.error('Failed to send user cancellation push notification', { bookingId: booking.bookingId, error: error.message }));
    }
  }

  // Notify Driver
  const driver = booking.driverId;
  if (driver) {
    if (driver.deviceInfo?.length > 0) {
      const latestDriverDevice = driver.deviceInfo.sort((a, b) => new Date(b.lastUsed) - new Date(a.lastUsed))[0];
      const driverFcmToken = latestDriverDevice?.fcmToken;
      if (driverFcmToken) {
        sendDriverNotification(
          driverFcmToken,
          'Booking Cancelled',
          `Booking ${booking.bookingId} (Pickup: ${booking.pickupLocation.city} at ${booking.startDateTime.toLocaleTimeString()}) has been cancelled by the customer.`,
          { bookingId: booking.bookingId, reason: 'Customer Cancelled' }
        ).catch(error => logger.error('Failed to send driver cancellation push notification', { driverId: driver._id, error: error.message }));
      }
    } else {
      logger.warn('Driver was assigned but no FCM token found for cancellation push', { driverId: driver._id });
    }
  }

  // Handle Refunds
  let refundAmount = 0;
  let refundNote = 'No refund applicable.';
  if ((booking.paymentStatus === PAYMENT_STATUS.COMPLETED || booking.paymentStatus === PAYMENT_STATUS.PROCESSING) &&
    booking.paymentMethod !== PAYMENT_METHODS.CASH) {

    refundAmount = Math.max(0, booking.fareDetails.finalAmount - cancellationCharge);
    if (refundAmount > 0) {
      refundNote = chargeApplied
        ? `₹${cancellationCharge} cancellation charge applied. Refund of ₹${refundAmount} initiated.`
        : `Full refund of ₹${booking.fareDetails.finalAmount} initiated.`;
      logger.info('Refund initiation required', { bookingId: booking.bookingId, refundAmount });
    } else {
      refundNote = `Cancellation charge (₹${cancellationCharge}) equals or exceeds the paid amount. No refund due.`;
    }
  } else if (booking.paymentMethod === PAYMENT_METHODS.CASH || booking.paymentStatus === PAYMENT_STATUS.PENDING) {
    refundNote = chargeApplied
      ? `Cancellation charge of ₹${cancellationCharge} may be applicable on your next booking or collected separately.`
      : 'No cancellation charge applied.';
  }

  return sendSuccess(
    res,
    {
      bookingId: booking.bookingId,
      status: booking.status,
      cancellationCharge,
      chargeApplied,
      refundAmount,
      refundNote,
      cancelledAt: booking.cancellation.cancelledAt
    },
    'Booking cancelled successfully',
    200
  );
});
export const addRating = catchAsync(async (req, res) => {
  const { rating, comment } = req.body;
  const bookingId = req.params.id;

  const numericRating = Number(rating);
  if (isNaN(numericRating) || numericRating < 1 || numericRating > 5) {
    throw new BadRequestError('Rating must be a number between 1 and 5.');
  }
  const intRating = Math.round(numericRating);
  const cleanComment = comment ? comment.trim().substring(0, 500) : null;

  const booking = await Booking.findOne({
    _id: bookingId,
    userId: req.user._id
  }).populate('driverId', 'rating completedRides');

  if (!booking) {
    throw new NotFoundError('Booking not found or you cannot rate it.');
  }
  if (booking.status !== BOOKING_STATUS.COMPLETED) {
    throw new BadRequestError(`Only completed bookings can be rated. Current status: ${booking.status}.`);
  }
  if (booking.rating && booking.rating.value) {
    throw new ConflictError('This booking has already been rated.');
  }
  if (!booking.driverId) {
    logger.warn('Attempted to rate a completed booking with no assigned driver.', { bookingId: booking.bookingId });
  }

  booking.rating = {
    value: intRating,
    comment: cleanComment,
    createdAt: new Date()
  };
  await booking.save();

  logger.info('Rating added to booking', {
    bookingId: booking.bookingId,
    dbId: booking._id,
    userId: req.user._id,
    rating: intRating,
    driverId: booking.driverId?._id
  });

  // Update Driver's Overall Rating
  if (booking.driverId) {
    try {
      const driver = await User.findById(booking.driverId._id);
      if (driver) {
        const currentTotalRides = driver.completedRides || 1;
        const currentRating = driver.rating || 0;

        const newAverageRating = ((currentRating * (currentTotalRides - 1)) + intRating) / currentTotalRides;

        driver.rating = Math.round(newAverageRating * 10) / 10;
        await driver.save();

        logger.info("Driver's average rating updated", {
          driverId: driver._id,
          previousAvgRating: currentRating,
          newAvgRating: driver.rating,
          totalRides: currentTotalRides
        });
      }
    } catch (driverUpdateError) {
      logger.error('Failed to update driver rating after booking rating', {
        driverId: booking.driverId._id,
        bookingId: booking.bookingId,
        error: driverUpdateError.message
      });
    }
  }

  return sendSuccess(
    res,
    {
      rating: booking.rating.value,
      comment: booking.rating.comment,
      ratedAt: booking.rating.createdAt
    },
    'Thank you for your feedback!',
    200
  );
});
export const getUpcomingBookings = catchAsync(async (req, res) => {
  logger.warn("Deprecated route /api/bookings/upcoming accessed.");
  req.query.status = `${BOOKING_STATUS.CONFIRMED},${BOOKING_STATUS.ASSIGNED}`;
  req.query.fromDate = new Date().toISOString();
  req.query.sortBy = 'startDateTime';
  return getAllBookings(req, res);
});
export const getBookingHistory = catchAsync(async (req, res) => {
  logger.warn("Deprecated route /api/bookings/history accessed.");
  req.query.status = `${BOOKING_STATUS.COMPLETED},${BOOKING_STATUS.CANCELLED}`;
  req.query.sortBy = '-startDateTime';
  return getAllBookings(req, res);
});
export const getBookingStats = catchAsync(async (req, res) => {
  logger.warn("Deprecated route /api/bookings/stats accessed.");
  return sendSuccess(res, { note: "Please use /api/users/me/stats for user statistics." }, "Endpoint deprecated", 200);
});
export const applyDiscount = catchAsync(async (req, res) => {
  const { discountCode } = req.body;
  const bookingId = req.params.id;

  if (!discountCode || typeof discountCode !== 'string') {
    throw new BadRequestError('Discount code is required.');
  }
  const cleanDiscountCode = discountCode.trim().toUpperCase();

  const booking = await Booking.findOne({ _id: bookingId, userId: req.user._id });
  if (!booking) throw new NotFoundError('Booking not found');

  if (booking.status !== BOOKING_STATUS.CONFIRMED && booking.status !== BOOKING_STATUS.ASSIGNED) {
    throw new BadRequestError(`Cannot apply discount to booking with status: ${booking.status}`);
  }
  if (new Date(booking.startDateTime) <= new Date()) {
    throw new BadRequestError('Cannot apply discount after the trip has started or passed.');
  }
  if (booking.fareDetails?.discountAmount && booking.fareDetails.discountAmount > 0) {
    throw new ConflictError('A discount has already been applied to this booking.');
  }

  logger.info('Attempting to apply discount', {
    bookingId: booking.bookingId,
    userId: req.user._id,
    discountCode: cleanDiscountCode
  });

  // Discount Validation & Application Logic
  let discountAmount = 0;
  let discountType = null;

  if (cleanDiscountCode === 'FIRST100') {
    const pastBookings = await Booking.countDocuments({ userId: req.user._id, status: BOOKING_STATUS.COMPLETED });
    if (pastBookings === 0) {
      discountAmount = 100;
      discountType = 'FIXED';
    } else {
      throw new BadRequestError('Discount code "FIRST100" is only valid for your first completed booking.');
    }
  } else if (cleanDiscountCode === 'SAVE10') {
    const baseFare = booking.fareDetails?.baseFare || 0;
    discountAmount = Math.min(baseFare * 0.10, 150);
    discountType = 'PERCENTAGE';
  } else {
    throw new BadRequestError(`Invalid or expired discount code: "${discountCode}"`);
  }

  if (discountAmount <= 0) {
    throw new BadRequestError('Discount code is valid but resulted in no discount amount.');
  }
  discountAmount = Math.round(discountAmount);

  // Recalculate GST and final amount
  const baseFareForCalc = booking.fareDetails?.baseFare || 0;
  const nightChargesForCalc = booking.fareDetails?.nightCharges || 0;
  const originalSubtotal = baseFareForCalc + nightChargesForCalc;

  const subtotalAfterDiscount = Math.max(0, originalSubtotal - discountAmount);
  const newGst = calculateGST(subtotalAfterDiscount, TAX_CONFIG.GST_RATE);
  const newFinalAmount = subtotalAfterDiscount + newGst;

  if (!booking.fareDetails) {
    booking.fareDetails = {};
  }
  booking.fareDetails.discountCode = cleanDiscountCode;
  booking.fareDetails.discountAmount = discountAmount;
  booking.fareDetails.discountType = discountType;
  booking.fareDetails.subtotal = Math.round(subtotalAfterDiscount);
  booking.fareDetails.gst = Math.round(newGst);
  booking.fareDetails.finalAmount = Math.round(newFinalAmount);

  await booking.save();

  logger.info('Discount applied successfully', {
    bookingId: booking.bookingId,
    discountCode: cleanDiscountCode,
    discountAmount,
    newFinalAmount: booking.fareDetails.finalAmount
  });

  return sendSuccess(
    res,
    {
      bookingId: booking.bookingId,
      fareDetails: booking.fareDetails,
      message: `Discount code "${cleanDiscountCode}" applied successfully. New total: ₹${booking.fareDetails.finalAmount}`
    },
    'Discount applied successfully',
    200
  );
});
export const getFareEstimate = catchAsync(async (req, res) => {
  const { from, to, type, distance, vehicleType, startDateTime, fromCoordinates, toCoordinates } = req.body;

  let estimatedDistance = distance;
  const isLocalRental = localRentalTypes.includes(type);

  if (isLocalRental) {
    estimatedDistance = 0;
  } else if (!estimatedDistance || typeof estimatedDistance !== 'number' || estimatedDistance < 0) {
    // --- REFACTORED LOGIC ---
    if (!geoService.isAvailable()) {
      throw new ServiceUnavailableError('Geocoding service is not configured');
    }
    
    let origin = fromCoordinates || from;
    let destination = toCoordinates || to;

    if (!origin || !destination) {
      throw new BadRequestError('Please provide distance, valid coordinates, or both from/to addresses.');
    }

    try {
      const matrix = await geoService.getDistanceMatrix(origin, destination);
      estimatedDistance = matrix.distance;
    } catch (distError) {
      logger.warn('Failed to automatically calculate distance for estimate', { from, to, error: distError.message });
      throw new BadRequestError(`Could not automatically determine distance: ${distError.message}.`);
    }
  }

  const isAirportTransfer = (type === BOOKING_TYPES.AIRPORT_DROP || type === BOOKING_TYPES.AIRPORT_PICKUP);

  if (!isLocalRental && (!estimatedDistance || typeof estimatedDistance !== 'number' || estimatedDistance <= 0)) {
    throw new BadRequestError('Invalid or zero distance determined for estimation.');
  }

  if (!type || !vehicleType) {
    throw new BadRequestError('Booking type and vehicle type are required for estimation');
  }
  if (!Object.values(BOOKING_TYPES).includes(type)) {
    throw new BadRequestError(`Invalid booking type: ${type}`);
  }
  if (!Object.values(VEHICLE_TYPES).includes(vehicleType)) {
    throw new BadRequestError(`Invalid vehicle type: ${vehicleType}`);
  }

  const tripDate = startDateTime ? new Date(startDateTime) : new Date();
  if (isNaN(tripDate.getTime())) {
    throw new BadRequestError('Invalid start date/time format. Use ISO 8601.');
  }

  let fareDetails;
  try {
    switch (type) {
      case BOOKING_TYPES.ONE_WAY:
        fareDetails = pricingService.calculateOutstationFare(vehicleType, estimatedDistance, false, tripDate);
        break;
      case BOOKING_TYPES.ROUND_TRIP:
        fareDetails = pricingService.calculateOutstationFare(vehicleType, estimatedDistance, true, tripDate);
        break;
      // Handle new local packages
      case BOOKING_TYPES.LOCAL_2_20:
        fareDetails = pricingService.calculateLocalPackageFare(vehicleType, '2_20');
        break;
      case BOOKING_TYPES.LOCAL_4_40:
        fareDetails = pricingService.calculateLocalPackageFare(vehicleType, '4_40');
        break;
      case BOOKING_TYPES.LOCAL_8_80:
        fareDetails = pricingService.calculateLocalPackageFare(vehicleType, '8_80');
        break;
      case BOOKING_TYPES.LOCAL_12_120:
        fareDetails = pricingService.calculateLocalPackageFare(vehicleType, '12_120');
        break;
      case BOOKING_TYPES.AIRPORT_PICKUP:
      case BOOKING_TYPES.AIRPORT_DROP:
        fareDetails = pricingService.calculateAirportFare(vehicleType, estimatedDistance, tripDate);
        break;
      default:
        // This will now catch the old 8_80 and 12_120 if they are still being sent
        if(type === 'LOCAL_8_80' || type === 'LOCAL_12_120') {
            const pkg = type.split('_')[1] + '_' + type.split('_')[2];
            fareDetails = pricingService.calculateLocalPackageFare(vehicleType, pkg);
            break;
        }
        throw new BadRequestError(`Invalid booking type for estimation: ${type}`);
    }
  } catch (pricingError) {
    logger.error('Error during fare estimation calculation', {
      type, vehicleType, estimatedDistance, error: pricingError.message
    });
    if (pricingError instanceof BadRequestError) {
      throw pricingError;
    }
    throw new ServiceUnavailableError(`Could not calculate fare estimate at this time: ${pricingError.message}`);
  }

  logger.info('Fare estimate calculated', {
    from: from || 'Coords provided',
    to: to || 'Coords provided',
    type,
    vehicleType,
    distance: estimatedDistance,
    estimatedFare: fareDetails.finalAmount
  });

  return sendSuccess(
    res,
    {
      from: from || (fromCoordinates ? `${fromCoordinates.lat},${fromCoordinates.lng}` : 'Unknown'),
      to: to || (toCoordinates ? `${toCoordinates.lat},${toCoordinates.lng}` : 'Unknown'),
      type,
      vehicleType,
      distance: estimatedDistance,
      fareDetails,
      validUntil: addHours(new Date(), 1)
    },
    'Fare estimate calculated successfully',
    200
  );
});
export const getCancellationCharges = catchAsync(async (req, res) => {
  const bookingId = req.params.id;
  const booking = await Booking.findOne({
    _id: bookingId,
    userId: req.user._id
  });

  if (!booking) {
    throw new NotFoundError('Booking not found or you do not have permission to view it.');
  }

  const isCancellable = [
    BOOKING_STATUS.PENDING,
    BOOKING_STATUS.CONFIRMED,
    BOOKING_STATUS.ASSIGNED
  ].includes(booking.status);

  const hoursUntilStart = (new Date(booking.startDateTime) - new Date()) / (1000 * 60 * 60);
  let cancellationCharge = 0;
  let chargeWillApply = false;
  let chargeReason = "No charge currently applies.";

  if (hoursUntilStart < BOOKING_CONFIG.CANCELLATION_WINDOW_HOURS && hoursUntilStart >= 0) {
    const finalAmount = booking.fareDetails?.finalAmount || 0;
    if (finalAmount > 0) {
      cancellationCharge = Math.round(
        (finalAmount * BOOKING_CONFIG.CANCELLATION_CHARGE_PERCENT)
      );
      chargeWillApply = true;
      chargeReason = `Charge applies as cancellation would be within ${BOOKING_CONFIG.CANCELLATION_WINDOW_HOURS} hours of pickup.`;
    } else {
      chargeReason = "Cannot calculate percentage charge on zero fare.";
    }
  } else if (hoursUntilStart < 0) {
    chargeReason = "Trip start time has passed.";
  } else {
    chargeReason = `No charge applies (more than ${BOOKING_CONFIG.CANCELLATION_WINDOW_HOURS} hours until pickup).`;
  }

  if (!isCancellable) {
    chargeReason = `Booking cannot be cancelled (current status: ${booking.status}). Charge calculation is hypothetical.`;
    chargeWillApply = false;
    cancellationCharge = 0;
  }

  logger.info('Cancellation charges calculated', {
    bookingId: booking.bookingId,
    dbId: booking._id,
    userId: req.user._id,
    potentialCharge: cancellationCharge,
    hoursUntilStart: hoursUntilStart.toFixed(2),
    chargeWillApply,
    isCancellable,
    bookingStatus: booking.status
  });

  return sendSuccess(
    res,
    {
      bookingId: booking.bookingId,
      bookingStatus: booking.status,
      isCancellable,
      hoursUntilStart: hoursUntilStart.toFixed(2),
      cancellationWindowHours: BOOKING_CONFIG.CANCELLATION_WINDOW_HOURS,
      chargePercentIfApplied: BOOKING_CONFIG.CANCELLATION_CHARGE_PERCENT,
      potentialCancellationCharge: cancellationCharge,
      chargeWillApply,
      message: chargeWillApply
        ? `A potential cancellation charge of ₹${cancellationCharge} (${BOOKING_CONFIG.CANCELLATION_CHARGE_PERCENT * 100}%) applies if cancelled now.`
        : chargeReason
    },
    'Cancellation charge information retrieved successfully',
    200
  );
});
export const updateBookingStatus = catchAsync(async (req, res) => {
  const { status, reason, location } = req.body;
  const bookingId = req.params.id;

  if (!status || !Object.values(BOOKING_STATUS).includes(status)) {
    throw new BadRequestError(`Invalid status value provided. Valid statuses are: ${Object.values(BOOKING_STATUS).join(', ')}`);
  }

  const booking = await Booking.findById(bookingId)
    .populate('userId', 'deviceInfo name')
    .populate('driverId', 'deviceInfo name');

  if (!booking) {
    throw new NotFoundError(`Booking with ID ${bookingId} not found`);
  }

  // Role checks
  if (req.user.role === 'CUSTOMER' && booking.userId.toString() !== req.user._id.toString()) {
    throw new AuthorizationError('You do not have permission to update this booking status.');
  }
  if (req.user.role === 'CUSTOMER' && status !== BOOKING_STATUS.CANCELLED) {
    throw new AuthorizationError('Customers can only cancel bookings via the specific cancel endpoint.');
  }

  const currentStatus = booking.status;

  if (currentStatus === BOOKING_STATUS.COMPLETED || currentStatus === BOOKING_STATUS.CANCELLED || currentStatus === BOOKING_STATUS.REJECTED) {
    throw new BadRequestError(`Booking is already in a final state (${currentStatus}) and cannot be changed.`);
  }

  // Update Timestamps & Trip Details
  const now = new Date();
  if (status === BOOKING_STATUS.IN_PROGRESS && !booking.trip?.actualStartTime) {
    if (!booking.trip) booking.trip = {};
    booking.trip.actualStartTime = now;
  } else if (status === BOOKING_STATUS.COMPLETED && !booking.trip?.actualEndTime) {
    if (!booking.trip) booking.trip = {};
    booking.trip.actualEndTime = now;

    // Increment Driver's completed rides count
    if (booking.driverId) {
      await User.findByIdAndUpdate(booking.driverId._id, { $inc: { completedRides: 1 } });
      logger.info("Incremented driver's completed rides count", { driverId: booking.driverId._id });
    }
  } else if (status === BOOKING_STATUS.CANCELLED && !booking.cancellation) {
    booking.cancellation = {
      cancelledBy: req.user.role,
      cancelledAt: now,
      reason: reason || `Cancelled by ${req.user.role}`,
      charge: 0
    };
  }

  booking.status = status;
  await booking.save();

  logger.info('Booking status updated successfully', {
    bookingId: booking.bookingId,
    dbId: booking._id,
    oldStatus: currentStatus,
    newStatus: status,
    updatedByRole: req.user.role,
    updatedById: req.user._id
  });

  // Send Notifications
  const user = booking.userId;
  const driver = booking.driverId;

  // Notify User
  if (user?.deviceInfo?.length > 0) {
    const latestUserDevice = user.deviceInfo.sort((a, b) => new Date(b.lastUsed) - new Date(a.lastUsed))[0];
    const userFcmToken = latestUserDevice?.fcmToken;
    if (userFcmToken) {
      let userMessage = `Update for booking ${booking.bookingId}: Status changed to ${status}.`;
      if (status === BOOKING_STATUS.ASSIGNED && driver) userMessage = `Driver ${driver.name} is assigned to your booking ${booking.bookingId}. ETA updates soon!`;
      if (status === BOOKING_STATUS.IN_PROGRESS) userMessage = `Your trip ${booking.bookingId} has started! Track your ride in the app.`;
      if (status === BOOKING_STATUS.COMPLETED) userMessage = `Trip ${booking.bookingId} completed. Hope you had a great ride! Please rate your experience.`;
      if (status === BOOKING_STATUS.CANCELLED) userMessage = `Booking ${booking.bookingId} has been cancelled ${booking.cancellation.cancelledBy !== 'USER' ? `by ${booking.cancellation.cancelledBy}` : ''}. Reason: ${booking.cancellation.reason || 'N/A'}`;
      if (status === BOOKING_STATUS.REJECTED) userMessage = `Unfortunately, your booking request ${booking.bookingId} could not be confirmed at this time. Reason: ${reason || 'Availability issues'}`;

      sendBookingNotification(userFcmToken, booking.bookingId, status.toLowerCase(), userMessage)
        .catch(error => logger.error('Failed to send user status update push notification', { bookingId: booking.bookingId, error: error.message }));
    }
  }

  // Notify Driver
  if (driver?.deviceInfo?.length > 0) {
    const latestDriverDevice = driver.deviceInfo.sort((a, b) => new Date(b.lastUsed) - new Date(a.lastUsed))[0];
    const driverFcmToken = latestDriverDevice?.fcmToken;
    if (driverFcmToken) {
      let driverMessage = null;
      let driverTitle = 'Booking Update';
      if (status === BOOKING_STATUS.ASSIGNED && req.user.role === 'ADMIN') {
        driverTitle = 'New Booking Assigned';
        driverMessage = `You've been assigned booking ${booking.bookingId}. Pickup: ${booking.pickupLocation.address || booking.pickupLocation.city} at ${booking.startDateTime.toLocaleTimeString()}.`;
      } else if (status === BOOKING_STATUS.CANCELLED && req.user.role !== 'DRIVER') {
        driverTitle = 'Booking Cancelled';
        driverMessage = `Booking ${booking.bookingId} has been cancelled by ${booking.cancellation.cancelledBy}.`;
      }

      if (driverMessage) {
        sendDriverNotification(driverFcmToken, driverTitle, driverMessage, { bookingId: booking.bookingId, newStatus: status })
          .catch(error => logger.error('Failed to send driver status update push notification', { bookingId: booking.bookingId, driverId: driver._id, error: error.message }));
      }
    }
  }

  return sendSuccess(
    res,
    { bookingId: booking.bookingId, status: booking.status },
    'Booking status updated successfully',
    200
  );
});

// ========================================
// EXPORTS
// ========================================

export default {
  searchCabs,
  createBooking,
  getBooking,
  getBookingByCode,
  getAllBookings,
  cancelBooking,
  getUpcomingBookings,
  getBookingHistory,
  getBookingStats,
  addRating,
  applyDiscount,
  getFareEstimate,
  getCancellationCharges,
  updateBookingStatus
};