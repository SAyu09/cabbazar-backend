// src/controllers/booking.controller.js - Using Nominatim & OSRM for distance
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
  ServiceUnavailableError // Added for API errors
} from '../utils/customError.js';
import {
  BOOKING_STATUS,
  BOOKING_TYPES,
  BOOKING_CONFIG,
  PAYMENT_STATUS, // Added for cancelBooking
  PAYMENT_METHODS, 
  VEHICLE_TYPES,
  TAX_CONFIG // Added for applyDiscount
} from '../config/constants.js';
import {
  parsePagination,
  addDays,
  addHours,
  generateBookingReference,
  calculateGST // Added for applyDiscount
} from '../utils/helpers.js';
import logger from '../config/logger.js';
import {
  sendBookingNotification,
  sendDriverNotification // Added for cancelBooking/updateStatus
  // sendTripNotification // Still unused in this version
} from '../utils/notification.utils.js';

// --- Configuration for Free APIs ---
// IMPORTANT: Set a descriptive User-Agent for Nominatim as per their policy
const NOMINATIM_USER_AGENT = process.env.NOMINATIM_USER_AGENT || 'CabBazarBackend/1.0 (Node.js App; contact: default-email@example.com)'; // Set a default
const OSRM_API_BASE_URL = 'http://router.project-osrm.org'; // Public demo server

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
    // distance and coordinates are now optional inputs, but calculation is mandatory
    distance,
    startDateTime,
    fromCoordinates,
    toCoordinates
  } = req.body;

  // ========================================
  // VALIDATION (Keep existing validation for required fields)
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
  // DISTANCE CALCULATION (Using Nominatim & OSRM)
  // ========================================

  let estimatedDistance = distance; // Use if provided
  let originCoords = fromCoordinates; // Use if provided
  let destinationCoords = toCoordinates; // Use if provided
  let distanceSource = 'user_provided'; // Track how distance was obtained

  if (estimatedDistance && typeof estimatedDistance === 'number' && estimatedDistance > 0) {
    logger.info('Distance provided directly in request', { estimatedDistance });
    distanceSource = 'user_provided_distance';
    // If distance is provided, we might skip getting coordinates unless needed elsewhere
    if (!originCoords) originCoords = { note: "Coordinates not determined as distance was provided"};
    if (!destinationCoords) destinationCoords = { note: "Coordinates not determined as distance was provided"};

  } else {
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
        distanceSource = 'user_provided_coordinates'; // Mark if coords were direct input
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

    if (!estimatedDistance || estimatedDistance <= 0) {
      // OSRM might fail if points are too close, unreachable, or API error
      logger.warn('OSRM failed to return a valid distance, falling back to straight-line calculation.', { originCoords, destinationCoords });
       // Fallback to straight-line distance from pricing service if OSRM fails
      try {
          // Use the function from pricingService (it has the 1.4 multiplier)
          estimatedDistance = pricingService.calculateDistanceFromCoordinates(originCoords, destinationCoords);
          distanceSource = 'api_fallback_straight_line';
          logger.info('Using straight-line distance fallback', { estimatedDistance });
          if (!estimatedDistance || estimatedDistance <= 0) {
               throw new Error("Straight-line distance also invalid."); // Will be caught below
          }
      } catch(straightLineError) {
           logger.error("Both OSRM and straight-line distance calculation failed.", { error: straightLineError.message});
          throw new ServiceUnavailableError('Could not determine the driving distance between the locations. Please try again.');
      }
    } else {
        // If distance came from user coordinates, mark appropriately
        if (distanceSource !== 'user_provided_coordinates') {
           distanceSource = 'api_osrm';
        } else {
             distanceSource = 'api_osrm_from_user_coords'; // Calculated from user coords
        }
        logger.info('Distance calculated via OSRM API', { estimatedDistance });
    }
  }

  // Final check on distance value
  if (!estimatedDistance || typeof estimatedDistance !== 'number' || estimatedDistance <= 0) {
     logger.error("Final estimated distance is invalid after all checks.", { estimatedDistance });
     throw new BadRequestError('Could not determine a valid distance for the search.');
  }

  logger.info('Cab search initiated', {
    from,
    to,
    type,
    distance: estimatedDistance,
    distanceSource, // Log how distance was obtained
    userId: req.user?._id || 'guest',
    tripDate: tripDate.toISOString()
  });

  // ========================================
  // GET VEHICLE OPTIONS WITH PRICING
  // ========================================

  const vehicleOptions = pricingService.getVehicleOptions(type, {
    distance: estimatedDistance,
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
    // Include determined coordinates in response if helpful for frontend debugging/display
    // originCoordinatesUsed: originCoords,
    // destinationCoordinatesUsed: destinationCoords,
    options: vehicleOptions,
    validUntil: addHours(new Date(), 1), // Valid for 1 hour
    timestamp: new Date(),
    // Keep original flag for clarity, even if we always calculate coords now when distance is missing
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


// --- Helper Functions for Nominatim & OSRM ---

/**
 * Gets coordinates from an address using Nominatim API.
 * Respects usage policy by setting User-Agent and limiting concurrency indirectly.
 * @param {string} address - The address string.
 * @returns {Promise<{lat: number, lng: number}|null>} Coordinates or null if not found/error.
 */
async function getCoordinatesFromAddressNominatim(address) {
  if (!address || typeof address !== 'string' || address.trim().length < 3) {
      logger.warn('Invalid address provided for Nominatim geocoding', { address });
      return null;
  }
  const url = `https://nominatim.openstreetmap.org/search`;
  try {
     // Wait briefly to help respect rate limits if called rapidly (simple delay)
     // A better solution for high volume would be a proper rate limiter queue.
    await new Promise(resolve => setTimeout(resolve, 300)); // Slightly increased delay

    const response = await axios.get(url, {
      params: {
        q: address,
        format: 'json',
        limit: 1, // We only need the top result
        countrycodes: 'in', // Prioritize results in India
        addressdetails: 0 // Don't need full address breakdown
      },
      headers: {
        'User-Agent': NOMINATIM_USER_AGENT // **MANDATORY for Nominatim**
      },
      timeout: 5000 // 5 second timeout
    });

    if (response.data && response.data.length > 0) {
      const result = response.data[0];
       // Basic check for valid lat/lon strings
       if (result.lat && result.lon && !isNaN(parseFloat(result.lat)) && !isNaN(parseFloat(result.lon))) {
           const location = {
                lat: parseFloat(result.lat),
                lng: parseFloat(result.lon) // Note: Nominatim uses 'lon'
            };
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
        url: url + `?q=${encodeURIComponent(address)}&format=json&limit=1&countrycodes=in`, // Log the called URL
        error: error.response ? { status: error.response.status, data: error.response.data } : error.message,
        isTimeout
    });
    // Don't throw here, let the main function handle the null return
    return null;
  }
}

/**
 * Gets driving distance between two coordinates using OSRM API (Demo Server).
 * @param {{lat: number, lng: number}} origin - Origin coordinates.
 * @param {{lat: number, lng: number}} destination - Destination coordinates.
 * @returns {Promise<number|null>} Distance in KM or null if error/not found.
 */
async function getDrivingDistanceOSRM(origin, destination) {
   if (!origin || !destination || typeof origin.lat !== 'number' || typeof origin.lng !== 'number' || typeof destination.lat !== 'number' || typeof destination.lng !== 'number') {
        logger.warn('Invalid coordinates provided for OSRM routing', { origin, destination });
        return null;
   }
  // OSRM expects longitude,latitude format
  const coordinates = `${origin.lng},${origin.lat};${destination.lng},${destination.lat}`;
  const url = `${OSRM_API_BASE_URL}/route/v1/driving/${coordinates}`;

  try {
    // Wait briefly to help respect rate limits
    await new Promise(resolve => setTimeout(resolve, 300)); // Slightly increased delay

    const response = await axios.get(url, {
      params: {
        overview: 'false', // We only need the summary, not the full route geometry
        alternatives: false, // Only the fastest route
        steps: false // No need for turn-by-turn steps
      },
       headers: {
        'User-Agent': NOMINATIM_USER_AGENT // Use same User-Agent
      },
      timeout: 7000 // 7 second timeout (routing can take longer)
    });

    // Check OSRM response structure carefully
    if (response.data && response.data.code === 'Ok' && response.data.routes && response.data.routes.length > 0) {
      const route = response.data.routes[0];
      // Check if distance exists and is a non-negative number
      if (route.distance !== undefined && typeof route.distance === 'number' && route.distance >= 0) {
          const distanceInMeters = route.distance;
          const distanceInKm = Math.round((distanceInMeters / 1000) * 10) / 10; // Convert meters to km, round to 1 decimal
          logger.info('OSRM Driving distance obtained', { distanceInKm });
          // Add a basic sanity check - avoid returning 0 km unless coords are identical
          if (distanceInKm === 0 && (origin.lat !== destination.lat || origin.lng !== destination.lng)) {
              logger.warn('OSRM returned 0 distance for different coordinates, might be an issue.', { origin, destination});
              return null; // Treat 0km for non-identical coords as potentially invalid
          }
          return distanceInKm;
      } else {
           logger.warn('OSRM returned OK but route distance value is missing or invalid', { responseData: response.data });
           return null;
      }
    } else {
      // Log specific OSRM error codes if available
      logger.warn('OSRM API request failed or route not found', {
        coordinates,
        osrm_code: response.data?.code, // OSRM's specific code (e.g., NoRoute)
        osrm_message: response.data?.message, // OSRM's message
        http_status: response.status
      });
      return null;
    }
  } catch (error) {
     const isTimeout = error.code === 'ECONNABORTED';
    logger.error(`Error calling OSRM API ${isTimeout ? '(Timeout)' : ''}`, {
        coordinates,
        url: url + '?overview=false&alternatives=false&steps=false', // Log the called URL
        error: error.response ? { status: error.response.status, data: error.response.data } : error.message,
         isTimeout
    });
    return null;
  }
}


// --- Keep all other controller functions (createBooking, getBooking, etc.) the same ---
// --- Ensure they are exported correctly at the end ---

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

  // Validate required fields
  if (!bookingType || !pickupLocation || !startDateTime || !vehicleType || !fareDetails) {
    throw new BadRequestError('Missing required booking information');
  }
   // Add validation for location objects
  if (typeof pickupLocation !== 'object' || !pickupLocation.city) {
      throw new BadRequestError('Invalid pickupLocation object. "city" is required.');
  }
   // dropLocation validation moved to schema in Booking.js, but good to keep controller check
   if (bookingType !== BOOKING_TYPES.LOCAL_8_80 && bookingType !== BOOKING_TYPES.LOCAL_12_120) {
       if (typeof dropLocation !== 'object' || !dropLocation.city) {
          throw new BadRequestError('Invalid dropLocation object. "city" is required for this booking type.');
       }
   }
   if (typeof fareDetails !== 'object' || typeof fareDetails.finalAmount !== 'number') {
       throw new BadRequestError('Invalid fareDetails object. "finalAmount" (number) is required.');
   }


  // Validate booking date
  const tripDate = new Date(startDateTime);

  if (isNaN(tripDate.getTime())) {
    throw new BadRequestError('Invalid start date/time format. Use ISO 8601.');
  }

  const minBookingTime = addHours(new Date(), BOOKING_CONFIG.MIN_BOOKING_HOURS_AHEAD);
  const maxBookingTime = addDays(new Date(), BOOKING_CONFIG.ADVANCE_BOOKING_DAYS);

  if (tripDate < minBookingTime) {
    throw new BadRequestError(
      `Booking must be at least ${BOOKING_CONFIG.MIN_BOOKING_HOURS_AHEAD} hours in advance. Earliest allowed: ${minBookingTime.toLocaleString()}`
    );
  }

  if (tripDate > maxBookingTime) {
    throw new BadRequestError(
      `Cannot book more than ${BOOKING_CONFIG.ADVANCE_BOOKING_DAYS} days in advance. Latest allowed: ${maxBookingTime.toLocaleDateString()}`
    );
  }

  // Validate passenger details if provided fully, otherwise use defaults carefully
   let finalPassengerDetails = {
      name: req.user.name || 'Guest User', // Fallback name
      phone: req.user.phoneNumber, // Should always exist for logged-in user
      email: req.user.email // Might be null
   };
   if (passengerDetails) {
        if (!passengerDetails.name || typeof passengerDetails.name !== 'string') {
             throw new BadRequestError('Passenger name is required in passengerDetails.');
        }
         if (!passengerDetails.phone || !/^[6-9]\d{9}$/.test(passengerDetails.phone.replace(/\D/g,''))) {
             throw new BadRequestError('Valid 10-digit passenger phone number is required in passengerDetails.');
        }
         finalPassengerDetails = {
             name: passengerDetails.name.trim(),
             phone: passengerDetails.phone.replace(/\D/g,''), // Clean phone number
             email: passengerDetails.email ? passengerDetails.email.trim().toLowerCase() : null
         };
   } else if (!req.user.name) {
        // If default user name is missing and passengerDetails not provided
       throw new BadRequestError('Passenger name is required. Please provide passengerDetails or update your profile name.');
   }


  // Validate fare amount
  if (fareDetails.finalAmount < 0) { // Check if < 0, allow 0? Maybe not.
    throw new BadRequestError('Invalid final amount in fare details. Must be zero or positive.');
  }
   // Basic check on other required fare fields (adjust based on your exact needs)
    if (typeof fareDetails.baseFare !== 'number' || typeof fareDetails.gst !== 'number' ) {
         logger.warn('Potentially incomplete fareDetails received during booking creation', { fareDetails });
        // Decide if this should be a hard error or just a warning
        // throw new BadRequestError('Incomplete fare details: baseFare and gst (numbers) are required.');
    }

  // Validate vehicle type against constants
  if (!Object.values(VEHICLE_TYPES).includes(vehicleType)) {
      throw new BadRequestError(`Invalid vehicle type: ${vehicleType}`);
  }


  logger.info('Attempting to create new booking', {
    userId: req.user._id,
    bookingType,
    vehicleType,
    startDateTime: tripDate.toISOString(),
    pickupCity: pickupLocation.city,
    dropCity: dropLocation?.city, // Use optional chaining for local bookings
    viaCities: viaLocations ? viaLocations.map(v => v.city) : [], // Log via cities
    finalAmount: fareDetails.finalAmount
  });


  // Check for duplicate bookings (same user, similar time, active status)
  const timeBuffer = 30 * 60 * 1000; // 30 minutes buffer
  const existingBooking = await Booking.findOne({
    userId: req.user._id,
    startDateTime: {
      $gte: new Date(tripDate.getTime() - timeBuffer),
      $lte: new Date(tripDate.getTime() + timeBuffer)
    },
    status: { $nin: [BOOKING_STATUS.CANCELLED, BOOKING_STATUS.COMPLETED, BOOKING_STATUS.REJECTED] } // Check against active statuses
  });

  if (existingBooking) {
    logger.warn('Duplicate booking detected', {
        userId: req.user._id,
        newBookingTime: tripDate.toISOString(),
        existingBookingId: existingBooking.bookingId,
        existingBookingTime: existingBooking.startDateTime.toISOString(),
        existingBookingStatus: existingBooking.status
    });
    throw new ConflictError(
      `Booking conflict: You already have a booking (${existingBooking.bookingId}) scheduled around this time (${existingBooking.startDateTime.toLocaleString()}). Please cancel the existing booking or choose a different time.`
    );
  }


  // ========================================
  // CREATE BOOKING
  // ========================================
  let booking;
  try {
      booking = await Booking.create({
        userId: req.user._id,
        // bookingId is generated by pre-save hook
        bookingType,
        pickupLocation,
        dropLocation, // Will be null/undefined if not provided (e.g., local)
        viaLocations: viaLocations || [], // <-- ADDED
        startDateTime: tripDate,
        endDateTime: endDateTime ? new Date(endDateTime) : null,
        vehicleType,
        passengerDetails: finalPassengerDetails, // Use validated details
        fareDetails,
        status: BOOKING_STATUS.CONFIRMED, // Start as confirmed
        specialRequests: Array.isArray(specialRequests) ? specialRequests : [],
        notes: notes || null,
        metadata: {
          source: req.headers['x-app-source'] || 'API', // Try getting source from header
          ipAddress: req.ip,
          userAgent: req.get('user-agent'),
          searchId: searchId || null // Include searchId if provided
        }
      });
  } catch (error) {
       logger.error('Error saving booking to database', {
           userId: req.user._id,
           error: error.message,
           bookingData: { bookingType, startDateTime: tripDate, vehicleType } // Log minimal data
       });
       if (error.name === 'ValidationError') {
            throw new BadRequestError(`Booking validation failed: ${error.message}`);
       }
       throw new ServiceUnavailableError('Failed to create booking. Please try again.'); // More generic error for DB issues
  }


  // Populate user details for notification logic (careful not to over-populate)
  await booking.populate('userId', 'deviceInfo name email phoneNumber'); // Populate necessary fields

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

  // Send booking confirmation notification to user
  const user = booking.userId;
  if (user?.deviceInfo?.length > 0) {
     const latestDevice = user.deviceInfo.sort((a, b) => new Date(b.lastUsed) - new Date(a.lastUsed))[0]; // Ensure correct date comparison
     const fcmToken = latestDevice?.fcmToken;

    if (fcmToken) {
      sendBookingNotification(
        fcmToken,
        booking.bookingId,
        'confirmed', // Use lowercase status for notification type consistency
        `Your booking ${booking.bookingId} from ${booking.pickupLocation.city} ${booking.dropLocation ? `to ${booking.dropLocation.city}` : ''} is confirmed for ${tripDate.toLocaleDateString()}.`
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

  // TODO: Send SMS confirmation (Requires SMS Service Integration)
  // TODO: Send email confirmation (Requires Email Service Integration)
  // TODO: Trigger driver search/assignment logic (e.g., emit socket event, call another service)

  // Respond to the client
  return sendSuccess(
    res,
    {
      booking: booking.toObject({ virtuals: true }), // Send plain object with virtuals if needed
      message: 'Your booking has been confirmed. You will receive driver details shortly.'
    },
    'Booking created successfully',
    201 // Use 201 Created status code
  );
});

/**
 * @desc    Get booking by ID
 * @route   GET /api/bookings/:id
 * @access  Private
 */
export const getBooking = catchAsync(async (req, res) => {
  const bookingDbId = req.params.id; // It's the DB _id

  const booking = await Booking.findOne({
    _id: bookingDbId,
    userId: req.user._id // Ensure user owns the booking
  })
    .populate('userId', 'phoneNumber name email profilePicture') // Populate user details
    .populate('vehicleId', 'type modelName licensePlate color capacity features year fuelType') // Populate vehicle details
    .populate('driverId', 'name phoneNumber rating totalRides profilePicture vehicleId'); // Populate driver details + their vehicle if needed

  if (!booking) {
    logger.warn('Booking not found by DB ID or user mismatch', {
      bookingDbId,
      userId: req.user._id
    });
    throw new NotFoundError('Booking not found');
  }

  logger.info('Booking retrieved by DB ID', {
    bookingId: booking.bookingId, // Log the user-facing ID
    dbId: booking._id,
    userId: req.user._id
  });

  // Optionally enhance response, e.g., calculate time remaining
  const responseData = booking.toObject({ virtuals: true });
  // responseData.timeUntilPickup = // Calculate if needed

  return sendSuccess(res, responseData, 'Booking retrieved successfully', 200);
});

/**
 * @desc    Get booking by booking code (User-facing ID)
 * @route   GET /api/bookings/code/:bookingId
 * @access  Private
 */
export const getBookingByCode = catchAsync(async (req, res) => {
    const bookingCode = req.params.bookingId?.toUpperCase(); // Normalize booking code
     if (!bookingCode) {
        throw new BadRequestError("Booking code parameter is required.");
    }

  const booking = await Booking.findOne({
    bookingId: bookingCode,
    userId: req.user._id // Ensure user owns the booking
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
 * @desc    Get all bookings for current user (Paginated)
 * @route   GET /api/bookings
 * @access  Private
 */
export const getAllBookings = catchAsync(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const { status, bookingType, fromDate, toDate, sortBy = '-createdAt' } = req.query; // Default sort by creation date

  // Build query
  const query = { userId: req.user._id };

  // --- Filtering ---
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
    query.startDateTime = {}; // Filter based on trip start time
    if (fromDate) {
      const from = new Date(fromDate);
      if (!isNaN(from.getTime())) {
         from.setHours(0, 0, 0, 0); // Start of the day
        query.startDateTime.$gte = from;
      } else {
           throw new BadRequestError('Invalid fromDate format. Use YYYY-MM-DD or ISO 8601.');
      }
    }
    if (toDate) {
      const to = new Date(toDate);
      if (!isNaN(to.getTime())) {
         to.setHours(23, 59, 59, 999); // End of the day
        query.startDateTime.$lte = to;
      } else {
           throw new BadRequestError('Invalid toDate format. Use YYYY-MM-DD or ISO 8601.');
      }
    }
     if (query.startDateTime.$gte && query.startDateTime.$lte && query.startDateTime.$gte > query.startDateTime.$lte) {
         throw new BadRequestError('fromDate cannot be after toDate.');
     }
  }

  // --- Sorting ---
  const allowedSortFields = {
      'createdAt': 1, '-createdAt': -1,
      'startDateTime': 1, '-startDateTime': -1,
      'fare': 'fareDetails.finalAmount', '-fare': '-fareDetails.finalAmount', // Allow sorting by fare
      'status': 1, '-status': -1
  };
   // Use default if sortBy is invalid, provide feedback in logs
  let sortQuery = { createdAt: -1 }; // Default sort object
  if (allowedSortFields[sortBy]) {
       if (typeof allowedSortFields[sortBy] === 'number') {
           sortQuery = { [sortBy.replace('-', '')]: allowedSortFields[sortBy] };
       } else {
            // Handle nested fields like fare
           const field = allowedSortFields[sortBy].replace('-', '');
           const direction = allowedSortFields[sortBy].startsWith('-') ? -1 : 1;
           sortQuery = { [field]: direction };
       }
  } else if (sortBy) {
        logger.warn('Invalid sortBy parameter received, using default.', { sortBy, allowed: Object.keys(allowedSortFields) });
  }

  // Get total count before pagination
  const total = await Booking.countDocuments(query);

  // Get bookings with pagination, sorting, and population
  const bookings = await Booking.find(query)
    .sort(sortQuery)
    .skip(skip)
    .limit(limit)
    .populate('vehicleId', 'type modelName licensePlate') // Select specific fields
    .populate('driverId', 'name phoneNumber rating') // Select specific fields
    .select('-metadata -trip -cancellation -__v -updatedAt'); // Exclude fields for lighter response

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
    bookings, // Already plain objects if .lean() was used, otherwise mongoose docs
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
  const bookingId = req.params.id; // DB ID

  const booking = await Booking.findOne({
    _id: bookingId,
    userId: req.user._id // Ensure user owns the booking
  }).populate('driverId', 'deviceInfo name') // Populate driver's device info for notification
    .populate('userId', 'deviceInfo name email phoneNumber'); // Populate user's device info

  if (!booking) {
    throw new NotFoundError('Booking not found or you do not have permission to cancel it.');
  }

  // Check if booking can be cancelled by the user
   const cancellableStatuses = [
        BOOKING_STATUS.PENDING,
        BOOKING_STATUS.CONFIRMED,
        BOOKING_STATUS.ASSIGNED
    ];
  if (!cancellableStatuses.includes(booking.status)) {
    throw new BadRequestError(
      `Cannot cancel booking. Current status is: ${booking.status}. Only PENDING, CONFIRMED, or ASSIGNED bookings can be cancelled by the user.`
    );
  }
   // Prevent cancellation too close to or after start time?
   const hoursUntilStart = (new Date(booking.startDateTime) - new Date()) / (1000 * 60 * 60);
   // Example: Allow cancellation up to 1 hour before?
   // if (hoursUntilStart < 1) {
   //     throw new BadRequestError(`Cannot cancel booking less than 1 hour before pickup time.`);
   // }

  // Calculate cancellation charge
  let cancellationCharge = 0;
  let chargeApplied = false;

  // Apply charge only if within the window AND trip hasn't started
   if (hoursUntilStart < BOOKING_CONFIG.CANCELLATION_WINDOW_HOURS && hoursUntilStart >= 0) {
        cancellationCharge = Math.round(
            (booking.fareDetails.finalAmount * BOOKING_CONFIG.CANCELLATION_CHARGE_PERCENT) / 100
        );
        // Ensure charge doesn't exceed total fare? Usually not needed if % is reasonable.
        // cancellationCharge = Math.min(cancellationCharge, booking.fareDetails.finalAmount);
        chargeApplied = true;
   }


  // Update booking status and cancellation details
  const originalStatus = booking.status;
  booking.status = BOOKING_STATUS.CANCELLED;
  booking.cancellation = {
    cancelledBy: 'USER', // Explicitly user
    cancelledAt: new Date(),
    reason: reason ? reason.trim().substring(0, 200) : 'Cancelled by user', // Limit reason length
    charge: cancellationCharge
  };

  // Save the updated booking
  await booking.save();

  logger.info('Booking cancelled by user', {
    bookingId: booking.bookingId,
    dbId: booking._id,
    userId: req.user._id,
    originalStatus,
    cancellationCharge,
    chargeApplied,
    hoursUntilStart: hoursUntilStart.toFixed(2),
    reason: booking.cancellation.reason
  });

  // ========================================
  // Side Effects & Notifications
  // ========================================

  // 1. Notify User (Push, SMS, Email)
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
  // TODO: Send SMS/Email confirmation of cancellation

  // 2. Notify Driver if one was assigned
  const driver = booking.driverId;
  if (driver) { // Check if driver was populated and exists
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
     // TODO: Send SMS to driver about cancellation
     // TODO: Update driver's availability status if needed (e.g., make them available again)
     // This might involve calling a Driver Service or updating the Driver model directly/via event
  }

  // 3. Handle Refunds (if applicable)
  let refundAmount = 0;
  let refundNote = 'No refund applicable.';
   // Check payment status and method - refine this based on your payment flow
   if ((booking.paymentStatus === PAYMENT_STATUS.COMPLETED || booking.paymentStatus === PAYMENT_STATUS.PROCESSING) &&
       booking.paymentMethod !== PAYMENT_METHODS.CASH) { // Only refund non-cash, completed/processing payments

        refundAmount = Math.max(0, booking.fareDetails.finalAmount - cancellationCharge);
        if (refundAmount > 0) {
            refundNote = chargeApplied
                ? `₹${cancellationCharge} cancellation charge applied. Refund of ₹${refundAmount} initiated.`
                : `Full refund of ₹${booking.fareDetails.finalAmount} initiated.`;

            // ** Trigger actual refund process here **
            // This usually involves calling your payment gateway's refund API
            // Example: await paymentGateway.initiateRefund(booking.paymentTransactionId, refundAmount);
            logger.info('Refund initiation required', { bookingId: booking.bookingId, refundAmount });
            // Update payment status in booking after triggering refund
            // booking.paymentStatus = PAYMENT_STATUS.REFUND_INITIATED;
            // await booking.save(); // Save again if status updated
        } else {
             refundNote = `Cancellation charge (₹${cancellationCharge}) equals or exceeds the paid amount. No refund due.`;
        }
   } else if (booking.paymentMethod === PAYMENT_METHODS.CASH || booking.paymentStatus === PAYMENT_STATUS.PENDING) {
        refundNote = chargeApplied
           ? `Cancellation charge of ₹${cancellationCharge} may be applicable on your next booking or collected separately.` // Policy decision
           : 'No cancellation charge applied.';
   }

  // --- Final Response ---
  return sendSuccess(
    res,
    {
      bookingId: booking.bookingId,
      status: booking.status, // Should be CANCELLED
      cancellationCharge,
      chargeApplied,
      refundAmount,
      refundNote,
      // Return subset of booking data if needed, avoid full object after modification
      cancelledAt: booking.cancellation.cancelledAt
    },
    'Booking cancelled successfully',
    200
  );
});

/**
 * @desc    Add rating to a completed booking by the user
 * @route   POST /api/bookings/:id/rating
 * @access  Private
 */
export const addRating = catchAsync(async (req, res) => {
  const { rating, comment } = req.body;
  const bookingId = req.params.id; // DB ID

  // --- Validation ---
  const numericRating = Number(rating); // Ensure it's a number
  if (isNaN(numericRating) || numericRating < 1 || numericRating > 5) {
    throw new BadRequestError('Rating must be a number between 1 and 5.');
  }
  const intRating = Math.round(numericRating); // Use integer rating

  if (comment && typeof comment !== 'string') {
    throw new BadRequestError('Comment must be a string.');
  }
  const cleanComment = comment ? comment.trim().substring(0, 500) : null; // Limit length, allow null

  // --- Find Booking & Check Conditions ---
  const booking = await Booking.findOne({
    _id: bookingId,
    userId: req.user._id // Ensure user owns the booking
  }).populate('driverId', 'rating completedRides'); // Populate driver fields needed for update

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
        // Decide policy: Allow rating the service even without driver? Or disallow?
        // For now, let's allow rating the booking itself, but driver update will be skipped.
        // throw new BadRequestError('Cannot rate this booking as no driver was assigned.');
   }


  // --- Update Booking ---
  booking.rating = {
    value: intRating,
    comment: cleanComment,
    createdAt: new Date() // Use createdAt consistent with schema
  };

  await booking.save();

  logger.info('Rating added to booking', {
    bookingId: booking.bookingId,
    dbId: booking._id,
    userId: req.user._id,
    rating: intRating,
    hasComment: !!cleanComment,
    driverId: booking.driverId?._id
  });

  // --- Update Driver's Overall Rating (if driver exists) ---
  if (booking.driverId) {
      try {
          const driver = booking.driverId; // Already populated
          const newRatingValue = intRating;

          // Fetch fresh driver data to avoid race conditions if possible, or use populated data
          // For simplicity here, using populated data. Consider findByIdAndUpdate for atomicity.
          const currentTotalRides = driver.completedRides || 0; // Number of rides *before* this one was completed/rated
          const currentRating = driver.rating || 0; // Current average rating

          // Calculate new average
          // Assumes completedRides count reflects the state *before* this rating
          // If completedRides is updated when trip completes, this logic is slightly off
          // A better approach might be storing totalRatingSum and totalRatedRides on Driver model
          const oldRatingSum = currentRating * currentTotalRides;
          const newTotalRatedRides = currentTotalRides + 1; // Increment count for this rating
          const newRatingSum = oldRatingSum + newRatingValue;
          const newAverageRating = newTotalRatedRides > 0 ? newRatingSum / newTotalRatedRides : newRatingValue;

          // Update driver document
          driver.rating = Math.round(newAverageRating * 10) / 10; // Round to 1 decimal place

          // **Important:** Decide where completedRides is incremented.
          // If it's incremented when the trip status becomes COMPLETED, don't increment here.
          // If rating is the *only* place it's updated, then uncomment:
          // driver.completedRides = newTotalRatedRides;

          await driver.save();

           logger.info("Driver's average rating updated", {
               driverId: driver._id,
               previousAvgRating: currentRating,
               newAvgRating: driver.rating,
               ratedBookingId: booking.bookingId,
               // newCompletedRides: driver.completedRides // Log if updated here
           });

           // TODO: Send notification to driver about new rating? (Optional)
      } catch (driverUpdateError) {
          logger.error('Failed to update driver rating after booking rating', {
              driverId: booking.driverId._id,
              bookingId: booking.bookingId,
              error: driverUpdateError.message
          });
          // Non-critical error, booking rating is already saved.
      }
  }

  // --- Response ---
   // TODO: Send thank you notification to user?

  return sendSuccess(
      res,
      {
          rating: booking.rating.value,
          comment: booking.rating.comment,
          ratedAt: booking.rating.createdAt
      },
      'Thank you for your feedback!',
      200 // OK status for update/submission
  );
});


// --- Stub/Placeholder functions for routes defined but potentially redundant ---

/** @deprecated Use GET /api/users/me/bookings/upcoming instead */
export const getUpcomingBookings = catchAsync(async (req, res) => {
    logger.warn("Deprecated route /api/bookings/upcoming accessed. Redirecting logic to user controller or disable.");
    // Forward to logic similar to getAllBookings with appropriate filters
    req.query.status = `${BOOKING_STATUS.CONFIRMED},${BOOKING_STATUS.ASSIGNED}`;
    req.query.fromDate = new Date().toISOString(); // Only future bookings
    req.query.sortBy = 'startDateTime'; // Sort by nearest first
    return getAllBookings(req, res); // Reuse getAllBookings logic
});

/** @deprecated Use GET /api/users/me/bookings/past instead */
export const getBookingHistory = catchAsync(async (req, res) => {
     logger.warn("Deprecated route /api/bookings/history accessed. Redirecting logic to user controller or disable.");
     // Forward to logic similar to getAllBookings with appropriate filters
     req.query.status = `${BOOKING_STATUS.COMPLETED},${BOOKING_STATUS.CANCELLED}`;
     req.query.sortBy = '-startDateTime'; // Sort by most recent first
     return getAllBookings(req, res); // Reuse getAllBookings logic
});

/** @deprecated Use GET /api/users/me/stats instead */
export const getBookingStats = catchAsync(async (req, res) => {
     logger.warn("Deprecated route /api/bookings/stats accessed. Redirecting logic to user controller or disable.");
     // Re-implement or call user controller's stats logic if needed here
     // For now, return simple message or redirect if possible client-side
      return sendSuccess(res, { note: "Please use /api/users/me/stats for user statistics."}, "Endpoint deprecated", 200);
});


/**
 * @desc    Apply discount code to booking
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

  // **CRITICAL:** Only apply discounts before the trip starts and if not already applied
  if (booking.status !== BOOKING_STATUS.CONFIRMED && booking.status !== BOOKING_STATUS.ASSIGNED) {
      throw new BadRequestError(`Cannot apply discount to booking with status: ${booking.status}`);
  }
   if (new Date(booking.startDateTime) <= new Date()) {
       throw new BadRequestError('Cannot apply discount after the trip has started or passed.');
   }
   // Check if 'fareDetails.discountAmount' exists before accessing it
   if (booking.fareDetails?.discountAmount && booking.fareDetails.discountAmount > 0) {
       throw new ConflictError('A discount has already been applied to this booking.');
   }


  logger.info('Attempting to apply discount', {
    bookingId: booking.bookingId,
    userId: req.user._id,
    discountCode: cleanDiscountCode
  });

  // --- Discount Validation & Application Logic ---
  // This is where you'd check the discountCode against your database/rules
  // Example placeholder logic:
  let discountAmount = 0;
  let discountType = null; // e.g., 'PERCENTAGE', 'FIXED'
  let discountDetails = {}; // Store applied code info

  if (cleanDiscountCode === 'FIRST100') {
      // Example: Fixed Rs. 100 off for first booking (check if user has other completed bookings)
      const pastBookings = await Booking.countDocuments({ userId: req.user._id, status: BOOKING_STATUS.COMPLETED });
      if (pastBookings === 0) {
          discountAmount = 100;
          discountType = 'FIXED';
      } else {
          throw new BadRequestError('Discount code "FIRST100" is only valid for your first completed booking.');
      }
  } else if (cleanDiscountCode === 'SAVE10') {
      // Example: 10% off, max Rs. 150
      // Ensure baseFare exists before calculation
      const baseFare = booking.fareDetails?.baseFare || 0;
      discountAmount = Math.min(baseFare * 0.10, 150); // Apply % on base fare, check cap
      discountType = 'PERCENTAGE';
  } else {
      // Code not found or invalid
      throw new BadRequestError(`Invalid or expired discount code: "${discountCode}"`);
  }

   if (discountAmount <= 0) {
        // This handles cases like 10% off a zero base fare, or invalid code logic
        throw new BadRequestError('Discount code is valid but resulted in no discount amount.');
   }

   discountAmount = Math.round(discountAmount); // Ensure whole number

   // Apply discount to fareDetails
   // IMPORTANT: Decide if discount applies before or after GST. Usually before.
   // Recalculate GST and final amount
   const baseFareForCalc = booking.fareDetails?.baseFare || 0;
   const nightChargesForCalc = booking.fareDetails?.nightCharges || 0;
   const originalSubtotal = baseFareForCalc + nightChargesForCalc; // Calculate subtotal safely

   const subtotalAfterDiscount = Math.max(0, originalSubtotal - discountAmount); // Ensure subtotal doesn't go below 0
   const newGst = calculateGST(subtotalAfterDiscount, TAX_CONFIG.GST_RATE);
   const newFinalAmount = subtotalAfterDiscount + newGst;

   // Ensure fareDetails exists before assigning properties
   if (!booking.fareDetails) {
        booking.fareDetails = {}; // Initialize if somehow missing (shouldn't happen based on createBooking validation)
   }

    booking.fareDetails.discountCode = cleanDiscountCode;
    booking.fareDetails.discountAmount = discountAmount;
    booking.fareDetails.discountType = discountType;
    booking.fareDetails.subtotal = Math.round(subtotalAfterDiscount); // Update subtotal if needed by your schema
    booking.fareDetails.gst = Math.round(newGst);
    booking.fareDetails.finalAmount = Math.round(newFinalAmount);

   // Update totalFare as well if it represents pre-GST amount and exists in your schema
   // booking.fareDetails.totalFare = Math.round(subtotalAfterDiscount);


  await booking.save();

  logger.info('Discount applied successfully', {
    bookingId: booking.bookingId,
    discountCode: cleanDiscountCode,
    discountAmount,
    newFinalAmount: booking.fareDetails.finalAmount
  });

  // TODO: Send notification to user about applied discount?

  return sendSuccess(
      res,
      {
          bookingId: booking.bookingId,
          fareDetails: booking.fareDetails, // Send updated fare details (no need for .toObject() unless virtuals needed here)
          message: `Discount code "${cleanDiscountCode}" applied successfully. New total: ₹${booking.fareDetails.finalAmount}`
      },
      'Discount applied successfully',
      200
  );
});

/**
 * @desc    Get fare estimate for a route
 * @route   POST /api/bookings/estimate-fare
 * @access  Public
 */
export const getFareEstimate = catchAsync(async (req, res) => {
  // Use pricingService for estimation
  const { from, to, type, distance, vehicleType, startDateTime, fromCoordinates, toCoordinates } = req.body;

  let estimatedDistance = distance;

   // Logic similar to searchCabs to get distance if not provided
  if (!estimatedDistance || typeof estimatedDistance !== 'number' || estimatedDistance <= 0) {
       if (fromCoordinates && toCoordinates && typeof fromCoordinates.lat === 'number' && typeof toCoordinates.lat === 'number') {
           try {
               estimatedDistance = await getDrivingDistanceOSRM(fromCoordinates, toCoordinates) ||
                                    pricingService.calculateDistanceFromCoordinates(fromCoordinates, toCoordinates); // Use OSRM first, fallback to straight-line
           } catch (distError) {
                logger.warn('Failed to calculate distance for estimate from coords', { fromCoordinates, toCoordinates, error: distError.message });
                 throw new BadRequestError('Could not calculate distance from provided coordinates.');
           }
       } else if (from && to) {
            // Try geocoding both and then routing
           logger.info('Attempting geocoding + routing for estimate');
            try {
                const origin = await getCoordinatesFromAddressNominatim(from);
                const destination = await getCoordinatesFromAddressNominatim(to);
                if (origin && destination) {
                    estimatedDistance = await getDrivingDistanceOSRM(origin, destination) ||
                                         pricingService.calculateDistanceFromCoordinates(origin, destination);
                } else {
                     // Provide more specific feedback
                      let errorMsg = 'Could not automatically determine coordinates.';
                      if (!origin && !destination) errorMsg += ` Failed for both "${from}" and "${to}".`;
                      else if (!origin) errorMsg += ` Failed for pickup location "${from}".`;
                      else errorMsg += ` Failed for drop-off location "${to}".`;
                     throw new Error(errorMsg);
                }
            } catch (distError) {
                 logger.warn('Failed to automatically calculate distance for estimate', { from, to, error: distError.message });
                 throw new BadRequestError(`Could not automatically determine distance: ${distError.message}. Please provide distance or coordinates.`);
            }
       } else {
           throw new BadRequestError('Please provide distance, valid coordinates, or both from/to addresses for estimation.');
       }
  }

  // Validate final distance
   if (!estimatedDistance || typeof estimatedDistance !== 'number' || estimatedDistance <= 0) {
       throw new BadRequestError('Invalid or zero distance determined for estimation.');
   }


  // Validate other required fields for estimation
  if (!type || !vehicleType) {
    throw new BadRequestError('Booking type and vehicle type are required for estimation');
  }
   // Validate type and vehicleType against constants
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

  // Calculate fare based on booking type using pricingService
   // Ensure pricingService methods handle the specific type correctly
  try {
      switch (type) {
            case BOOKING_TYPES.ONE_WAY:
              fareDetails = pricingService.calculateOutstationFare(vehicleType, estimatedDistance, false, tripDate);
              break;
            case BOOKING_TYPES.ROUND_TRIP:
              fareDetails = pricingService.calculateOutstationFare(vehicleType, estimatedDistance, true, tripDate);
              break;
            case BOOKING_TYPES.LOCAL_8_80:
               // Distance is less relevant here, but pass it if needed by service internals
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
              // Should not happen due to earlier validation, but good practice
              throw new BadRequestError(`Invalid booking type for estimation: ${type}`);
        }
  } catch (pricingError) {
       // Catch errors from pricing service (like invalid vehicle type for package, distance limits)
       logger.error('Error during fare estimation calculation', {
           type, vehicleType, estimatedDistance, error: pricingError.message
        });
       if (pricingError instanceof BadRequestError) { // Check for specific error types
           throw pricingError; // Re-throw known validation errors from pricing service
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
      from: from || (fromCoordinates ? `${fromCoordinates.lat},${fromCoordinates.lng}`: 'Unknown'),
      to: to || (toCoordinates ? `${toCoordinates.lat},${toCoordinates.lng}`: 'Unknown'),
      type,
      vehicleType,
      distance: estimatedDistance,
      fareDetails, // Return the detailed breakdown from pricing service
      validUntil: addHours(new Date(), 1) // Estimate valid for 1 hour
    },
    'Fare estimate calculated successfully',
    200
  );
});

/**
 * @desc    Get cancellation charges for a specific booking
 * @route   GET /api/bookings/:id/cancellation-charges
 * @access  Private
 */
export const getCancellationCharges = catchAsync(async (req, res) => {
  const bookingId = req.params.id; // DB ID

  const booking = await Booking.findOne({
    _id: bookingId,
    userId: req.user._id // Ensure user owns the booking
  });

  if (!booking) {
    throw new NotFoundError('Booking not found or you do not have permission to view it.');
  }

   // Determine if the booking is currently cancellable by the user
   const isCancellable = [
        BOOKING_STATUS.PENDING,
        BOOKING_STATUS.CONFIRMED,
        BOOKING_STATUS.ASSIGNED
   ].includes(booking.status);


  // Calculate potential cancellation charge based on current time
  const hoursUntilStart = (new Date(booking.startDateTime) - new Date()) / (1000 * 60 * 60);
  let cancellationCharge = 0;
  let chargeWillApply = false;
  let chargeReason = "No charge currently applies."; // Default message

  // Only calculate potential charge if it's potentially cancellable and within the window
  if (hoursUntilStart < BOOKING_CONFIG.CANCELLATION_WINDOW_HOURS && hoursUntilStart >= 0) {
        // Ensure fareDetails exists
        const finalAmount = booking.fareDetails?.finalAmount || 0;
        if (finalAmount > 0) {
            cancellationCharge = Math.round(
                (finalAmount * BOOKING_CONFIG.CANCELLATION_CHARGE_PERCENT) / 100
            );
             chargeWillApply = true;
             chargeReason = `Charge applies as cancellation would be within ${BOOKING_CONFIG.CANCELLATION_WINDOW_HOURS} hours of pickup.`;
        } else {
             logger.warn('Cannot calculate cancellation charge percentage as finalAmount is zero or missing', { bookingId: booking.bookingId });
             chargeReason = "Cannot calculate percentage charge on zero fare.";
        }
  } else if (hoursUntilStart < 0) {
       chargeReason = "Trip start time has passed.";
       // Cannot cancel now, so charge is effectively N/A, but we report 0 potential charge.
  } else {
       // Outside window, > CANCELLATION_WINDOW_HOURS
        chargeReason = `No charge applies (more than ${BOOKING_CONFIG.CANCELLATION_WINDOW_HOURS} hours until pickup).`;
  }

   // Refine message based on cancellable status
    if (!isCancellable) {
        chargeReason = `Booking cannot be cancelled (current status: ${booking.status}). Charge calculation is hypothetical.`;
        chargeWillApply = false; // Cannot apply charge if not cancellable
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
        ? `A potential cancellation charge of ₹${cancellationCharge} (${BOOKING_CONFIG.CANCELLATION_CHARGE_PERCENT}%) applies if cancelled now.`
        : chargeReason
    },
    'Cancellation charge information retrieved successfully',
    200
  );
});

/**
 * @desc    Update booking status (Likely for Admin/Driver use)
 * @route   PATCH /api/bookings/:id/status
 * @access  Private (Needs role restriction in ROUTE definition)
 */
export const updateBookingStatus = catchAsync(async (req, res) => {
  const { status, reason, location } = req.body; // Allow optional reason/location
  const bookingId = req.params.id; // DB ID

   // ** ROLE RESTRICTION SHOULD BE APPLIED IN THE ROUTE MIDDLEWARE **
   // Example: router.patch('/:id/status', protect, restrictTo('ADMIN', 'DRIVER'), validateObjectId('id'), statusValidation, bookingController.updateBookingStatus);

  if (!status || !Object.values(BOOKING_STATUS).includes(status)) {
    throw new BadRequestError(`Invalid status value provided. Valid statuses are: ${Object.values(BOOKING_STATUS).join(', ')}`);
  }

  // Find booking (Admins/Drivers might need broader access than just userId match)
  const booking = await Booking.findById(bookingId)
        .populate('userId', 'deviceInfo name') // Populate for notifications
        .populate('driverId', 'deviceInfo name'); // Populate for notifications

  if (!booking) {
    throw new NotFoundError(`Booking with ID ${bookingId} not found`);
  }

  // Prevent users from updating status if this endpoint is somehow accessible
   if (req.user.role === 'CUSTOMER' && booking.userId.toString() !== req.user._id.toString()) {
       throw new AuthorizationError('You do not have permission to update this booking status.');
   }
   // If it's the user trying to update their *own* booking status - generally disallowed except maybe CANCELLED via specific endpoint
   if (req.user.role === 'CUSTOMER' && booking.userId.toString() === req.user._id.toString() && status !== BOOKING_STATUS.CANCELLED) {
        throw new AuthorizationError('Customers can only cancel bookings via the specific cancel endpoint.');
   }


  // --- Validate Status Transition ---
   const currentStatus = booking.status;
   const allowedTransitions = {
       // Define who can make which transition (example)
       // Format: currentStatus: { allowedNextStatus: [allowedRoles] }
       [BOOKING_STATUS.PENDING]: {
            [BOOKING_STATUS.CONFIRMED]: ['ADMIN'],
            [BOOKING_STATUS.REJECTED]: ['ADMIN'],
            [BOOKING_STATUS.CANCELLED]: ['ADMIN', 'CUSTOMER'] // User via cancelBooking
       },
       [BOOKING_STATUS.CONFIRMED]: {
            [BOOKING_STATUS.ASSIGNED]: ['ADMIN'], // Admin assigns driver
            [BOOKING_STATUS.CANCELLED]: ['ADMIN', 'CUSTOMER'] // User via cancelBooking
       },
       [BOOKING_STATUS.ASSIGNED]: {
            [BOOKING_STATUS.IN_PROGRESS]: ['DRIVER'], // Driver starts trip
            [BOOKING_STATUS.CANCELLED]: ['ADMIN', 'CUSTOMER', 'DRIVER'] // Driver can cancel if needed? Requires reason.
       },
       [BOOKING_STATUS.IN_PROGRESS]: {
            [BOOKING_STATUS.COMPLETED]: ['DRIVER'] // Driver ends trip
            // Maybe ADMIN can force cancel/complete?
       },
       // Final states (usually no transitions out)
       [BOOKING_STATUS.COMPLETED]: {},
       [BOOKING_STATUS.CANCELLED]: {},
       [BOOKING_STATUS.REJECTED]: {}
   };

    const transitionsForCurrent = allowedTransitions[currentStatus];
    if (!transitionsForCurrent || !transitionsForCurrent[status]) {
         logger.warn('Invalid status transition attempt', { bookingId: booking.bookingId, currentStatus, attemptedStatus: status, userRole: req.user.role, userId: req.user._id });
         throw new BadRequestError(`Cannot change booking status from ${currentStatus} to ${status}.`);
    }
    // Check role permission for this specific transition
     if (!transitionsForCurrent[status].includes(req.user.role)) {
         logger.warn('Unauthorized status transition attempt by role', { bookingId: booking.bookingId, currentStatus, attemptedStatus: status, userRole: req.user.role, userId: req.user._id });
         throw new AuthorizationError(`Your role (${req.user.role}) is not authorized to change status from ${currentStatus} to ${status}.`);
     }


   // --- Update Timestamps & Trip Details ---
   const now = new Date();
   if (status === BOOKING_STATUS.IN_PROGRESS && !booking.trip?.actualStartTime) {
        if (!booking.trip) booking.trip = {};
        booking.trip.actualStartTime = now;
        // Optional: Capture driver start location?
        // if (location && location.lat && location.lng) booking.trip.startLocation = { type: 'Point', coordinates: [location.lng, location.lat] };
   } else if (status === BOOKING_STATUS.COMPLETED && !booking.trip?.actualEndTime) {
       if (!booking.trip) booking.trip = {};
       booking.trip.actualEndTime = now;
       // Optional: Capture driver end location, final distance, odometer readings
       // if (location && location.lat && location.lng) booking.trip.endLocation = { type: 'Point', coordinates: [location.lng, location.lat] };
       // booking.trip.actualDistance = req.body.actualDistance; // Requires input
       // booking.trip.endOdometer = req.body.endOdometer; // Requires input

       // ** Increment Driver's completed rides count **
       if (booking.driverId) {
            // Use findByIdAndUpdate for atomicity
            await User.findByIdAndUpdate(booking.driverId._id, { $inc: { completedRides: 1 } });
            logger.info("Incremented driver's completed rides count", { driverId: booking.driverId._id });
       }
   } else if (status === BOOKING_STATUS.CANCELLED && !booking.cancellation) {
       // If status is updated directly to cancelled (e.g., by Admin/Driver)
       booking.cancellation = {
           cancelledBy: req.user.role, // Admin or Driver
           cancelledAt: now,
           reason: reason || `Cancelled by ${req.user.role}`,
           charge: 0 // Or determine charge based on admin/driver cancellation policy
       };
   }

  // Update status
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

   // --- Send Notifications based on status change ---
   const user = booking.userId;
   const driver = booking.driverId; // Assumes driverId populated if status involves driver

   // A. Notify User
    if (user?.deviceInfo?.length > 0) {
        const latestUserDevice = user.deviceInfo.sort((a, b) => new Date(b.lastUsed) - new Date(a.lastUsed))[0];
        const userFcmToken = latestUserDevice?.fcmToken;
        if (userFcmToken) {
            let userMessage = `Update for booking ${booking.bookingId}: Status changed to ${status}.`;
            // Customize messages
            if (status === BOOKING_STATUS.ASSIGNED && driver) userMessage = `Driver ${driver.name} is assigned to your booking ${booking.bookingId}. ETA updates soon!`;
            if (status === BOOKING_STATUS.IN_PROGRESS) userMessage = `Your trip ${booking.bookingId} has started! Track your ride in the app.`;
            if (status === BOOKING_STATUS.COMPLETED) userMessage = `Trip ${booking.bookingId} completed. Hope you had a great ride! Please rate your experience.`;
            if (status === BOOKING_STATUS.CANCELLED) userMessage = `Booking ${booking.bookingId} has been cancelled ${booking.cancellation.cancelledBy !== 'USER' ? `by ${booking.cancellation.cancelledBy}` : ''}. Reason: ${booking.cancellation.reason || 'N/A'}`;
            if (status === BOOKING_STATUS.REJECTED) userMessage = `Unfortunately, your booking request ${booking.bookingId} could not be confirmed at this time. Reason: ${reason || 'Availability issues'}`;


            sendBookingNotification(userFcmToken, booking.bookingId, status.toLowerCase(), userMessage)
             .catch(error => logger.error('Failed to send user status update push notification', { bookingId: booking.bookingId, error: error.message }));
        }
    }
     // TODO: Send SMS/Email status updates to user

    // B. Notify Driver (If status change is relevant, e.g., assignment, cancellation by admin)
     if (driver?.deviceInfo?.length > 0) {
          const latestDriverDevice = driver.deviceInfo.sort((a, b) => new Date(b.lastUsed) - new Date(a.lastUsed))[0];
          const driverFcmToken = latestDriverDevice?.fcmToken;
          if (driverFcmToken) {
              let driverMessage = null;
              let driverTitle = 'Booking Update';
              if (status === BOOKING_STATUS.ASSIGNED && req.user.role === 'ADMIN') { // Notify driver on admin assignment
                   driverTitle = 'New Booking Assigned';
                   driverMessage = `You've been assigned booking ${booking.bookingId}. Pickup: ${booking.pickupLocation.address || booking.pickupLocation.city} at ${booking.startDateTime.toLocaleTimeString()}.`;
              } else if (status === BOOKING_STATUS.CANCELLED && req.user.role !== 'DRIVER') { // Notify driver if cancelled by admin/user
                   driverTitle = 'Booking Cancelled';
                   driverMessage = `Booking ${booking.bookingId} has been cancelled by ${booking.cancellation.cancelledBy}.`;
              }
              // Add more driver notifications (e.g., trip completed confirmation?)

              if (driverMessage) {
                  sendDriverNotification(driverFcmToken, driverTitle, driverMessage, { bookingId: booking.bookingId, newStatus: status })
                   .catch(error => logger.error('Failed to send driver status update push notification', { bookingId: booking.bookingId, driverId: driver._id, error: error.message }));
              }
          }
     }
      // TODO: Send SMS updates to driver


  // --- Response ---
  return sendSuccess(
      res,
      { bookingId: booking.bookingId, status: booking.status }, // Return minimal confirmation
      'Booking status updated successfully',
      200
  );
});

// ========================================
// FINAL EXPORT BLOCK (Regenerated)
// ========================================
export default {
  searchCabs,
  createBooking,
  getBooking,
  getBookingByCode,
  getAllBookings,
  cancelBooking,
  // updateBooking, // Still commented out - intended for restricted use
  getUpcomingBookings, // Deprecated stub
  getBookingHistory, // Deprecated stub
  getBookingStats, // Deprecated stub
  addRating,
  applyDiscount,
  getFareEstimate,
  getCancellationCharges,
  updateBookingStatus // Function for PATCH /:id/status (needs role check)
};
