// src/controllers/booking.controller.js - REFACTORED with Payment Flow
import axios from 'axios';
import { Booking, User, Vehicle } from '../models/index.js';
import Driver from '../models/Driver.js'; // Import Driver model
import Payment from '../models/Payment.js'; // Import Payment model
import pricingService from '../services/pricing.service.js';
import geoService from '../services/geo.service.js';
import paymentService from '../services/payment.service.js'; // Import Payment service
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
const localRentalTypes = [
  BOOKING_TYPES.LOCAL_2_20,
  BOOKING_TYPES.LOCAL_4_40,
  BOOKING_TYPES.LOCAL_8_80,
  BOOKING_TYPES.LOCAL_12_120
];

const AIRPORT_DISTANCES_KM = {
  'agra_agra airport (agr)': 7,
  'agra airport (agr)_agra': 7,
  'delhi_indira gandhi international (del)': 12,
  'indira gandhi international (del)_delhi': 12,
  'mumbai_chhatrapati shivaji (bom)': 15,
  'chhatrapati shivaji (bom)_mumbai': 15,
};

// ========================================
// HELPER FUNCTIONS
// ========================================

function getAirportFixedDistance(pickup, drop) {
  if (!pickup || !drop) return null;
  const key = `${pickup.toLowerCase().trim()}_${drop.toLowerCase().trim()}`;
  const revKey = `${drop.toLowerCase().trim()}_${pickup.toLowerCase().trim()}`;
  return AIRPORT_DISTANCES_KM[key] ?? AIRPORT_DISTANCES_KM[revKey] ?? null;
}

function buildLocationObject(locationData) {
  if (!locationData || !locationData.city) {
    throw new BadRequestError('Location must have at least a city');
  }
  return {
    city: locationData.city.trim(),
    address: locationData.address ? locationData.address.trim() : undefined,
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
    distanceSource = 'api_calculated (google)';

    if (!geoService.isAvailable()) {
      throw new ServiceUnavailableError('Geocoding/Distance service is not available. Please try again later.');
    }

    try {
      if (!originCoords || typeof originCoords.lat !== 'number') {
        logger.info('Geocoding origin address', { from });
        originCoords = await geoService.geocode(from);
      } else {
        distanceSource = 'user_provided_coordinates';
      }

      if (!destinationCoords || typeof destinationCoords.lat !== 'number') {
        logger.info('Geocoding destination address', { to });
        destinationCoords = await geoService.geocode(to);
      } else {
        distanceSource = 'user_provided_coordinates';
      }

      if (isAirportTransfer) {
        estimatedDistance = getAirportFixedDistance(from, to);
        if (estimatedDistance) distanceSource = 'airport_fixed_table';
      }

      if (!estimatedDistance && originCoords && destinationCoords) {
        const matrix = await geoService.getDistanceMatrix(originCoords, destinationCoords);
        estimatedDistance = matrix.distance; // in KM
        duration = matrix.duration; // in Minutes
        distanceSource = 'api_google_matrix';
      }

    } catch (error) {
      logger.error('Failed to get Google geo-data', { error: error.message, from, to });
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
 * @desc    Step 1: Create a booking order (Cash or Online)
 * @route   POST /api/bookings/createBooking
 * @access  Private
 */
export const createBooking = catchAsync(async (req, res) => {
  const {
    bookingType,
    pickupLocation,
    dropLocation,
    viaLocations, // <-- ADDED VIA LOCATIONS
    startDateTime,
    endDateTime,
    vehicleType,
    passengerDetails,
    specialRequests,
    notes,
    searchId,
    distance, // Distance from searchCabs
    paymentMethod = 'RAZORPAY', // 'CASH' or 'RAZORPAY'
  } = req.body;

  // ========================================
  // 1. VALIDATION
  // ========================================
  if (!bookingType || !pickupLocation || !startDateTime || !vehicleType) {
    throw new BadRequestError('Missing required booking information');
  }
  if (typeof pickupLocation !== 'object' || !pickupLocation.city) {
    throw new BadRequestError('Invalid pickupLocation: "city" is required.');
  }

  const isLocalRental = localRentalTypes.includes(bookingType);
  if (!isLocalRental && (!dropLocation || !dropLocation.city)) {
    throw new BadRequestError('dropLocation.city is required for this booking type.');
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
  if (passengerDetails && passengerDetails.name && passengerDetails.phone) {
    if (!/^[6-9]\d{9}$/.test(passengerDetails.phone?.replace(/\D/g, ''))) {
      throw new BadRequestError('Valid 10-digit passenger phone required.');
    }
    finalPassengerDetails = {
      name: passengerDetails.name.trim(),
      phone: passengerDetails.phone.replace(/\D/g, ''),
      email: passengerDetails.email?.trim().toLowerCase() || null
    };
  } else if (!req.user.name) {
    throw new BadRequestError('Passenger name is required. Please provide passengerDetails or update your profile name.');
  }

  // ========================================
  // 2. SERVER-SIDE FARE CALCULATION (CRITICAL)
  // ========================================
  let estimatedDistance = distance;
  let fareDetails;

  try {
    // If distance is not provided by client, recalculate it
    if (!isLocalRental && (!estimatedDistance || estimatedDistance <= 0)) {
      if (!geoService.isAvailable()) {
        throw new ServiceUnavailableError('Geo-service not available to verify fare.');
      }
      logger.warn('Distance not provided by client. Recalculating...', { bookingType });
      const origin = pickupLocation.lat ? { lat: pickupLocation.lat, lng: pickupLocation.lng } : (pickupLocation.address || pickupLocation.city);
      const dest = dropLocation.lat ? { lat: dropLocation.lat, lng: dropLocation.lng } : (dropLocation.address || dropLocation.city);
      const matrix = await geoService.getDistanceMatrix(origin, dest);
      estimatedDistance = matrix.distance;
    }

    // Get the *single* fare option
    const options = pricingService.getVehicleOptions(bookingType, {
      distance: estimatedDistance || 0,
      startDateTime: tripDate
    });

    fareDetails = options.find(opt => opt.vehicleType === vehicleType)?.fareDetails;

    if (!fareDetails) {
      throw new BadRequestError(`No pricing found for ${vehicleType} on this route.`);
    }
  } catch (error) {
    logger.error('Server-side fare calculation failed', { error: error.message });
    throw new BadRequestError(`Could not calculate fare: ${error.message}`);
  }

  const { finalAmount } = fareDetails;
  if (finalAmount <= 0) {
    throw new BadRequestError('Calculated fare is zero or negative. Cannot proceed.');
  }
  const amountInPaise = Math.round(finalAmount * 100);

  // Build locations
  const cleanPickupLocation = buildLocationObject(pickupLocation);
  const cleanDropLocation = isLocalRental ? buildLocationObject(dropLocation || pickupLocation) : buildLocationObject(dropLocation);

  // Build via locations
  const cleanViaLocations = (viaLocations || [])
    .filter(loc => loc && loc.city)
    .map(loc => buildLocationObject(loc));

  // ========================================
  // 3. CREATE PENDING BOOKING & PAYMENT DOCS
  // ========================================
  const booking = new Booking({
    userId: req.user._id,
    bookingType,
    pickupLocation: cleanPickupLocation,
    dropLocation: cleanDropLocation,
    viaLocations: cleanViaLocations, // <-- ADDED
    startDateTime: tripDate,
    endDateTime: endDateTime ? new Date(endDateTime) : null,
    vehicleType,
    passengerDetails: finalPassengerDetails,
    fareDetails, // Use the *server-calculated* fare
    status: BOOKING_STATUS.PENDING, // <-- PENDING
    specialRequests: Array.isArray(specialRequests) ? specialRequests : [],
    notes: notes || null,
    metadata: { source: req.headers['x-app-source'] || 'API', ipAddress: req.ip, userAgent: req.get('user-agent'), searchId }
  });
  await booking.save();

  const payment = new Payment({
    userId: req.user._id,
    bookingId: booking._id,
    amount: finalAmount, // Store final amount
    currency: 'INR',
    status: PAYMENT_STATUS.PENDING,
  });
  await payment.save();

  // Link payment to booking
  booking.paymentId = payment._id;
  await booking.save();

  logger.info('Pending booking & payment docs created', {
    bookingId: booking.bookingId,
    paymentId: payment._id,
    finalAmount,
  });

  // ========================================
  // 4. HANDLE PAYMENT METHOD (Online vs. Cash)
  // ========================================
  if (paymentMethod === PAYMENT_METHODS.CASH) {
    payment.method = PAYMENT_METHODS.CASH;
    booking.status = BOOKING_STATUS.CONFIRMED; // Confirm booking immediately

    await payment.save();
    await booking.save();

    logger.info('Booking confirmed with CASH (Pay Later)', { bookingId: booking.bookingId });

    // Send notifications
    const user = await User.findById(req.user._id).select('deviceInfo');
    if (user?.deviceInfo?.length > 0) {
      const fcmToken = user.deviceInfo[0].fcmToken;
      if (fcmToken) {
        sendBookingNotification(
          fcmToken,
          booking.bookingId,
          'confirmed',
          `Your cash booking ${booking.bookingId} is confirmed. Please pay the driver at trip end.`
        ).catch(error => {
          logger.error('Failed to send cash booking confirmation push notification', {
            bookingId: booking.bookingId,
            error: error.message,
          });
        });
      }
    }

    return sendSuccess(
      res,
      {
        booking: booking.toObject({ virtuals: true }),
        payment: payment.toObject(),
        message: 'Booking confirmed! Please pay the driver at the end of your trip.',
      },
      'Booking confirmed (Pay Later)',
      201
    );

  } else {
    // --- ONLINE PAYMENT FLOW (Razorpay) ---
    payment.method = PAYMENT_METHODS.UPI; // Default for online, can be updated by webhook
    const receiptId = `receipt_${booking.bookingId}`;
    const notes = {
      bookingDbId: booking._id.toString(),
      bookingId: booking.bookingId,
      userId: req.user._id.toString(),
    };

    const razorpayOrder = await paymentService.createOrder(amountInPaise, receiptId, notes);

    payment.razorpayOrderId = razorpayOrder.id;
    payment.receiptId = receiptId;
    await payment.save();

    return sendSuccess(
      res,
      {
        razorpayKey: process.env.RAZORPAY_KEY_ID,
        orderId: razorpayOrder.id,
        amount: razorpayOrder.amount,
        currency: 'INR',
        bookingId: booking.bookingId,
        bookingDbId: booking._id,
        fareDetails: booking.fareDetails,
        prefill: {
          name: finalPassengerDetails.name,
          email: finalPassengerDetails.email,
          contact: finalPassengerDetails.phone,
        },
      },
      'Booking order created. Please proceed to payment.',
      200 // 200 OK
    );
  }
});


/**
 * @desc    Step 2: Verify payment and confirm booking
 * @route   POST /api/bookings/verify-payment
 * @access  Private
 */
export const verifyBookingPayment = catchAsync(async (req, res) => {
  const {
    razorpay_payment_id,
    razorpay_order_id,
    razorpay_signature,
    bookingDbId
  } = req.body;

  if (!razorpay_payment_id || !razorpay_order_id || !razorpay_signature || !bookingDbId) {
    throw new BadRequestError('Missing payment verification details');
  }

  // 1. Find the booking and its payment document
  const booking = await Booking.findById(bookingDbId)
    .populate('paymentId')
    .populate('userId', 'deviceInfo name email phoneNumber');

  if (!booking) {
    throw new NotFoundError('Booking not found.');
  }
  if (booking.userId._id.toString() !== req.user._id.toString()) {
    throw new AuthorizationError('You are not authorized for this booking.');
  }
  if (!booking.paymentId) {
    throw new ServiceUnavailableError('Payment record not found for this booking.');
  }

  const payment = booking.paymentId;

  // 2. Idempotency Check
  if (payment.status === PAYMENT_STATUS.COMPLETED || booking.status === BOOKING_STATUS.CONFIRMED) {
    logger.warn('Attempt to verify an already processed booking', { bookingId: booking.bookingId });
    return sendSuccess(res, { booking, message: "Booking already confirmed." }, 'Booking already confirmed', 200);
  }

  // 3. Verify Razorpay Signature
  const isValid = paymentService.verifyPaymentSignature(
    razorpay_order_id,
    razorpay_payment_id,
    razorpay_signature
  );

  if (!isValid) {
    booking.status = BOOKING_STATUS.REJECTED;
    payment.status = PAYMENT_STATUS.FAILED;
    payment.failureReason = 'Signature mismatch';
    payment.razorpayPaymentId = razorpay_payment_id;

    await payment.save();
    await booking.save();

    logger.error('Invalid payment signature', { bookingId: booking.bookingId, orderId: razorpay_order_id });
    throw new BadRequestError('Invalid payment signature. Payment failed.');
  }

  // 4. Signature is VALID - Confirm the Booking
  booking.status = BOOKING_STATUS.CONFIRMED;

  payment.status = PAYMENT_STATUS.COMPLETED;
  payment.razorpayPaymentId = razorpay_payment_id;
  payment.razorpaySignature = razorpay_signature;
  // TODO: Get method from Razorpay API
  payment.method = PAYMENT_METHODS.UPI;

  await payment.save();
  await booking.save();

  logger.info('Payment verified and booking confirmed', {
    bookingId: booking.bookingId,
    paymentId: payment._id,
  });

  // 5. Send Notifications
  const user = booking.userId;
  if (user?.deviceInfo?.length > 0) {
    const latestDevice = user.deviceInfo.sort((a, b) => new Date(b.lastUsed) - new Date(a.lastUsed))[0];
    const fcmToken = latestDevice?.fcmToken;
    if (fcmToken) {
      sendBookingNotification(
        fcmToken,
        booking.bookingId,
        'confirmed',
        `Your payment was successful! Booking ${booking.bookingId} is confirmed.`
      ).catch(error => {
        logger.error('Failed to send booking confirmation push notification', {
          bookingId: booking.bookingId,
          error: error.message,
        });
      });
    }
  }

  // 6. Return Success
  return sendSuccess(
    res,
    {
      booking: booking.toObject({ virtuals: true }),
      payment: payment.toObject(),
      message: 'Payment successful! Your booking has been confirmed.',
    },
    'Booking confirmed successfully',
    201
  );
});

/**
 * @desc    Get booking by database ID
 * @route   GET /api/bookings/getBooking/:id
 * @access  Private
 */
export const getBooking = catchAsync(async (req, res) => {
  const bookingDbId = req.params.id;

  const booking = await Booking.findOne({
    _id: bookingDbId,
    userId: req.user._id
  })
    .populate('userId', 'phoneNumber name email profilePicture')
    .populate('vehicleId', 'type modelName licensePlate color capacity features year fuelType')
    .populate({
      path: 'driverId',
      select: 'name phoneNumber rating completedRides profilePicture vehicleId',
      model: 'Driver'
    })
    .populate('paymentId');

  if (!booking) {
    logger.warn('Booking not found by DB ID or user mismatch', {
      bookingDbId,
      userId: req.user._id
    });
    throw new NotFoundError('Booking not found');
  }

  logger.info('Booking retrieved by DB ID', {
    bookingId: booking.bookingId,
    userId: req.user._id
  });

  return sendSuccess(res, booking.toObject({ virtuals: true }), 'Booking retrieved successfully', 200);
});

/**
 * @desc    Get booking by booking code
 * @route   GET /api/bookings/code/:bookingId
 * @access  Private
 */
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
    .populate({
      path: 'driverId',
      select: 'name phoneNumber rating completedRides profilePicture vehicleId',
      model: 'Driver'
    })
    .populate('paymentId');

  if (!booking) {
    logger.warn('Booking not found by code or user mismatch', {
      bookingCode,
      userId: req.user._id
    });
    throw new NotFoundError(`Booking with code ${bookingCode} not found`);
  }

  logger.info('Booking retrieved by code', {
    bookingId: booking.bookingId,
    userId: req.user._id
  });

  return sendSuccess(res, booking.toObject({ virtuals: true }), 'Booking retrieved successfully', 200);
});

/**
 * @desc    Get all bookings for current user
 * @route   GET /api/bookings
 * @access  Private
 */
export const getAllBookings = catchAsync(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const { status, bookingType, fromDate, toDate, sortBy = '-createdAt' } = req.query;
  const query = { userId: req.user._id };

  if (status) {
    const statuses = status.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
    query.status = { $in: statuses };
  }
  if (bookingType) {
    query.bookingType = bookingType.toUpperCase();
  }
  if (fromDate) {
    query.startDateTime = { $gte: new Date(fromDate) };
  }
  if (toDate) {
    query.startDateTime = { ...query.startDateTime, $lte: new Date(toDate) };
  }

  const total = await Booking.countDocuments(query);
  const bookings = await Booking.find(query)
    .sort(sortBy)
    .skip(skip)
    .limit(limit)
    .populate('vehicleId', 'type modelName licensePlate')
    .populate({ path: 'driverId', select: 'name phoneNumber rating', model: 'Driver' })
    .populate('paymentId', 'status method amount')
    .select('-metadata -trip -cancellation -__v -updatedAt');

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
 * @desc    Cancel a booking by the user
 * @route   PATCH /api/bookings/:id/cancel
 * @access  Private
 */
export const cancelBooking = catchAsync(async (req, res) => {
  const { reason } = req.body;
  const bookingId = req.params.id; // This is the MongoDB _id

  const booking = await Booking.findOne({
    _id: bookingId,
    userId: req.user._id
  })
    .populate('paymentId')
    .populate('driverId', 'deviceInfo name')
    .populate('userId', 'deviceInfo name email phoneNumber');

  if (!booking) {
    throw new NotFoundError('Booking not found or you do not have permission to cancel it.');
  }

  const payment = booking.paymentId; // Get the populated payment doc

  const cancellableStatuses = [
    BOOKING_STATUS.PENDING,
    BOOKING_STATUS.CONFIRMED,
    BOOKING_STATUS.ASSIGNED
  ];

  if (!cancellableStatuses.includes(booking.status)) {
    throw new BadRequestError(`Cannot cancel booking. Current status is: ${booking.status}.`);
  }

  const hoursUntilStart = (new Date(booking.startDateTime) - new Date()) / (1000 * 60 * 60);
  let cancellationCharge = 0;
  let chargeApplied = false;

  if (booking.status !== BOOKING_STATUS.PENDING && hoursUntilStart < BOOKING_CONFIG.CANCELLATION_WINDOW_HOURS && hoursUntilStart >= 0) {
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

  // --- NEW REFUND LOGIC ---
  let refundAmount = 0;
  let refundNote = 'No refund applicable.';

  if (payment && payment.status === PAYMENT_STATUS.COMPLETED) {
    refundAmount = Math.max(0, payment.amount - cancellationCharge);

    if (refundAmount > 0) {
      try {
        const refund = await paymentService.createRefund(
          payment.razorpayPaymentId,
          Math.round(refundAmount * 100) // Send in paise
        );

        payment.status = refundAmount === payment.amount ? PAYMENT_STATUS.REFUNDED : PAYMENT_STATUS.PARTIALLY_REFUNDED;
        refundNote = `Refund of ₹${refundAmount} initiated (Refund ID: ${refund.id}).`;
        logger.info('Refund processed successfully', { bookingId: booking.bookingId, refundId: refund.id });
      } catch (refundError) {
        logger.error('Automatic refund failed', { bookingId: booking.bookingId, error: refundError.message });
        refundNote = `Booking cancelled, but automatic refund failed: ${refundError.message}. Contact support.`;
      }
    } else {
      refundNote = `Cancellation charge (₹${cancellationCharge}) applies. No refund due.`;
    }
    await payment.save();
  } else if (payment && payment.status === PAYMENT_STATUS.PENDING) {
    refundNote = 'Booking cancelled before payment was completed.';
    payment.status = PAYMENT_STATUS.FAILED;
    payment.failureReason = 'Booking cancelled by user before payment';
    await payment.save();
  } else if (payment && payment.method === PAYMENT_METHODS.CASH) {
    refundNote = chargeApplied ? `Cancellation charge of ₹${cancellationCharge} may be applicable.` : 'Cancelled (Cash booking).';
  } else if (!payment && booking.status === BOOKING_STATUS.PENDING) {
    // This handles cancelling a PENDING booking that somehow failed to create a payment doc
    refundNote = 'Booking cancelled while pending payment.';
  }
  // --- END REFUND LOGIC ---

  await booking.save();

  logger.info('Booking cancelled by user', {
    bookingId: booking.bookingId,
    originalStatus,
    cancellationCharge,
    refundAmount,
  });

  // --- Notification logic (unchanged from your file) ---
  const user = booking.userId;
  if (user?.deviceInfo?.length > 0) {
    const fcmToken = user.deviceInfo[0].fcmToken;
    if (fcmToken) {
      sendBookingNotification(
        fcmToken,
        booking.bookingId,
        'cancelled',
        `Your booking ${booking.bookingId} has been cancelled. ${refundNote}`
      ).catch(err => logger.error('Failed to send user cancellation notification', { err: err.message }));
    }
  }
  const driver = booking.driverId;
  if (driver) {
    const driverFcmToken = driver.deviceInfo?.[0]?.fcmToken;
    if (driverFcmToken) {
      sendDriverNotification(
        driverFcmToken,
        'Booking Cancelled',
        `Booking ${booking.bookingId} has been cancelled by the customer.`
      ).catch(err => logger.error('Failed to send driver cancellation notification', { err: err.message }));
    }
  }
  // --- End Notification Logic ---

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

/**
 * @desc    Add rating to completed booking
 * @route   POST /api/bookings/:id/rating
 * @access  Private
 */
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
  }).populate('driverId', 'rating completedRides'); // Populates from 'Driver' model

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
    rating: intRating,
  });

  // Update Driver's Overall Rating
  if (booking.driverId) {
    try {
      const driver = await Driver.findById(booking.driverId._id);
      if (driver) {
        const currentTotalRides = driver.completedRides || 1;
        const currentRating = driver.rating || 0;

        const totalRidesForAvg = Math.max(1, currentTotalRides);
        const newAverageRating = ((currentRating * (totalRidesForAvg - 1)) + intRating) / totalRidesForAvg;

        driver.rating = Math.round(newAverageRating * 10) / 10;
        await driver.save();

        logger.info("Driver's average rating updated", {
          driverId: driver._id,
          newAvgRating: driver.rating,
        });
      }
    } catch (driverUpdateError) {
      logger.error('Failed to update driver rating', {
        driverId: booking.driverId._id,
        error: driverUpdateError.message
      });
    }
  }

  return sendSuccess(
    res,
    {
      rating: booking.rating.value,
      comment: booking.rating.comment,
    },
    'Thank you for your feedback!',
    200
  );
});

// --- Other functions from your file (unchanged) ---

export const getUpcomingBookings = catchAsync(async (req, res) => {
  logger.warn("Deprecated route /api/bookings/upcoming accessed. Use /api/user/me/bookings/upcoming");
  req.query.status = `${BOOKING_STATUS.CONFIRMED},${BOOKING_STATUS.ASSIGNED}`;
  req.query.fromDate = new Date().toISOString();
  req.query.sortBy = 'startDateTime';
  return getAllBookings(req, res);
});

export const getBookingHistory = catchAsync(async (req, res) => {
  logger.warn("Deprecated route /api/bookings/history accessed. Use /api/user/me/bookings/past");
  req.query.status = `${BOOKING_STATUS.COMPLETED},${BOOKING_STATUS.CANCELLED}`;
  req.query.sortBy = '-startDateTime';
  return getAllBookings(req, res);
});

export const getBookingStats = catchAsync(async (req, res) => {
  logger.warn("Deprecated route /api/bookings/stats accessed. Use /api/user/me/stats");
  return sendSuccess(res, { note: "Please use /api/user/me/stats for user statistics." }, "Endpoint deprecated", 200);
});

export const applyDiscount = catchAsync(async (req, res) => {
  const { discountCode } = req.body;
  const bookingId = req.params.id;
  const booking = await Booking.findOne({ _id: bookingId, userId: req.user._id });

  if (!booking) throw new NotFoundError('Booking not found');
  if (booking.status === BOOKING_STATUS.PENDING) {
    throw new BadRequestError('Please confirm your booking before applying a discount.');
  }
  if (booking.fareDetails?.discountAmount > 0) {
    throw new ConflictError('A discount is already applied.');
  }
  // ... (rest of your validation logic) ...

  // Dummy discount logic
  let discountAmount = 0;
  if (discountCode === 'FIRST100') {
    discountAmount = 100;
  } else {
    throw new BadRequestError('Invalid discount code.');
  }

  booking.fareDetails.discountAmount = discountAmount;
  booking.fareDetails.finalAmount = Math.max(0, booking.fareDetails.finalAmount - discountAmount);
  // Recalculate GST/subtotal if needed

  await booking.save();

  // Update payment doc if it exists
  if (booking.paymentId) {
    await Payment.findByIdAndUpdate(booking.paymentId, {
      amount: booking.fareDetails.finalAmount
    });
  }

  logger.info('Discount applied', { bookingId: booking.bookingId, discountCode });
  return sendSuccess(res, { fareDetails: booking.fareDetails }, 'Discount applied', 200);
});

export const getFareEstimate = catchAsync(async (req, res) => {
  // This function is correct and uses geoService
  const { from, to, type, distance, vehicleType, startDateTime, fromCoordinates, toCoordinates } = req.body;

  let estimatedDistance = distance;
  const isLocalRental = localRentalTypes.includes(type);

  if (isLocalRental) {
    estimatedDistance = 0;
  } else if (!estimatedDistance || typeof estimatedDistance !== 'number' || estimatedDistance < 0) {
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

  if (!isLocalRental && (!estimatedDistance || typeof estimatedDistance !== 'number' || estimatedDistance <= 0)) {
    throw new BadRequestError('Invalid or zero distance determined for estimation.');
  }

  // ... (rest of validation) ...

  let fareDetails;
  try {
    fareDetails = pricingService.getVehicleOptions(type, {
      distance: estimatedDistance,
      startDateTime: startDateTime || new Date()
    }).find(opt => opt.vehicleType === vehicleType)?.fareDetails;

    if (!fareDetails) {
      throw new BadRequestError(`No pricing found for ${vehicleType} on this route.`);
    }
  } catch (pricingError) {
    logger.error('Error during fare estimation calculation', { error: pricingError.message });
    throw new ServiceUnavailableError(`Could not calculate fare: ${pricingError.message}`);
  }

  return sendSuccess(res, { fareDetails }, 'Fare estimate calculated', 200);
});

export const getCancellationCharges = catchAsync(async (req, res) => {
  const bookingId = req.params.id;
  const booking = await Booking.findOne({
    _id: bookingId,
    userId: req.user._id
  });

  if (!booking) {
    throw new NotFoundError('Booking not found');
  }
  // ... (rest of your logic) ...

  const hoursUntilStart = (new Date(booking.startDateTime) - new Date()) / (1000 * 60 * 60);
  let cancellationCharge = 0;
  let chargeWillApply = false;
  if (hoursUntilStart < BOOKING_CONFIG.CANCELLATION_WINDOW_HOURS && hoursUntilStart >= 0) {
    cancellationCharge = Math.round(booking.fareDetails.finalAmount * BOOKING_CONFIG.CANCELLATION_CHARGE_PERCENT);
    chargeWillApply = true;
  }

  return sendSuccess(res, { cancellationCharge, chargeWillApply }, 'Cancellation charges retrieved', 200);
});

export const updateBookingStatus = catchAsync(async (req, res) => {
  const { status, reason } = req.body;
  const bookingId = req.params.id;

  const booking = await Booking.findById(bookingId)
    .populate('userId', 'deviceInfo name')
    .populate({ path: 'driverId', model: 'Driver', select: 'deviceInfo name' });

  if (!booking) {
    throw new NotFoundError(`Booking with ID ${bookingId} not found`);
  }

  // Role checks
  if (req.user.role === 'CUSTOMER') {
    throw new AuthorizationError('Customers cannot update status. Use the /cancel endpoint.');
  }
  // ... (rest of role logic) ...

  const currentStatus = booking.status;
  if (currentStatus === BOOKING_STATUS.COMPLETED || currentStatus === BOOKING_STATUS.CANCELLED) {
    throw new BadRequestError(`Booking is already in a final state (${currentStatus})`);
  }

  const now = new Date();
  if (status === BOOKING_STATUS.IN_PROGRESS && !booking.trip?.actualStartTime) {
    if (!booking.trip) booking.trip = {};
    booking.trip.actualStartTime = now;
  } else if (status === BOOKING_STATUS.COMPLETED && !booking.trip?.actualEndTime) {
    if (!booking.trip) booking.trip = {};
    booking.trip.actualEndTime = now;
    if (booking.driverId) {
      await Driver.findByIdAndUpdate(booking.driverId._id, { $inc: { completedRides: 1 } });
      logger.info("Incremented driver's completed rides count", { driverId: booking.driverId._id });
    }
  } else if (status === BOOKING_STATUS.CANCELLED && !booking.cancellation) {
    booking.cancellation = {
      cancelledBy: req.user.role,
      cancelledAt: now,
      reason: reason || `Cancelled by ${req.user.role}`,
      charge: 0 // Admin/Driver cancellations typically don't charge user
    };
  }

  booking.status = status;
  await booking.save();

  // ... (notification logic) ...

  return sendSuccess(res, { bookingId: booking.bookingId, status: booking.status }, 'Status updated', 200);
});


// ========================================
// EXPORTS
// ========================================

export default {
  searchCabs,
  createBooking, // <-- CORRECTED NAME
  verifyBookingPayment, // <-- NEW
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

