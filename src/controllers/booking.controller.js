// src/controllers/booking.controller.js - Updated with Local Package Logic
import axios from 'axios'; // Import axios
import Booking from '../models/Booking.js';
import User from '../models/User.js';
import pricingService from '../services/pricing.service.js';
import { sendSuccess, sendPaginatedResponse } from '../utils/response.js';
import { catchAsync } from '../utils/catchAsync.js';
import {
  NotFoundError,
  BadRequestError,
  ConflictError,
  ServiceUnavailableError,
  AuthorizationError // Added for status update
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

// --- Configuration for Free APIs ---
const NOMINATIM_USER_AGENT = process.env.NOMINATIM_USER_AGENT || 'CabBazarBackend/1.0 (Node.js App; contact: default-email@example.com)';
const OSRM_API_BASE_URL = 'http://router.project-osrm.org';

const localRentalTypes = [
  BOOKING_TYPES.LOCAL_2_20,   
  BOOKING_TYPES.LOCAL_4_40,   
  BOOKING_TYPES.LOCAL_8_80,
  BOOKING_TYPES.LOCAL_12_120
];


/**
 * @desc    Search for available cabs and get pricing (Updated)
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

  // ========================================
  // VALIDATION
  // ========================================

  if (!from || !to) {
    throw new BadRequestError('Pickup (from) and drop-off (to) locations are required');
  }

  if (!type) {
    throw new BadRequestError('Booking type is required');
  }

  if (!Object.values(BOOKING_TYPES).includes(type)) {
    throw new BadRequestError(`Invalid booking type: ${type}`);
  }

  // --- NAYA LOGIC: Check if it's a local rental ---
  const isLocalRental = localRentalTypes.includes(type);

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
  // DISTANCE CALCULATION (Updated for Local Rentals)
  // ========================================

  let estimatedDistance = distance;
  let originCoords = fromCoordinates;
  let destinationCoords = toCoordinates;
  let distanceSource = 'user_provided';

  if (isLocalRental) {
    // --- NAYA LOGIC: Agar local rental hai, distance calculation skip karo ---
    logger.info('Local rental type detected, skipping distance calculation.', { type });
    estimatedDistance = 0; // Distance 0 set karo
    distanceSource = 'local_package';
    if (!originCoords) originCoords = { note: "Local rental, coords not needed" };
    if (!destinationCoords) destinationCoords = { note: "Local rental, coords not needed" };

  } else if (estimatedDistance && typeof estimatedDistance === 'number' && estimatedDistance > 0) {
    // Puraana logic: Agar distance diya hai toh use karo
    logger.info('Distance provided directly in request', { estimatedDistance });
    distanceSource = 'user_provided_distance';
    if (!originCoords) originCoords = { note: "Coordinates not determined as distance was provided" };
    if (!destinationCoords) destinationCoords = { note: "Coordinates not determined as distance was provided" };

  } else {
    // Puraana logic: Agar distance nahi diya (aur local bhi nahi hai) toh calculate karo
    logger.info('Distance not provided/invalid, attempting geocoding (Nominatim) and routing (OSRM)...');
    distanceSource = 'api_calculated';

    // 1. Get Coordinates if not provided directly
    if (!originCoords || typeof originCoords.lat !== 'number' || typeof originCoords.lng !== 'number') {
      logger.info('Origin coordinates missing or invalid, calling Nominatim for "from" address', { from });
      originCoords = await getCoordinatesFromAddressNominatim(from);
      if (!originCoords) {
        throw new BadRequestError(`Could not find coordinates for pickup location: "${from}". Please check the address, add more details (like city/state), or provide coordinates directly.`);
      }
    } else {
      logger.info('Origin coordinates provided directly.', { originCoords });
      distanceSource = 'user_provided_coordinates';
    }

    if (!destinationCoords || typeof destinationCoords.lat !== 'number' || typeof destinationCoords.lng !== 'number') {
      logger.info('Destination coordinates missing or invalid, calling Nominatim for "to" address', { to });
      destinationCoords = await getCoordinatesFromAddressNominatim(to);
      if (!destinationCoords) {
        throw new BadRequestError(`Could not find coordinates for drop-off location: "${to}". Please check the address, add more details (like city/state), or provide coordinates directly.`);
      }
    } else {
      logger.info('Destination coordinates provided directly.', { destinationCoords });
      if (distanceSource !== 'user_provided_distance') distanceSource = 'user_provided_coordinates';
    }

    // 2. Get Driving Distance from Coordinates using OSRM
    logger.info('Calling OSRM for driving distance', { originCoords, destinationCoords });
    estimatedDistance = await getDrivingDistanceOSRM(originCoords, destinationCoords);

    if (estimatedDistance === null || estimatedDistance < 0) { // Allow 0 for same city
      logger.warn('OSRM failed to return a valid distance, falling back to straight-line calculation.', { originCoords, destinationCoords });
      try {
        estimatedDistance = pricingService.calculateDistanceFromCoordinates(originCoords, destinationCoords);
        distanceSource = 'api_fallback_straight_line';
        if (estimatedDistance === null || estimatedDistance < 0) {
          throw new Error("Straight-line distance also invalid.");
        }
      } catch (straightLineError) {
        logger.error("Both OSRM and straight-line distance calculation failed.", { error: straightLineError.message });
        throw new ServiceUnavailableError('Could not determine the driving distance between the locations. Please try again.');
      }
    } else {
      if (distanceSource !== 'user_provided_coordinates') {
        distanceSource = 'api_osrm';
      } else {
        distanceSource = 'api_osrm_from_user_coords';
      }
      logger.info('Distance calculated via OSRM API', { estimatedDistance });
    }
  }

  // --- NAYA LOGIC: Final check on distance value ---
  // Local rental (0km) aur Airport (0km base price) ke liye 0 distance allowed hai.
  const isAirportTransfer = (type === BOOKING_TYPES.AIRPORT_DROP || type === BOOKING_TYPES.AIRPORT_PICKUP);

  if (!isLocalRental && !isAirportTransfer && (!estimatedDistance || typeof estimatedDistance !== 'number' || estimatedDistance <= 0)) {
    // Sirf ONE_WAY aur ROUND_TRIP ke liye 0 se zyada distance zaroori hai
    logger.error("Final estimated distance is invalid for non-local/non-airport trip.", { estimatedDistance, type });
    throw new BadRequestError('Could not determine a valid distance for this search.');
  }

  // (estimatedDistance 0 ho sakta hai local aur airport ke liye)

  logger.info('Cab search initiated', {
    from,
    to,
    type,
    distance: estimatedDistance,
    distanceSource,
    userId: req.user?._id || 'guest',
    tripDate: tripDate.toISOString()
  });

  // ========================================
  // GET VEHICLE OPTIONS WITH PRICING
  // ========================================

  const vehicleOptions = pricingService.getVehicleOptions(type, {
    distance: estimatedDistance, // 0 pass hoga local/airport ke liye
    startDateTime: tripDate
    // Pass extras if needed for local packages, e.g., extras: req.body.extras
  });

  // ========================================
  // RESPONSE
  // ========================================

  const searchResults = {
    searchId: generateBookingReference(),
    from,
    to,
    date: tripDate,
    type,
    distance: estimatedDistance,
    distanceSource,
    options: vehicleOptions,
    validUntil: addHours(new Date(), 1),
    timestamp: new Date(),
    hasCoordinatesInput: !!(req.body.fromCoordinates && req.body.toCoordinates)
  };

  logger.info('Search results generated', {
    searchId: searchResults.searchId,
    optionsCount: vehicleOptions.length,
    distance: estimatedDistance,
    distanceSource
  });

  return sendSuccess(res, searchResults, 'Search results retrieved successfully', 200);
});


// --- Helper Functions for Nominatim & OSRM (Unchanged) ---
async function getCoordinatesFromAddressNominatim(address) {
  if (!address || typeof address !== 'string' || address.trim().length < 3) {
    logger.warn('Invalid address provided for Nominatim geocoding', { address });
    return null;
  }
  const url = `https://nominatim.openstreetmap.org/search`;
  try {
    await new Promise(resolve => setTimeout(resolve, 300));
    const response = await axios.get(url, {
      params: { q: address, format: 'json', limit: 1, countrycodes: 'in', addressdetails: 0 },
      headers: { 'User-Agent': NOMINATIM_USER_AGENT },
      timeout: 5000
    });
    if (response.data && response.data.length > 0) {
      const result = response.data[0];
      if (result.lat && result.lon && !isNaN(parseFloat(result.lat)) && !isNaN(parseFloat(result.lon))) {
        const location = { lat: parseFloat(result.lat), lng: parseFloat(result.lon) };
        logger.info('Nominatim Geocoding successful', { address, lat: location.lat, lng: location.lng });
        return location;
      } else {
        logger.warn('Nominatim returned result but lat/lon are invalid', { address, result });
        return null;
      }
    } else {
      logger.warn('Nominatim Geocoding failed: No results found', { address });
      return null;
    }
  } catch (error) {
    const isTimeout = error.code === 'ECONNABORTED';
    logger.error(`Error calling Nominatim API ${isTimeout ? '(Timeout)' : ''}`, {
      address,
      url: url + `?q=${encodeURIComponent(address)}&format=json&limit=1&countrycodes=in`,
      error: error.response ? { status: error.response.status, data: error.response.data } : error.message,
      isTimeout
    });
    return null;
  }
}

async function getDrivingDistanceOSRM(origin, destination) {
  if (!origin || !destination || typeof origin.lat !== 'number' || typeof origin.lng !== 'number' || typeof destination.lat !== 'number' || typeof destination.lng !== 'number') {
    logger.warn('Invalid coordinates provided for OSRM routing', { origin, destination });
    return null;
  }
  // NAYA: Agar coordinates same hain, 0 return karo
  if (origin.lat === destination.lat && origin.lng === destination.lng) {
    logger.info('OSRM: Origin and destination are identical, returning 0 km.');
    return 0;
  }
  const coordinates = `${origin.lng},${origin.lat};${destination.lng},${destination.lat}`;
  const url = `${OSRM_API_BASE_URL}/route/v1/driving/${coordinates}`;
  try {
    await new Promise(resolve => setTimeout(resolve, 300));
    const response = await axios.get(url, {
      params: { overview: 'false', alternatives: false, steps: false },
      headers: { 'User-Agent': NOMINATIM_USER_AGENT },
      timeout: 7000
    });
    if (response.data && response.data.code === 'Ok' && response.data.routes && response.data.routes.length > 0) {
      const route = response.data.routes[0];
      if (route.distance !== undefined && typeof route.distance === 'number' && route.distance >= 0) {
        const distanceInMeters = route.distance;
        const distanceInKm = Math.round((distanceInMeters / 1000) * 10) / 10;
        logger.info('OSRM Driving distance obtained', { distanceInKm });
        
        // Agar distance 0 hai (bohot paas ke points), toh 0 return karo
        if (distanceInKm === 0 && (origin.lat !== destination.lat || origin.lng !== destination.lng)) {
          logger.warn('OSRM returned 0 distance for different coordinates, returning 0.', { origin, destination });
        }
        return distanceInKm; // 0 bhi valid hai
      } else {
        logger.warn('OSRM returned OK but route distance value is missing or invalid', { responseData: response.data });
        return null;
      }
    } else {
      logger.warn('OSRM API request failed or route not found', {
        coordinates,
        osrm_code: response.data?.code,
        osrm_message: response.data?.message,
        http_status: response.status
      });
      return null;
    }
  } catch (error) {
    const isTimeout = error.code === 'ECONNABORTED';
    logger.error(`Error calling OSRM API ${isTimeout ? '(Timeout)' : ''}`, {
      coordinates,
      url: url + '?overview=false&alternatives=false&steps=false',
      error: error.response ? { status: error.response.status, data: error.response.data } : error.message,
      isTimeout
    });
    return null;
  }
}


/**
 * @desc    Create a new booking (Updated)
 * @route   POST /api/bookings
 * @access  Private
 */
export const createBooking = catchAsync(async (req, res) => {
  const {
    bookingType,
    pickupLocation,
    dropLocation,
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

  // ========================================
  // VALIDATION
  // ========================================
  if (!bookingType || !pickupLocation || !startDateTime || !vehicleType || !fareDetails) {
    throw new BadRequestError('Missing required booking information');
  }
  if (typeof pickupLocation !== 'object' || !pickupLocation.city) {
    throw new BadRequestError('Invalid pickupLocation object. "city" is required.');
  }

  const isLocalRental = localRentalTypes.includes(bookingType);

  if (!isLocalRental) {
     // Sirf non-local ke liye dropLocation check karo
     // (Aapke puraane code mein yeh check BOOKING_TYPES.LOCAL_8_80 ke basis par tha, jo ab sahi hai)
    if (typeof dropLocation !== 'object' || !dropLocation.city) {
      throw new BadRequestError('Invalid dropLocation object. "city" is required for this booking type.');
    }
  }
  // Agar local hai, toh dropLocation optional hai (jaisa Booking.js model define karta hai)

  if (typeof fareDetails !== 'object' || typeof fareDetails.finalAmount !== 'number') {
    throw new BadRequestError('Invalid fareDetails object. "finalAmount" (number) is required.');
  }

  const tripDate = new Date(startDateTime);
  if (isNaN(tripDate.getTime())) {
    throw new BadRequestError('Invalid start date/time format. Use ISO 8601.');
  }

  const minBookingTime = addHours(new Date(), BOOKING_CONFIG.MIN_BOOKING_HOURS_AHEAD);
  const maxBookingTime = addDays(new Date(), BOOKING_CONFIG.ADVANCE_BOOKING_DAYS);
  if (tripDate < minBookingTime) {
    throw new BadRequestError(`Booking must be at least ${BOOKING_CONFIG.MIN_BOOKING_HOURS_AHEAD} hours in advance.`);
  }
  if (tripDate > maxBookingTime) {
    throw new BadRequestError(`Cannot book more than ${BOOKING_CONFIG.ADVANCE_BOOKING_DAYS} days in advance.`);
  }

  let finalPassengerDetails = {
    name: req.user.name || 'Guest User',
    phone: req.user.phoneNumber,
    email: req.user.email
  };
  if (passengerDetails) {
    if (!passengerDetails.name || typeof passengerDetails.name !== 'string') {
      throw new BadRequestError('Passenger name is required in passengerDetails.');
    }
    if (!passengerDetails.phone || !/^[6-9]\d{9}$/.test(passengerDetails.phone.replace(/\D/g, ''))) {
      throw new BadRequestError('Valid 10-digit passenger phone number is required in passengerDetails.');
    }
    finalPassengerDetails = {
      name: passengerDetails.name.trim(),
      phone: passengerDetails.phone.replace(/\D/g, ''),
      email: passengerDetails.email ? passengerDetails.email.trim().toLowerCase() : null
    };
  } else if (!req.user.name) {
    throw new BadRequestError('Passenger name is required. Please provide passengerDetails or update your profile name.');
  }

  if (fareDetails.finalAmount < 0) {
    throw new BadRequestError('Invalid final amount in fare details. Must be zero or positive.');
  }
  if (typeof fareDetails.baseFare !== 'number' || typeof fareDetails.gst !== 'number') {
    logger.warn('Potentially incomplete fareDetails received', { fareDetails });
  }
  if (!Object.values(VEHICLE_TYPES).includes(vehicleType)) {
    throw new BadRequestError(`Invalid vehicle type: ${vehicleType}`);
  }

  logger.info('Attempting to create new booking', {
    userId: req.user._id,
    bookingType,
    vehicleType,
    startDateTime: tripDate.toISOString(),
    pickupCity: pickupLocation.city,
    dropCity: dropLocation?.city,
    finalAmount: fareDetails.finalAmount
  });

  const timeBuffer = 30 * 60 * 1000;
  const existingBooking = await Booking.findOne({
    userId: req.user._id,
    startDateTime: { $gte: new Date(tripDate.getTime() - timeBuffer), $lte: new Date(tripDate.getTime() + timeBuffer) },
    status: { $nin: [BOOKING_STATUS.CANCELLED, BOOKING_STATUS.COMPLETED, BOOKING_STATUS.REJECTED] }
  });

  if (existingBooking) {
    logger.warn('Duplicate booking detected', {
      userId: req.user._id,
      newBookingTime: tripDate.toISOString(),
      existingBookingId: existingBooking.bookingId,
    });
    throw new ConflictError(`Booking conflict: You already have a booking (${existingBooking.bookingId}) scheduled around this time.`);
  }

  // ========================================
  // CREATE BOOKING
  // ========================================
  let booking;
  try {
    booking = await Booking.create({
      userId: req.user._id,
      bookingType,
      pickupLocation,
      // NAYA LOGIC: Agar local hai aur dropLocation nahi diya, toh pickupLocation use karo
      dropLocation: isLocalRental ? (dropLocation || pickupLocation) : dropLocation,
      viaLocations: viaLocations || [],
      startDateTime: tripDate,
      endDateTime: endDateTime ? new Date(endDateTime) : null, // Model hook local ke liye endDateTime set karega
      vehicleType,
      passengerDetails: finalPassengerDetails,
      fareDetails,
      status: BOOKING_STATUS.CONFIRMED,
      specialRequests: Array.isArray(specialRequests) ? specialRequests : [],
      notes: notes || null,
      metadata: {
        source: req.headers['x-app-source'] || 'API',
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
        searchId: searchId || null
      }
    });
  } catch (error) {
    logger.error('Error saving booking to database', {
      userId: req.user._id,
      error: error.message,
      bookingData: { bookingType, startDateTime: tripDate, vehicleType }
    });
    if (error.name === 'ValidationError') {
      throw new BadRequestError(`Booking validation failed: ${error.message}`);
    }
    throw new ServiceUnavailableError('Failed to create booking. Please try again.');
  }

  await booking.populate('userId', 'deviceInfo name email phoneNumber');
  logger.info('Booking created successfully', {
    bookingId: booking.bookingId,
    dbId: booking._id,
    userId: req.user._id,
    status: booking.status,
    fareAmount: booking.fareDetails.finalAmount
  });

  // ========================================
  // SEND NOTIFICATIONS
  // ========================================
  const user = booking.userId;
  if (user?.deviceInfo?.length > 0) {
    const latestDevice = user.deviceInfo.sort((a, b) => new Date(b.lastUsed) - new Date(a.lastUsed))[0];
    const fcmToken = latestDevice?.fcmToken;
    if (fcmToken) {
      // NAYA LOGIC: Local rental ke liye drop location message me mat dikhao (ya "Local Ride" dikhao)
      const dropOffText = isLocalRental ? 'local ride' : (booking.dropLocation ? `to ${booking.dropLocation.city}` : 'ride');
      sendBookingNotification(
        fcmToken,
        booking.bookingId,
        'confirmed',
        `Your booking ${booking.bookingId} from ${booking.pickupLocation.city} (${dropOffText}) is confirmed for ${tripDate.toLocaleDateString()}.`
      ).catch(error => {
        logger.error('Failed to send booking confirmation push notification', {
          bookingId: booking.bookingId,
          userId: user._id,
          error: error.message
        });
      });
    } else {
      logger.warn('No FCM token found for user to send booking confirmation push', { userId: user._id });
    }
  } else {
    logger.warn('User has no device info for booking confirmation push', { userId: user._id });
  }

  return sendSuccess(
    res,
    {
      booking: booking.toObject({ virtuals: true }),
      message: 'Your booking has been confirmed. You will receive driver details shortly.'
    },
    'Booking created successfully',
    201
  );
});

/**
 * @desc    Get booking by ID (Unchanged)
 * @route   GET /api/bookings/:id
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
    .populate('driverId', 'name phoneNumber rating totalRides profilePicture vehicleId');

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

/**
 * @desc    Get booking by booking code (Unchanged)
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


/**
 * @desc    Get all bookings for current user (Unchanged)
 * @route   GET /api/bookings
 * @access  Private
 */
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

/**
 * @desc    Cancel a booking by the user (Unchanged)
 * @route   PATCH /api/bookings/:id/cancel
 * @access  Private
 */
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
      (booking.fareDetails.finalAmount * BOOKING_CONFIG.CANCELLATION_CHARGE_PERCENT) // Already 20, no need /100
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

  // 1. Notify User
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

  // 2. Notify Driver
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

  // 3. Handle Refunds
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
      // ** Trigger actual refund process here **
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

/**
 * @desc    Add rating to a completed booking (Unchanged)
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
  }).populate('driverId', 'rating completedRides'); // Assuming driverId refers to User model

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
      // Find the driver (User model) again to ensure fresh data for calculation
      const driver = await User.findById(booking.driverId._id);
      if (driver) {
        const currentTotalRides = driver.completedRides || 1; // Use 1 to avoid division by 0 if 0
        const currentRating = driver.rating || 0;
        
        // Calculate new average
        // (current_avg * (total_rides - 1) + new_rating) / total_rides
        // This assumes completedRides was incremented when trip status changed to COMPLETED
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


// --- Deprecated Stubs (Unchanged) ---
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


/**
 * @desc    Apply discount code to booking (Unchanged)
 * @route   POST /api/bookings/:id/apply-discount
 * @access  Private
 */
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

  // --- Discount Validation & Application Logic (Placeholder) ---
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

/**
 * @desc    Get fare estimate for a route (Updated)
 * @route   POST /api/bookings/estimate-fare
 * @access  Public
 */
export const getFareEstimate = catchAsync(async (req, res) => {
  const { from, to, type, distance, vehicleType, startDateTime, fromCoordinates, toCoordinates } = req.body;

  let estimatedDistance = distance;
  // --- NAYA LOGIC: Check if it's a local rental ---
  const isLocalRental = localRentalTypes.includes(type);

  if (isLocalRental) {
    // Local rental ke liye distance 0 set karo
    estimatedDistance = 0;
  } else if (!estimatedDistance || typeof estimatedDistance !== 'number' || estimatedDistance < 0) { // Allow 0 for airport
    // Puraana logic: distance calculate karo
    if (fromCoordinates && toCoordinates && typeof fromCoordinates.lat === 'number' && typeof toCoordinates.lat === 'number') {
      try {
        estimatedDistance = await getDrivingDistanceOSRM(fromCoordinates, toCoordinates) ||
          pricingService.calculateDistanceFromCoordinates(fromCoordinates, toCoordinates);
      } catch (distError) {
        logger.warn('Failed to calculate distance for estimate from coords', { error: distError.message });
        throw new BadRequestError('Could not calculate distance from provided coordinates.');
      }
    } else if (from && to) {
      logger.info('Attempting geocoding + routing for estimate');
      try {
        const origin = await getCoordinatesFromAddressNominatim(from);
        const destination = await getCoordinatesFromAddressNominatim(to);
        if (origin && destination) {
          estimatedDistance = await getDrivingDistanceOSRM(origin, destination) ||
            pricingService.calculateDistanceFromCoordinates(origin, destination);
        } else {
          let errorMsg = 'Could not automatically determine coordinates.';
          if (!origin) errorMsg += ` Failed for pickup "${from}".`;
          if (!destination) errorMsg += ` Failed for drop-off "${to}".`;
          throw new Error(errorMsg);
        }
      } catch (distError) {
        logger.warn('Failed to automatically calculate distance for estimate', { from, to, error: distError.message });
        throw new BadRequestError(`Could not automatically determine distance: ${distError.message}.`);
      }
    } else if (type !== BOOKING_TYPES.AIRPORT_DROP && type !== BOOKING_TYPES.AIRPORT_PICKUP) {
        // Sirf airport ke alawa (non-local) trips ke liye distance zaroori hai
        throw new BadRequestError('Please provide distance, valid coordinates, or both from/to addresses for estimation.');
    }
    // Agar airport hai aur distance nahi hai, toh estimatedDistance 0 rahega
    if(estimatedDistance === null) estimatedDistance = 0;
  }

  // --- NAYA LOGIC: Final check on distance value ---
  const isAirportTransfer = (type === BOOKING_TYPES.AIRPORT_DROP || type === BOOKING_TYPES.AIRPORT_PICKUP);

  if (!isLocalRental && !isAirportTransfer && (!estimatedDistance || typeof estimatedDistance !== 'number' || estimatedDistance <= 0)) {
    // Sirf ONE_WAY aur ROUND_TRIP ke liye 0 se zyada distance zaroori hai
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
      // Naye local packages
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

/**
 * @desc    Get cancellation charges for a specific booking (Unchanged)
 * @route   GET /api/bookings/:id/cancellation-charges
 * @access  Private
 */
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
        (finalAmount * BOOKING_CONFIG.CANCELLATION_CHARGE_PERCENT) // 20%
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

/**
 * @desc    Update booking status (Unchanged)
 * @route   PATCH /api/bookings/:id/status
 * @access  Private (Needs role restriction in ROUTE)
 */
export const updateBookingStatus = catchAsync(async (req, res) => {
  const { status, reason, location } = req.body;
  const bookingId = req.params.id;

  if (!status || !Object.values(BOOKING_STATUS).includes(status)) {
    throw new BadRequestError(`Invalid status value provided. Valid statuses are: ${Object.values(BOOKING_STATUS).join(', ')}`);
  }

  const booking = await Booking.findById(bookingId)
    .populate('userId', 'deviceInfo name')
    .populate('driverId', 'deviceInfo name'); // Assuming driverId refers to User model

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
  // (Yahaan ek poora status transition state machine hona chahiye)
  // Simple check:
  if(currentStatus === BOOKING_STATUS.COMPLETED || currentStatus === BOOKING_STATUS.CANCELLED || currentStatus === BOOKING_STATUS.REJECTED) {
      throw new BadRequestError(`Booking is already in a final state (${currentStatus}) and cannot be changed.`);
  }

  // --- Update Timestamps & Trip Details ---
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
      charge: 0 // Admin/Driver cancellation policy
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

  // --- Send Notifications ---
  const user = booking.userId;
  const driver = booking.driverId;

  // A. Notify User
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

  // B. Notify Driver
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
// FINAL EXPORT BLOCK (Unchanged)
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

