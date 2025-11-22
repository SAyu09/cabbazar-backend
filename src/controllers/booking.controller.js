// src/controllers/booking.controller.js - UPDATED with Advance Payment Logic
import { Booking, User, Vehicle } from '../models/index.js';
import Driver from '../models/Driver.js';
import Payment from '../models/Payment.js';
import pricingService from '../services/pricing.service.js';
import geoService from '../services/geo.service.js';
import paymentService from '../services/payment.service.js';
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
  TAX_CONFIG,
  DISTANCE_CONFIG,
  ADD_ON_SERVICES
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
  sendDriverNotification,
  sendAdminNotification
} from '../utils/notification.utils.js';

// ========================================
// CONFIGURATION & CONSTANTS
// ========================================

const AIRPORT_KEYWORDS = [
  'airport', 'international', 'domestic', 'terminal',
  'agr', 'del', 'bom', 'blr', 'maa', 'ccu', 'hyd',
  'igi', 'indira gandhi', 'chhatrapati shivaji'
];

const CITY_AIRPORTS = {
  'delhi': 'indira gandhi international (del)',
  'mumbai': 'chhatrapati shivaji (bom)',
  'bangalore': 'kempegowda international (blr)',
  'chennai': 'chennai international (maa)',
  'kolkata': 'netaji subhas chandra bose (ccu)',
  'hyderabad': 'rajiv gandhi international (hyd)',
  'agra': 'agra airport (agr)',
  'jaipur': 'jaipur international (jai)',
  'pune': 'pune airport (pnq)',
  'goa': 'dabolim airport (goi)'
};

const AIRPORT_FIXED_DISTANCES = {
  'agra_agra airport (agr)': 7,
  'agra airport (agr)_agra': 7,
  'delhi_indira gandhi international (del)': 12,
  'indira gandhi international (del)_delhi': 12,
  'mumbai_chhatrapati shivaji (bom)': 15,
  'chhatrapati shivaji (bom)_mumbai': 15,
};

const LOCAL_RENTAL_TYPES = [
  BOOKING_TYPES.LOCAL_2_20,
  BOOKING_TYPES.LOCAL_4_40,
  BOOKING_TYPES.LOCAL_8_80,
  BOOKING_TYPES.LOCAL_12_120
];

const LOCAL_RENTAL_MAX_DISTANCE = 80;
const AIRPORT_MAX_DISTANCE = 200;
const OUTSTATION_MIN_DISTANCE = 250;
const SHORT_DISTANCE_THRESHOLD = 50;
const MAX_VIA_CITIES = 5; // Maximum intermediate stops allowed

// ========================================
// VALIDATION UTILITIES
// ========================================

/**
 * Validate location object structure
 */
const validateLocation = (location, fieldName = 'location') => {
  if (!location) {
    throw new BadRequestError(`${fieldName} is required`);
  }

  if (typeof location !== 'object') {
    throw new BadRequestError(`${fieldName} must be an object`);
  }

  if (!location.city || typeof location.city !== 'string' || location.city.trim().length === 0) {
    throw new BadRequestError(`${fieldName}.city is required and must be a non-empty string`);
  }

  if (location.lat !== undefined && (typeof location.lat !== 'number' || location.lat < -90 || location.lat > 90)) {
    throw new BadRequestError(`${fieldName}.lat must be a number between -90 and 90`);
  }

  if (location.lng !== undefined && (typeof location.lng !== 'number' || location.lng < -180 || location.lng > 180)) {
    throw new BadRequestError(`${fieldName}.lng must be a number between -180 and 180`);
  }

  return true;
};

/**
 * Validate via cities array
 */
const validateViaCities = (viaCities) => {
  if (!viaCities) {
    return [];
  }

  if (!Array.isArray(viaCities)) {
    throw new BadRequestError('viaCities must be an array');
  }

  if (viaCities.length > MAX_VIA_CITIES) {
    throw new BadRequestError(`Maximum ${MAX_VIA_CITIES} intermediate cities allowed`);
  }

  // Validate each via city
  const validatedCities = [];
  for (let i = 0; i < viaCities.length; i++) {
    const city = viaCities[i];

    if (!city || typeof city !== 'string' || city.trim().length === 0) {
      throw new BadRequestError(`Via city at index ${i} is invalid. Must be a non-empty string`);
    }

    const trimmedCity = city.trim();

    if (trimmedCity.length < 2) {
      throw new BadRequestError(`Via city at index ${i} is too short (minimum 2 characters)`);
    }

    if (trimmedCity.length > 100) {
      throw new BadRequestError(`Via city at index ${i} is too long (maximum 100 characters)`);
    }

    validatedCities.push(trimmedCity);
  }

  // Check for duplicate cities
  const uniqueCities = [...new Set(validatedCities.map(c => c.toLowerCase()))];
  if (uniqueCities.length !== validatedCities.length) {
    throw new BadRequestError('Duplicate via cities are not allowed');
  }

  return validatedCities;
};

/**
 * Validate date/time parameters
 */
const validateDateTime = (dateTime, minHoursAhead = BOOKING_CONFIG.MIN_BOOKING_HOURS_AHEAD) => {
  if (!dateTime) {
    throw new BadRequestError('Date/time is required');
  }

  const date = new Date(dateTime);

  if (isNaN(date.getTime())) {
    throw new BadRequestError('Invalid date/time format');
  }

  const now = new Date();
  const minBookingTime = addHours(now, minHoursAhead);
  const maxBookingTime = addDays(now, BOOKING_CONFIG.ADVANCE_BOOKING_DAYS);

  if (date < minBookingTime) {
    throw new BadRequestError(
      `Booking must be at least ${minHoursAhead} hours in advance. Earliest allowed: ${minBookingTime.toISOString()}`
    );
  }

  if (date > maxBookingTime) {
    throw new BadRequestError(
      `Cannot book more than ${BOOKING_CONFIG.ADVANCE_BOOKING_DAYS} days in advance. Latest allowed: ${maxBookingTime.toISOString()}`
    );
  }

  return date;
};

/**
 * Validate passenger details
 */
const validatePassengerDetails = (details, user) => {
  if (!details || typeof details !== 'object' || !details.name || !details.phone) {
    // Use user details as fallback if details are not fully provided
    if (!user.name || !user.phoneNumber) {
      throw new BadRequestError('Passenger details (name and phone) are required, or must be set in user profile.');
    }

    return {
      name: user.name,
      phone: user.phoneNumber,
      email: user.email || null
    };
  }

  const name = details.name?.trim();
  const phone = details.phone?.replace(/\D/g, '');
  const email = details.email?.trim().toLowerCase();

  if (!name || name.length < 2 || name.length > 100) {
    throw new BadRequestError('Passenger name must be between 2 and 100 characters');
  }

  if (!phone || !/^[6-9]\d{9}$/.test(phone)) {
    throw new BadRequestError('Valid 10-digit Indian phone number is required');
  }

  if (email && !/\S+@\S+\.\S+/.test(email)) {
    throw new BadRequestError('Invalid email address format');
  }

  return {
    name,
    phone,
    email: email || null
  };
};

/**
 * Validate add-on services
 */
const validateAddOnServices = (addOnCodes) => {
  if (!Array.isArray(addOnCodes)) {
    return { total: 0, services: [] };
  }

  const uniqueCodes = [...new Set(addOnCodes)];
  const validServices = [];
  let total = 0;

  for (const code of uniqueCodes) {
    const service = ADD_ON_SERVICES[code];

    if (!service) {
      logger.warn('Invalid add-on service code', { code });
      continue;
    }

    validServices.push({
      code,
      name: service.name,
      price: service.price
    });

    total += service.price;
  }

  return {
    total: Math.round(total),
    services: validServices
  };
};

/**
 * Validate vehicle type
 */
const validateVehicleType = (vehicleType) => {
  if (!vehicleType) {
    throw new BadRequestError('Vehicle type is required');
  }

  if (!Object.values(VEHICLE_TYPES).includes(vehicleType)) {
    throw new BadRequestError(
      `Invalid vehicle type: ${vehicleType}. Must be one of: ${Object.values(VEHICLE_TYPES).join(', ')}`
    );
  }

  return vehicleType;
};

/**
 * Validate booking type
 */
const validateBookingType = (bookingType) => {
  if (!bookingType) {
    throw new BadRequestError('Booking type is required');
  }

  if (!Object.values(BOOKING_TYPES).includes(bookingType)) {
    throw new BadRequestError(
      `Invalid booking type: ${bookingType}. Must be one of: ${Object.values(BOOKING_TYPES).join(', ')}`
    );
  }

  return bookingType;
};

// ========================================
// SMART HELPER FUNCTIONS
// ========================================

/**
 * Check if location contains airport keywords
 */
const isAirportLocation = (location) => {
  if (!location) return false;
  const text = location.toLowerCase().trim();
  return AIRPORT_KEYWORDS.some(keyword => text.includes(keyword));
};

/**
 * Get airport for a city
 */
const getAirportForCity = (city) => {
  if (!city) return null;
  const normalizedCity = city.toLowerCase().trim();
  return CITY_AIRPORTS[normalizedCity] || null;
};

/**
 * Get fixed airport distance from lookup table
 */
const getAirportFixedDistance = (pickup, drop) => {
  if (!pickup || !drop) return null;
  const key = `${pickup.toLowerCase().trim()}_${drop.toLowerCase().trim()}`;
  const revKey = `${drop.toLowerCase().trim()}_${pickup.toLowerCase().trim()}`;
  return AIRPORT_FIXED_DISTANCES[key] ?? AIRPORT_FIXED_DISTANCES[revKey] ?? null;
};

/**
 * Calculate multi-city route distance
 */
const calculateMultiCityDistance = async (from, viaCities, to) => {
  if (!geoService.isAvailable()) {
    throw new ServiceUnavailableError('Location service is temporarily unavailable');
  }

  const route = [from, ...viaCities, to];
  let totalDistance = 0;
  let totalDuration = 0;
  const legs = [];

  logger.info('Calculating multi-city route', {
    from,
    via: viaCities,
    to,
    totalStops: route.length
  });

  // Calculate distance for each leg
  for (let i = 0; i < route.length - 1; i++) {
    const origin = route[i];
    const destination = route[i + 1];

    try {
      // Check fixed distance first
      const fixedDistance = getAirportFixedDistance(origin, destination);

      if (fixedDistance) {
        totalDistance += fixedDistance;
        legs.push({
          from: origin,
          to: destination,
          distance: fixedDistance,
          duration: null,
          source: 'airport_fixed_table'
        });

        logger.info('Using fixed distance for leg', {
          leg: i + 1,
          from: origin,
          to: destination,
          distance: fixedDistance
        });
      } else {
        // Geocode and calculate distance
        const originCoords = await geoService.geocode(origin);
        const destinationCoords = await geoService.geocode(destination);
        const matrix = await geoService.getDistanceMatrix(originCoords, destinationCoords);

        totalDistance += matrix.distance;
        totalDuration += matrix.duration;

        legs.push({
          from: origin,
          to: destination,
          distance: matrix.distance,
          duration: matrix.duration,
          source: 'google_distance_matrix',
          originCoords,
          destinationCoords
        });

        logger.info('Calculated distance for leg', {
          leg: i + 1,
          from: origin,
          to: destination,
          distance: matrix.distance,
          duration: matrix.duration
        });
      }
    } catch (error) {
      logger.error('Failed to calculate leg distance', {
        leg: i + 1,
        from: origin,
        to: destination,
        error: error.message
      });
      throw new ServiceUnavailableError(
        `Unable to calculate distance between ${origin} and ${destination}. Please check locations.`
      );
    }
  }

  return {
    totalDistance: Math.round(totalDistance * 10) / 10,
    totalDuration: totalDuration > 0 ? Math.round(totalDuration) : null,
    legs,
    route
  };
};

/**
 * Calculate distance between two locations
 */
const calculateDistance = async (from, to) => {
  if (!geoService.isAvailable()) {
    throw new ServiceUnavailableError('Location service is temporarily unavailable');
  }

  // Try fixed airport distance first
  const fixedDistance = getAirportFixedDistance(from, to);
  if (fixedDistance) {
    logger.info('Using fixed airport distance', { from, to, distance: fixedDistance });
    return {
      distance: fixedDistance,
      duration: null,
      source: 'airport_fixed_table'
    };
  }

  try {
    // Geocode locations
    const originCoords = await geoService.geocode(from);
    const destinationCoords = await geoService.geocode(to);

    // Calculate distance using Google Distance Matrix
    const matrix = await geoService.getDistanceMatrix(originCoords, destinationCoords);

    return {
      distance: matrix.distance,
      duration: matrix.duration,
      source: 'google_distance_matrix',
      originCoords,
      destinationCoords
    };
  } catch (error) {
    logger.error('Distance calculation failed', { error: error.message, from, to });
    throw new ServiceUnavailableError(
      'Unable to calculate distance. Please check your locations and try again.'
    );
  }
};

/**
 * Auto-detect booking type based on locations and distance
 */
const autoDetectBookingType = (from, to, distance, hasViaCities = false) => {
  const pickupIsAirport = isAirportLocation(from);
  const dropIsAirport = isAirportLocation(to);

  // Multi-city routes are always ONE_WAY (or can offer ROUND_TRIP)
  if (hasViaCities) {
    return BOOKING_TYPES.ONE_WAY;
  }

  // Case 1: Airport Transfer
  if (pickupIsAirport || dropIsAirport) {
    if (distance && distance <= AIRPORT_MAX_DISTANCE) {
      return pickupIsAirport ? BOOKING_TYPES.AIRPORT_PICKUP : BOOKING_TYPES.AIRPORT_DROP;
    }
    return BOOKING_TYPES.ONE_WAY;
  }

  // Case 2: Local Rental (same city or short distance)
  if (distance && distance <= LOCAL_RENTAL_MAX_DISTANCE) {
    return BOOKING_TYPES.LOCAL_8_80;
  }

  // Case 3: Outstation
  if (distance && distance >= OUTSTATION_MIN_DISTANCE) {
    return BOOKING_TYPES.ONE_WAY;
  }

  return BOOKING_TYPES.ONE_WAY;
};

/**
 * Get all applicable booking types for a route
 */
const getApplicableBookingTypes = (from, to, distance, hasViaCities = false) => {
  const types = [];
  const pickupIsAirport = isAirportLocation(from);
  const dropIsAirport = isAirportLocation(to);

  // Multi-city routes: only outstation types
  if (hasViaCities) {
    types.push(BOOKING_TYPES.ONE_WAY);
    types.push(BOOKING_TYPES.ROUND_TRIP);
    return types;
  }

  // Airport transfers (if distance <= 200km)
  if ((pickupIsAirport || dropIsAirport) && distance <= AIRPORT_MAX_DISTANCE) {
    if (pickupIsAirport) types.push(BOOKING_TYPES.AIRPORT_PICKUP);
    if (dropIsAirport) types.push(BOOKING_TYPES.AIRPORT_DROP);
  }

  // Local packages (if distance <= 80km and no airport)
  if (distance <= LOCAL_RENTAL_MAX_DISTANCE && !pickupIsAirport && !dropIsAirport) {
    types.push(BOOKING_TYPES.LOCAL_2_20);
    types.push(BOOKING_TYPES.LOCAL_4_40);
    types.push(BOOKING_TYPES.LOCAL_8_80);
    types.push(BOOKING_TYPES.LOCAL_12_120);
  }

  // Outstation (always available)
  types.push(BOOKING_TYPES.ONE_WAY);
  types.push(BOOKING_TYPES.ROUND_TRIP);

  return types;
};

/**
 * Build clean location object
 */
const buildLocationObject = (locationData) => {
  validateLocation(locationData);

  return {
    city: locationData.city.trim(),
    address: locationData.address?.trim() || undefined,
    lat: locationData.lat || undefined,
    lng: locationData.lng || undefined,
  };
};

/**
 * Send notifications to user
 */
const notifyUser = async (user, bookingId, type, message) => {
  if (!user?.deviceInfo?.length) return;

  const latestDevice = user.deviceInfo
    .sort((a, b) => new Date(b.lastUsed) - new Date(a.lastUsed))[0];

  const fcmToken = latestDevice?.fcmToken;

  if (!fcmToken) return;

  try {
    await sendBookingNotification(fcmToken, bookingId, type, message);
    logger.info('User notification sent', { bookingId, type });
  } catch (error) {
    logger.error('Failed to send user notification', {
      bookingId,
      type,
      error: error.message
    });
  }
};

/**
 * Send notifications to driver
 */
const notifyDriver = async (driver, title, message) => {
  const fcmToken = driver?.deviceInfo?.[0]?.fcmToken;

  if (!fcmToken) return;

  try {
    await sendDriverNotification(fcmToken, title, message);
    logger.info('Driver notification sent', { driverId: driver._id });
  } catch (error) {
    logger.error('Failed to send driver notification', {
      driverId: driver._id,
      error: error.message
    });
  }
};

/**
 * Send notifications to admin
 */
const notifyAdmin = async (title, message, metadata = {}) => {
  try {
    await sendAdminNotification(title, message, metadata);
    logger.info('Admin notification sent', { title });
  } catch (error) {
    logger.error('Failed to send admin notification', {
      title,
      error: error.message
    });
  }
};

// ========================================
// MAIN SEARCH CONTROLLER
// ========================================

/**
 * @desc    Smart Search for available cabs with auto-detection and multi-city support
 * @route   POST /api/bookings/search
 * @access  Public
 */
export const searchCabs = catchAsync(async (req, res) => {
  const {
    from,
    to,
    via,
    viaCities,
    date,
    type,
    startDateTime,
    endDateTime,
    includeTolls
  } = req.body;

  // Validation
  if (!from || typeof from !== 'string' || from.trim().length === 0) {
    throw new BadRequestError('Pickup location (from) is required');
  }

  if (!to || typeof to !== 'string' || to.trim().length === 0) {
    throw new BadRequestError('Drop-off location (to) is required');
  }

  // Validate via cities (support both 'via' and 'viaCities' for backward compatibility)
  const viaArray = via || viaCities || [];
  const validatedViaCities = validateViaCities(viaArray);
  const hasViaCities = validatedViaCities.length > 0;

  // Validate date/time
  const tripDate = validateDateTime(date || startDateTime || Date.now());
  const tripEndDate = endDateTime ? new Date(endDateTime) : null;

  // Update user preference for toll inclusion
  if (req.user) {
    req.user.includeTolls = includeTolls === true;
    await req.user.save({ validateBeforeSave: false });
    logger.info('Updated user toll preference', { userId: req.user._id, includeTolls });
  }

  if (tripEndDate && isNaN(tripEndDate.getTime())) {
    throw new BadRequestError('Invalid return date (endDateTime) format');
  }
  if (tripEndDate && tripEndDate < tripDate) {
    throw new BadRequestError('Return date (endDateTime) must be after start date');
  }

  // Check if user explicitly requested a local rental type
  const isLocalRequest = type && LOCAL_RENTAL_TYPES.includes(type);

  // Local rentals cannot have via cities
  if (isLocalRequest && hasViaCities) {
    throw new BadRequestError('Local rental packages do not support intermediate stops (via cities)');
  }

  // Initialize distance variables
  let distance = null;
  let duration = null;
  let source = null;
  let originCoords = null;
  let destinationCoords = null;
  let routeLegs = null;
  let fullRoute = null;

  // Calculate distance based on route type
  if (!isLocalRequest) {
    try {
      if (hasViaCities) {
        // Multi-city route calculation
        const multiCityResult = await calculateMultiCityDistance(
          from,
          validatedViaCities,
          to
        );

        distance = multiCityResult.totalDistance;
        duration = multiCityResult.totalDuration;
        routeLegs = multiCityResult.legs;
        fullRoute = multiCityResult.route;
        source = 'multi_city_route';

        // Get first and last coordinates
        if (routeLegs.length > 0) {
          originCoords = routeLegs[0].originCoords || null;
          destinationCoords = routeLegs[routeLegs.length - 1].destinationCoords || null;
        }

        logger.info('Multi-city route calculated', {
          from,
          via: validatedViaCities,
          to,
          totalDistance: distance,
          legs: routeLegs.length
        });

      } else {
        // Simple two-point route
        const distanceResult = await calculateDistance(from, to);
        distance = distanceResult.distance;
        duration = distanceResult.duration;
        source = distanceResult.source;
        originCoords = distanceResult.originCoords;
        destinationCoords = distanceResult.destinationCoords;
      }
    } catch (error) {
      // If distance calculation fails, check if user wants local rental
      logger.warn('Distance calculation failed', {
        from,
        to,
        via: validatedViaCities,
        error: error.message
      });

      // If locations are same/similar or calculation fails, suggest local rental
      if (from.toLowerCase().trim() === to.toLowerCase().trim()) {
        logger.info('Same pickup and drop location detected, treating as local rental');
        distance = 0; // Set to 0 for local rentals
      } else {
        // Re-throw error if it's truly a distance calculation issue
        throw error;
      }
    }
  } else {
    // For local rentals, set distance to 0
    distance = 0;
    source = 'local_rental';
    logger.info('Local rental requested, skipping distance calculation', {
      from,
      to,
      type
    });
  }

  // Auto-detect or validate booking type
  const detectedType = isLocalRequest
    ? type
    : autoDetectBookingType(from, to, distance || 0, hasViaCities);

  let bookingType = type || detectedType;
  const typeAutoDetected = !type;
  let typeChangedWarning = null;

  // Get applicable types
  const applicableTypes = getApplicableBookingTypes(
    from,
    to,
    distance || 0,
    hasViaCities
  );

  // Validate user-provided type
  if (type && !isLocalRequest) {
    validateBookingType(type);

    if (!applicableTypes.includes(type)) {
      logger.warn('User selected type not applicable, auto-correcting', {
        selectedType: type,
        detectedType,
        distance,
        hasViaCities
      });

      bookingType = detectedType;
      typeChangedWarning = {
        message: hasViaCities
          ? `${type} is not available for multi-city routes. Showing ${detectedType} options instead.`
          : `${type} is not available for this route (distance: ${(distance || 0).toFixed(1)} km). Showing ${detectedType} options instead.`,
        originalType: type,
        correctedType: detectedType,
        reason: hasViaCities ? 'MULTI_CITY_ROUTE' : 'TYPE_NOT_APPLICABLE_FOR_DISTANCE',
        availableTypes: applicableTypes
      };
    }
  }

  // Ensure endDateTime is null if not a round trip
  const finalEndDateTime = (bookingType === BOOKING_TYPES.ROUND_TRIP) ? tripEndDate : null;

  // Get vehicle options & pricing
  const isLocalBooking = LOCAL_RENTAL_TYPES.includes(bookingType);

  // Pass endDateTime AND includeTolls to pricing service
  // Pricing Service calculates Advance Amount and returns it in fareDetails
  const vehicleOptions = pricingService.getVehicleOptions(bookingType, {
    distance: isLocalBooking ? 0 : (distance || 0),
    startDateTime: tripDate,
    endDateTime: finalEndDateTime,
    includeTolls: includeTolls || false
  });

  // Build response
  const searchResults = {
    searchId: generateBookingReference(),
    from,
    to,
    via: hasViaCities ? validatedViaCities : null,
    hasViaCities,
    viaCitiesCount: validatedViaCities.length,
    fullRoute: hasViaCities ? fullRoute : [from, to],
    fromCoordinates: originCoords || null,
    toCoordinates: destinationCoords || null,
    date: tripDate,
    endDateTime: finalEndDateTime,
    distance: isLocalBooking ? null : distance,
    durationMinutes: duration || null,
    distanceSource: source,
    routeLegs: hasViaCities ? routeLegs : null,
    bookingType,
    detectedType,
    typeAutoDetected,
    applicableTypes,
    warning: typeChangedWarning,
    isAirportRoute: isAirportLocation(from) || isAirportLocation(to),
    isLocalRoute: (distance || 0) <= LOCAL_RENTAL_MAX_DISTANCE || isLocalBooking,
    isOutstationRoute: (distance || 0) >= OUTSTATION_MIN_DISTANCE,
    isMultiCity: hasViaCities,
    options: vehicleOptions, // Contains fareDetails with advanceAmount
    validUntil: addHours(new Date(), 1),
    timestamp: new Date(),
    routeInfo: hasViaCities ? {
      totalStops: fullRoute.length,
      intermediateStops: validatedViaCities.length,
      estimatedTotalDuration: duration ? `${Math.round(duration / 60)} hours ${duration % 60} minutes` : null
    } : null
  };

  logger.info('Smart search completed', {
    searchId: searchResults.searchId,
    from,
    to,
    via: validatedViaCities,
    distance,
    bookingType,
    includeTolls: includeTolls || false,
    typeAutoDetected,
    hasViaCities,
    optionsCount: vehicleOptions.length
  });

  return sendSuccess(
    res,
    searchResults,
    'Search results retrieved successfully',
    200
  );
});

// ========================================
// GET APPLICABLE TYPES ENDPOINT
// ========================================

/**
 * @desc    Get applicable booking types for a route
 * @route   POST /api/bookings/applicable-types
 * @access  Public
 */
export const getApplicableTypes = catchAsync(async (req, res) => {
  const { from, to } = req.body;

  if (!from || !to) {
    throw new BadRequestError('Pickup and drop-off locations are required');
  }

  const distanceResult = await calculateDistance(from, to);
  const { distance } = distanceResult;

  const types = getApplicableBookingTypes(from, to, distance);
  const recommended = autoDetectBookingType(from, to, distance);

  return sendSuccess(res, {
    from,
    to,
    distance,
    applicableTypes: types,
    recommendedType: recommended,
    isAirportRoute: isAirportLocation(from) || isAirportLocation(to),
    isLocalRoute: distance <= LOCAL_RENTAL_MAX_DISTANCE,
    isOutstationRoute: distance >= OUTSTATION_MIN_DISTANCE
  }, 'Applicable booking types retrieved', 200);
});

// ========================================
// CREATE BOOKING
// ========================================

/**
 * @desc    Create a booking order (Cash or Online)
 * @route   POST /api/bookings/createBooking
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
    specialRequests,
    notes,
    searchId,
    distance,
    paymentMethod = PAYMENT_METHODS.RAZORPAY,
    addOnCodes,
    isAdvancePayment
  } = req.body;

  // 1. GET 'includeTolls' FROM LOGGED-IN USER
  // Since route is protected, req.user is populated with latest DB data
  // This retrieves the value saved during the search step
  const effectiveIncludeTolls = req.user.includeTolls === true;
  logger.info('Using toll preference from User profile', {
    userId: req.user._id,
    effectiveIncludeTolls
  });
  console.log("----------", effectiveIncludeTolls);
  // 2. VALIDATE INPUTS
  validateBookingType(bookingType);
  validateLocation(pickupLocation, 'pickupLocation');

  const isLocalRental = LOCAL_RENTAL_TYPES.includes(bookingType);
  if (!isLocalRental) {
    validateLocation(dropLocation, 'dropLocation');
  }

  validateVehicleType(vehicleType);

  const tripDate = validateDateTime(startDateTime);
  let tripEndDate = null;
  if (endDateTime) {
    tripEndDate = new Date(endDateTime);
    if (isNaN(tripEndDate.getTime()) || tripEndDate <= tripDate) {
      throw new BadRequestError('End date/time must be valid and after start date/time');
    }
  }
  const finalEndDateTime = (bookingType === BOOKING_TYPES.ROUND_TRIP) ? tripEndDate : null;

  const finalPassengerDetails = validatePassengerDetails(passengerDetails, req.user);
  const { total: addOnsTotal, services: selectedAddOns } = validateAddOnServices(addOnCodes);

  if (!Object.values(PAYMENT_METHODS).includes(paymentMethod)) {
    throw new BadRequestError(`Invalid payment method: ${paymentMethod}`);
  }

  // 3. SERVER-SIDE FARE CALCULATION
  let estimatedDistance = distance;
  let finalFareDetails;
  let finalAmount;

  try {
    if (isLocalRental) {
      estimatedDistance = 0;
    } else if (!estimatedDistance || typeof estimatedDistance !== 'number' || estimatedDistance <= 0) {
      logger.warn('Distance not provided. Recalculating...', { bookingType });

      const origin = pickupLocation.lat && pickupLocation.lng
        ? { lat: pickupLocation.lat, lng: pickupLocation.lng }
        : (pickupLocation.address || pickupLocation.city);

      const dest = dropLocation.lat && dropLocation.lng
        ? { lat: dropLocation.lat, lng: dropLocation.lng }
        : (dropLocation.address || dropLocation.city);

      const distanceResult = await calculateDistance(origin, dest);
      estimatedDistance = distanceResult.distance;
    }

    // *** PASS effectiveIncludeTolls TO PRICING SERVICE ***
    const options = pricingService.getVehicleOptions(bookingType, {
      distance: estimatedDistance || 0,
      startDateTime: tripDate,
      endDateTime: finalEndDateTime,
      includeTolls: effectiveIncludeTolls // <--- Value from User model
    });

    const baseFareDetails = options.find(opt => opt.vehicleType === vehicleType)?.fareDetails;

    if (!baseFareDetails) {
      throw new BadRequestError(`No pricing found for ${vehicleType} on this route.`);
    }

    // Combine base fare with add-ons
    const newSubtotal = baseFareDetails.subtotal + addOnsTotal;
    const newGst = calculateGST(newSubtotal, TAX_CONFIG.GST_RATE);
    const calculatedFinalAmount = Math.round(newSubtotal + newGst);

    // Recalculate advance with add-ons included
    const { advanceAmount, remainingAmount } = pricingService.calculateAdvance(calculatedFinalAmount);

    finalFareDetails = {
      ...baseFareDetails,
      addOnsTotal: Math.round(addOnsTotal),
      subtotal: Math.round(newSubtotal),
      gst: Math.round(newGst),
      totalFare: Math.round(newSubtotal),
      finalAmount: calculatedFinalAmount,
      advanceAmount,
      remainingAmount
    };

    finalAmount = finalFareDetails.finalAmount;

  } catch (error) {
    logger.error('Server-side fare calculation failed', { error: error.message });
    throw new BadRequestError(`Could not calculate fare: ${error.message}`);
  }

  if (!finalAmount || finalAmount <= 0) {
    throw new BadRequestError('Calculated fare is zero or negative. Cannot proceed');
  }

  // 4. DETERMINE AMOUNT TO PAY NOW
  let amountToPayNow = finalFareDetails.finalAmount; // Default: Full Amount

  if (paymentMethod === PAYMENT_METHODS.RAZORPAY && isAdvancePayment === true) {
    amountToPayNow = finalFareDetails.advanceAmount;
    logger.info('Processing Advance Payment Request', { bookingId: searchId, amount: amountToPayNow });
  } else if (paymentMethod === PAYMENT_METHODS.RAZORPAY) {
    // Full Payment requested
    amountToPayNow = finalFareDetails.baseFare;
    logger.info('Processing Full Payment Request', { bookingId: searchId, amount: amountToPayNow });
  }

  const amountInPaise = Math.round(amountToPayNow * 100);

  // Build clean locations
  const cleanPickupLocation = buildLocationObject(pickupLocation);
  const cleanDropLocation = isLocalRental
    ? buildLocationObject(dropLocation || pickupLocation)
    : buildLocationObject(dropLocation);

  const cleanViaLocations = Array.isArray(viaLocations)
    ? viaLocations.filter(loc => loc && loc.city).map(loc => buildLocationObject(loc))
    : [];

  const validSpecialRequests = Array.isArray(specialRequests)
    ? specialRequests.filter(req => typeof req === 'string' && req.trim().length > 0).map(req => req.trim().substring(0, 200))
    : [];

  const validNotes = notes && typeof notes === 'string' ? notes.trim().substring(0, 500) : null;

  // 5. CREATE BOOKING & PAYMENT DOCS
  const booking = new Booking({
    userId: req.user._id,
    bookingType,
    pickupLocation: cleanPickupLocation,
    dropLocation: cleanDropLocation,
    viaLocations: cleanViaLocations,
    startDateTime: tripDate,
    endDateTime: finalEndDateTime,
    vehicleType,
    passengerDetails: finalPassengerDetails,
    fareDetails: finalFareDetails,
    status: BOOKING_STATUS.PENDING,
    specialRequests: validSpecialRequests,
    notes: validNotes,
    addOnServices: selectedAddOns,
    metadata: {
      source: req.headers['x-app-source'] || 'API',
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
      searchId
    }
  });

  await booking.save();

  const payment = new Payment({
    userId: req.user._id,
    bookingId: booking._id,
    amount: amountToPayNow,
    currency: 'INR',
    status: PAYMENT_STATUS.PENDING,
    method: paymentMethod
  });

  await payment.save();

  booking.paymentId = payment._id;
  await booking.save();

  logger.info('Pending booking & payment docs created', {
    bookingId: booking.bookingId,
    paymentId: payment._id,
    finalAmount,
    amountToPayNow
  });

  // 6. HANDLE PAYMENT METHOD
  if (paymentMethod === PAYMENT_METHODS.CASH) {
    payment.method = PAYMENT_METHODS.CASH;
    booking.status = BOOKING_STATUS.CONFIRMED;

    await payment.save();
    await booking.save();

    logger.info('Booking confirmed with CASH', { bookingId: booking.bookingId });

    notifyAdmin(
      'New Cash Booking Confirmed',
      `Booking ${booking.bookingId} confirmed for ₹${booking.fareDetails.finalAmount}`
    ).catch(err => { });

    const user = await User.findById(req.user._id).select('deviceInfo');
    await notifyUser(
      user,
      booking.bookingId,
      'confirmed',
      `Your cash booking ${booking.bookingId} is confirmed.`
    );

    return sendSuccess(
      res,
      {
        booking: booking.toObject({ virtuals: true }),
        payment: payment.toObject(),
        message: 'Booking confirmed! Pay the driver at trip end.',
      },
      'Booking confirmed (Pay Later)',
      201
    );

  } else {
    // Online payment (Razorpay)
    payment.method = PAYMENT_METHODS.RAZORPAY;
    const receiptId = `receipt_${booking.bookingId}`;
    const razorpayNotes = {
      bookingDbId: booking._id.toString(),
      bookingId: booking.bookingId,
      userId: req.user._id.toString(),
      isAdvance: isAdvancePayment ? 'true' : 'false'
    };

    const razorpayOrder = await paymentService.createOrder(
      amountInPaise,
      receiptId,
      razorpayNotes
    );

    payment.razorpayOrderId = razorpayOrder.id;
    payment.receiptId = receiptId;
    await payment.save();

    return sendSuccess(
      res,
      {
        razorpayKey: process.env.RAZORPAY_KEY_ID,
        orderId: razorpayOrder.id,
        amount: razorpayOrder.amount, // In paise
        currency: 'INR',
        bookingId: booking.bookingId,
        bookingDbId: booking._id,
        fareDetails: booking.fareDetails,
        payNow: amountToPayNow,
        isAdvancePayment: !!isAdvancePayment,
        totalFare: finalAmount,
        advancePercent: BOOKING_CONFIG.ADVANCE_PAYMENT_PERCENTAGE,
        prefill: {
          name: finalPassengerDetails.name,
          email: finalPassengerDetails.email,
          contact: finalPassengerDetails.phone,
        },
      },
      isAdvancePayment
        ? 'Booking order created for Advance Payment.'
        : 'Booking order created for Full Payment.',
      200
    );
  }
});



// ========================================
// VERIFY PAYMENT
// ========================================

/**
 * @desc    Verify payment and confirm booking
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

  // Validate required parameters
  if (!razorpay_payment_id || typeof razorpay_payment_id !== 'string') {
    throw new BadRequestError('Valid razorpay_payment_id is required');
  }

  if (!razorpay_order_id || typeof razorpay_order_id !== 'string') {
    throw new BadRequestError('Valid razorpay_order_id is required');
  }

  if (!razorpay_signature || typeof razorpay_signature !== 'string') {
    throw new BadRequestError('Valid razorpay_signature is required');
  }

  if (!bookingDbId) {
    throw new BadRequestError('bookingDbId is required');
  }

  // Validate MongoDB ObjectId format
  if (!bookingDbId.match(/^[0-9a-fA-F]{24}$/)) {
    throw new BadRequestError('Invalid bookingDbId format');
  }

  // Find booking with payment
  const booking = await Booking.findById(bookingDbId)
    .populate('paymentId')
    .populate('userId', 'deviceInfo name email phoneNumber');

  if (!booking) {
    throw new NotFoundError('Booking not found');
  }

  // Authorization check
  if (booking.userId._id.toString() !== req.user._id.toString()) {
    throw new AuthorizationError('You are not authorized to verify this booking');
  }

  if (!booking.paymentId) {
    throw new ServiceUnavailableError('Payment record not found for this booking');
  }

  const payment = booking.paymentId;

  // Idempotency check
  if ((payment.status === PAYMENT_STATUS.COMPLETED || payment.status === PAYMENT_STATUS.ADVANCED) && booking.status === BOOKING_STATUS.CONFIRMED) {
    logger.warn('Attempt to verify an already processed booking', {
      bookingId: booking.bookingId,
      userId: req.user._id
    });

    return sendSuccess(
      res,
      {
        booking: booking.toObject({ virtuals: true }),
        payment: payment.toObject(),
        message: 'Booking already confirmed.'
      },
      'Booking already confirmed',
      200
    );
  }

  // Prevent double processing
  if (payment.razorpayPaymentId === razorpay_payment_id) {
    logger.warn('Duplicate payment verification attempt', {
      bookingId: booking.bookingId,
      paymentId: razorpay_payment_id
    });

    if (payment.status === PAYMENT_STATUS.COMPLETED || payment.status === PAYMENT_STATUS.ADVANCED) {
      return sendSuccess(
        res,
        {
          booking: booking.toObject({ virtuals: true }),
          payment: payment.toObject(),
          message: 'Payment already verified.'
        },
        'Payment already verified',
        200
      );
    }
  }

  // Verify order ID matches
  if (payment.razorpayOrderId !== razorpay_order_id) {
    logger.error('Order ID mismatch', {
      bookingId: booking.bookingId,
      expectedOrderId: payment.razorpayOrderId,
      receivedOrderId: razorpay_order_id
    });
    throw new BadRequestError('Order ID mismatch. Invalid payment details');
  }

  // Verify signature
  const isValid = paymentService.verifyPaymentSignature(
    razorpay_order_id,
    razorpay_payment_id,
    razorpay_signature
  );

  if (!isValid) {
    // Mark as failed
    booking.status = BOOKING_STATUS.REJECTED;
    payment.status = PAYMENT_STATUS.FAILED;
    payment.failureReason = 'Signature verification failed';
    payment.razorpayPaymentId = razorpay_payment_id;

    await payment.save();
    await booking.save();

    logger.error('Invalid payment signature', {
      bookingId: booking.bookingId,
      orderId: razorpay_order_id,
      paymentId: razorpay_payment_id
    });

    throw new BadRequestError('Invalid payment signature. Payment verification failed');
  }

  // --- [UPDATED STATUS LOGIC] ---
  // Signature is valid - Determine Payment Status
  const totalFare = booking.fareDetails.finalAmount;
  const paidAmount = payment.amount;

  // If paid amount is less than total fare (Advance Payment)
  if (paidAmount < totalFare) {
    payment.status = PAYMENT_STATUS.ADVANCED;
    logger.info(`Payment verified as ADVANCED. Paid: ${paidAmount}, Total: ${totalFare}`);
  } else {
    payment.status = PAYMENT_STATUS.COMPLETED;
    logger.info(`Payment verified as COMPLETED. Paid: ${paidAmount}, Total: ${totalFare}`);
  }

  // Booking is confirmed in either case (Full or Advance)
  booking.status = BOOKING_STATUS.CONFIRMED;

  payment.razorpayPaymentId = razorpay_payment_id;
  payment.razorpaySignature = razorpay_signature;
  payment.method = PAYMENT_METHODS.UPI; // Or specific method if available

  await payment.save();
  await booking.save();

  logger.info('Payment verified and booking confirmed', {
    bookingId: booking.bookingId,
    paymentId: payment._id,
    razorpayPaymentId: razorpay_payment_id,
    status: payment.status
  });

  // Send notifications
  const notifTitle = payment.status === PAYMENT_STATUS.ADVANCED
    ? 'New Online Booking Confirmed (Advance Paid)'
    : 'New Online Booking Confirmed (Full Paid)';

  notifyAdmin(
    notifTitle,
    `Booking ${booking.bookingId} (${booking.bookingType}) from ${booking.pickupLocation.city} to ${booking.dropLocation.city} confirmed. Total: ₹${totalFare}, Paid: ₹${paidAmount}, Status: ${payment.status}`,
    { bookingId: booking.bookingId, paymentId: razorpay_payment_id }
  ).catch(err => logger.error('Admin notification failed', { err: err.message }));

  const user = booking.userId;
  await notifyUser(
    user,
    booking.bookingId,
    'confirmed',
    `Your payment of ₹${paidAmount} was successful! Booking ${booking.bookingId} is confirmed.`
  );

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

// ========================================
// GET BOOKING BY DATABASE ID
// ========================================

/**
 * @desc    Get booking by database ID
 * @route   GET /api/bookings/getBooking/:id
 * @access  Private
 */
export const getBooking = catchAsync(async (req, res) => {
  const bookingDbId = req.params.id;

  // Validate ObjectId format
  if (!bookingDbId.match(/^[0-9a-fA-F]{24}$/)) {
    throw new BadRequestError('Invalid booking ID format');
  }

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
    logger.warn('Booking not found or unauthorized access', {
      bookingDbId,
      userId: req.user._id
    });
    throw new NotFoundError('Booking not found or you do not have access to it');
  }

  logger.info('Booking retrieved by DB ID', {
    bookingId: booking.bookingId,
    userId: req.user._id
  });

  return sendSuccess(
    res,
    booking.toObject({ virtuals: true }),
    'Booking retrieved successfully',
    200
  );
});

// ========================================
// GET BOOKING BY CODE
// ========================================

/**
 * @desc    Get booking by booking code
 * @route   GET /api/bookings/code/:bookingId
 * @access  Private
 */
export const getBookingByCode = catchAsync(async (req, res) => {
  const bookingCode = req.params.bookingId?.trim().toUpperCase();

  if (!bookingCode) {
    throw new BadRequestError('Booking code is required');
  }

  // Validate booking code format (adjust regex based on your format)
  if (!/^[A-Z0-9-]+$/.test(bookingCode)) {
    throw new BadRequestError('Invalid booking code format');
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
    logger.warn('Booking not found by code or unauthorized access', {
      bookingCode,
      userId: req.user._id
    });
    throw new NotFoundError(`Booking with code ${bookingCode} not found or you do not have access to it`);
  }

  logger.info('Booking retrieved by code', {
    bookingId: booking.bookingId,
    userId: req.user._id
  });

  return sendSuccess(
    res,
    booking.toObject({ virtuals: true }),
    'Booking retrieved successfully',
    200
  );
});

// ========================================
// GET ALL BOOKINGS
// ========================================

/**
 * @desc    Get all bookings for current user
 * @route   GET /api/bookings
 * @access  Private
 */
export const getAllBookings = catchAsync(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const { status, bookingType, fromDate, toDate, sortBy = '-createdAt' } = req.query;

  const query = { userId: req.user._id };

  // Filter by status
  if (status) {
    const statuses = status
      .split(',')
      .map(s => s.trim().toUpperCase())
      .filter(s => Object.values(BOOKING_STATUS).includes(s));

    if (statuses.length > 0) {
      query.status = { $in: statuses };
    }
  }

  // Filter by booking type
  if (bookingType) {
    const type = bookingType.trim().toUpperCase();
    if (Object.values(BOOKING_TYPES).includes(type)) {
      query.bookingType = type;
    }
  }

  // Filter by date range
  if (fromDate) {
    const fromDateObj = new Date(fromDate);
    if (!isNaN(fromDateObj.getTime())) {
      query.startDateTime = { $gte: fromDateObj };
    }
  }

  if (toDate) {
    const toDateObj = new Date(toDate);
    if (!isNaN(toDateObj.getTime())) {
      query.startDateTime = { ...query.startDateTime, $lte: toDateObj };
    }
  }

  // Validate sort parameter
  const allowedSortFields = ['createdAt', '-createdAt', 'startDateTime', '-startDateTime'];
  const validSortBy = allowedSortFields.includes(sortBy) ? sortBy : '-createdAt';

  const total = await Booking.countDocuments(query);

  const bookings = await Booking.find(query)
    .sort(validSortBy)
    .skip(skip)
    .limit(limit)
    .populate('vehicleId', 'type modelName licensePlate')
    .populate({ path: 'driverId', select: 'name phoneNumber rating', model: 'Driver' })
    .populate('paymentId', 'status method amount')
    .select('-metadata -__v')
    .lean();

  logger.info('User bookings retrieved', {
    userId: req.user._id,
    count: bookings.length,
    total,
    page,
    limit
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

// ========================================
// CANCEL BOOKING
// ========================================

/**
 * @desc    Cancel a booking by the user
 * @route   PATCH /api/bookings/:id/cancel
 * @access  Private
 */
export const cancelBooking = catchAsync(async (req, res) => {
  const { reason } = req.body;
  const bookingId = req.params.id;

  // Validate ObjectId format
  if (!bookingId.match(/^[0-9a-fA-F]{24}$/)) {
    throw new BadRequestError('Invalid booking ID format');
  }

  const booking = await Booking.findOne({
    _id: bookingId,
    userId: req.user._id
  })
    .populate('paymentId')
    .populate('driverId', 'deviceInfo name')
    .populate('userId', 'deviceInfo name email phoneNumber');

  if (!booking) {
    throw new NotFoundError('Booking not found or you do not have permission to cancel it');
  }

  // Check if booking can be cancelled
  const cancellableStatuses = [
    BOOKING_STATUS.PENDING,
    BOOKING_STATUS.CONFIRMED,
    BOOKING_STATUS.ASSIGNED
  ];

  if (!cancellableStatuses.includes(booking.status)) {
    throw new BadRequestError(
      `Cannot cancel booking in ${booking.status} status. Only ${cancellableStatuses.join(', ')} bookings can be cancelled`
    );
  }

  // Check if booking is already being cancelled
  if (booking.cancellation) {
    throw new ConflictError('This booking is already cancelled');
  }

  const payment = booking.paymentId;

  // Calculate cancellation charges
  const hoursUntilStart = (new Date(booking.startDateTime) - new Date()) / (1000 * 60 * 60);
  let cancellationCharge = 0;
  let chargeApplied = false;

  // Apply cancellation charge if within cancellation window
  if (
    booking.status !== BOOKING_STATUS.PENDING &&
    hoursUntilStart < BOOKING_CONFIG.CANCELLATION_WINDOW_HOURS &&
    hoursUntilStart >= 0
  ) {
    cancellationCharge = Math.round(
      booking.fareDetails.finalAmount * BOOKING_CONFIG.CANCELLATION_CHARGE_PERCENT
    );
    chargeApplied = true;
  }

  // Validate cancellation reason
  const cleanReason = reason && typeof reason === 'string'
    ? reason.trim().substring(0, 200)
    : 'Cancelled by user';

  const originalStatus = booking.status;

  // Update booking status
  booking.status = BOOKING_STATUS.CANCELLED;
  booking.cancellation = {
    cancelledBy: 'USER',
    cancelledAt: new Date(),
    reason: cleanReason,
    charge: cancellationCharge
  };

  // Process refund
  let refundAmount = 0;
  let refundNote = 'No refund applicable';

  if (payment && (payment.status === PAYMENT_STATUS.COMPLETED || payment.status === PAYMENT_STATUS.ADVANCED)) {
    // If payment was an advance or full, check if paid amount covers cancellation
    // Or refund paid amount minus cancellation charge
    const paidAmount = payment.amount;
    refundAmount = Math.max(0, paidAmount - cancellationCharge);

    if (refundAmount > 0) {
      try {
        const refund = await paymentService.createRefund(
          payment.razorpayPaymentId,
          Math.round(refundAmount * 100)
        );

        payment.status = refundAmount === payment.amount
          ? PAYMENT_STATUS.REFUNDED
          : PAYMENT_STATUS.PARTIALLY_REFUNDED;

        refundNote = `Refund of ₹${refundAmount} initiated successfully (Refund ID: ${refund.id})`;

        logger.info('Refund processed successfully', {
          bookingId: booking.bookingId,
          refundId: refund.id,
          refundAmount
        });
      } catch (refundError) {
        logger.error('Automatic refund failed', {
          bookingId: booking.bookingId,
          error: refundError.message
        });

        refundNote = `Booking cancelled, but automatic refund failed: ${refundError.message}. Please contact support for manual refund`;
      }
    } else {
      refundNote = chargeApplied
        ? `Cancellation charge of ₹${cancellationCharge} applies. No refund due as charge exceeds paid amount.`
        : 'Full cancellation charge applied. No refund due';
    }

    await payment.save();
  } else if (payment && payment.status === PAYMENT_STATUS.PENDING) {
    refundNote = 'Booking cancelled before payment was completed';
    payment.status = PAYMENT_STATUS.FAILED;
    payment.failureReason = 'Booking cancelled by user before payment completion';
    await payment.save();
  } else if (payment && payment.method === PAYMENT_METHODS.CASH) {
    refundNote = chargeApplied
      ? `Cancellation charge of ₹${cancellationCharge} may be applicable if driver was assigned`
      : 'Cash booking cancelled successfully';
  } else if (!payment && booking.status === BOOKING_STATUS.PENDING) {
    refundNote = 'Pending booking cancelled successfully';
  }

  await booking.save();

  logger.info('Booking cancelled by user', {
    bookingId: booking.bookingId,
    originalStatus,
    cancellationCharge,
    refundAmount,
    chargeApplied
  });

  // Send notifications
  const user = booking.userId;
  await notifyUser(
    user,
    booking.bookingId,
    'cancelled',
    `Your booking ${booking.bookingId} has been cancelled. ${refundNote}`
  );

  const driver = booking.driverId;
  if (driver) {
    await notifyDriver(
      driver,
      'Booking Cancelled',
      `Booking ${booking.bookingId} has been cancelled by the customer`
    );
  }

  await notifyAdmin(
    'Booking Cancelled by User',
    `Booking ${booking.bookingId} cancelled by user. Refund: ₹${refundAmount}, Charge: ₹${cancellationCharge}`,
    { bookingId: booking.bookingId, userId: user._id }
  );

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

// ========================================
// ADD RATING
// ========================================

/**
 * @desc    Add rating to completed booking
 * @route   POST /api/bookings/:id/rating
 * @access  Private
 */
export const addRating = catchAsync(async (req, res) => {
  const { rating, comment } = req.body;
  const bookingId = req.params.id;

  // Validate ObjectId format
  if (!bookingId.match(/^[0-9a-fA-F]{24}$/)) {
    throw new BadRequestError('Invalid booking ID format');
  }

  // Validate rating
  if (rating === undefined || rating === null) {
    throw new BadRequestError('Rating is required');
  }

  const numericRating = Number(rating);

  if (isNaN(numericRating) || numericRating < 1 || numericRating > 5) {
    throw new BadRequestError('Rating must be a number between 1 and 5');
  }

  const intRating = Math.round(numericRating);

  // Validate comment
  const cleanComment = comment && typeof comment === 'string'
    ? comment.trim().substring(0, 500)
    : null;

  const booking = await Booking.findOne({
    _id: bookingId,
    userId: req.user._id
  }).populate('driverId', 'rating completedRides');

  if (!booking) {
    throw new NotFoundError('Booking not found or you cannot rate it');
  }

  if (booking.status !== BOOKING_STATUS.COMPLETED) {
    throw new BadRequestError(
      `Only completed bookings can be rated. Current status: ${booking.status}`
    );
  }

  if (booking.rating && booking.rating.value) {
    throw new ConflictError('This booking has already been rated');
  }

  if (!booking.driverId) {
    logger.warn('Attempted to rate a completed booking with no assigned driver', {
      bookingId: booking.bookingId
    });
    throw new BadRequestError('Cannot rate booking with no assigned driver');
  }

  // Add rating to booking
  booking.rating = {
    value: intRating,
    comment: cleanComment,
    createdAt: new Date()
  };

  await booking.save();

  logger.info('Rating added to booking', {
    bookingId: booking.bookingId,
    rating: intRating,
    hasComment: !!cleanComment
  });

  // Update driver's overall rating
  if (booking.driverId) {
    try {
      const driver = await Driver.findById(booking.driverId._id);

      if (driver) {
        const currentTotalRides = Math.max(1, driver.completedRides || 1);
        const currentRating = driver.rating || 0;

        const newAverageRating =
          ((currentRating * (currentTotalRides - 1)) + intRating) / currentTotalRides;

        driver.rating = Math.round(newAverageRating * 10) / 10;
        await driver.save();

        logger.info("Driver's average rating updated", {
          driverId: driver._id,
          newAvgRating: driver.rating,
          totalRides: currentTotalRides
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
      bookingId: booking.bookingId,
      rating: booking.rating.value,
      comment: booking.rating.comment,
      createdAt: booking.rating.createdAt
    },
    'Thank you for your feedback!',
    200
  );
});

// ========================================
// GET FARE ESTIMATE
// ========================================

/**
 * @desc    Get fare estimate for a route
 * @route   POST /api/bookings/fare-estimate
 * @access  Public
 */
export const getFareEstimate = catchAsync(async (req, res) => {
  const {
    from,
    to,
    type,
    distance,
    vehicleType,
    startDateTime,
    endDateTime, // --- [NEW] ---
    fromCoordinates,
    toCoordinates,
    includeTolls // --- [ADDED] ---
  } = req.body;

  // Validate required fields
  if (!type) {
    throw new BadRequestError('Booking type is required');
  }

  validateBookingType(type);

  if (!vehicleType) {
    throw new BadRequestError('Vehicle type is required');
  }

  validateVehicleType(vehicleType);

  let estimatedDistance = distance;
  const isLocalRental = LOCAL_RENTAL_TYPES.includes(type);

  // Calculate distance if not provided
  if (isLocalRental) {
    estimatedDistance = 0;
  } else if (!estimatedDistance || typeof estimatedDistance !== 'number' || estimatedDistance < 0) {
    if (!from || !to) {
      throw new BadRequestError('Either distance or both from/to locations are required');
    }

    const distanceResult = await calculateDistance(from, to);
    estimatedDistance = distanceResult.distance;
  }

  // Validate distance for non-local bookings
  if (!isLocalRental && (!estimatedDistance || estimatedDistance <= 0)) {
    throw new BadRequestError('Invalid distance for this booking type');
  }

  // Validate start date/time
  let tripDate = new Date();
  if (startDateTime) {
    tripDate = validateDateTime(startDateTime, 0); // Allow immediate bookings for estimates
  }

  // --- [NEW] ---
  let tripEndDate = null;
  if (endDateTime) {
    tripEndDate = new Date(endDateTime);
    if (isNaN(tripEndDate.getTime()) || tripEndDate < tripDate) {
      throw new BadRequestError('Invalid end date (must be after start date)');
    }
  }
  const finalEndDateTime = (type === BOOKING_TYPES.ROUND_TRIP) ? tripEndDate : null;
  // --- [END NEW] ---


  // Get fare details
  let fareDetails;

  try {
    // --- [MODIFIED] ---
    const options = pricingService.getVehicleOptions(type, {
      distance: estimatedDistance,
      startDateTime: tripDate,
      endDateTime: finalEndDateTime,
      includeTolls: includeTolls || false // --- [ADDED] ---
    });
    // --- [END MODIFIED] ---

    fareDetails = options.find(opt => opt.vehicleType === vehicleType)?.fareDetails;

    if (!fareDetails) {
      throw new BadRequestError(`No pricing found for ${vehicleType} with ${type}`);
    }
  } catch (pricingError) {
    logger.error('Error during fare estimation', {
      error: pricingError.message,
      type,
      vehicleType,
      distance: estimatedDistance
    });
    throw new ServiceUnavailableError(`Could not calculate fare: ${pricingError.message}`);
  }

  logger.info('Fare estimate calculated', {
    type,
    vehicleType,
    distance: estimatedDistance,
    includeTolls: includeTolls || false, // --- [ADDED] ---
    finalAmount: fareDetails.finalAmount
  });

  return sendSuccess(
    res,
    {
      fareDetails,
      distance: isLocalRental ? null : estimatedDistance,
      bookingType: type,
      vehicleType,
      estimatedFor: tripDate,
      returnDate: finalEndDateTime
    },
    'Fare estimate calculated successfully',
    200
  );
});

// ========================================
// GET CANCELLATION CHARGES
// ========================================

/**
 * @desc    Get cancellation charges for a booking
 * @route   GET /api/bookings/:id/cancellation-charges
 * @access  Private
 */
export const getCancellationCharges = catchAsync(async (req, res) => {
  const bookingId = req.params.id;

  // Validate ObjectId format
  if (!bookingId.match(/^[0-9a-fA-F]{24}$/)) {
    throw new BadRequestError('Invalid booking ID format');
  }

  const booking = await Booking.findOne({
    _id: bookingId,
    userId: req.user._id
  });

  if (!booking) {
    throw new NotFoundError('Booking not found');
  }

  // Check if booking can be cancelled
  const cancellableStatuses = [
    BOOKING_STATUS.PENDING,
    BOOKING_STATUS.CONFIRMED,
    BOOKING_STATUS.ASSIGNED
  ];

  if (!cancellableStatuses.includes(booking.status)) {
    throw new BadRequestError(
      `Booking in ${booking.status} status cannot be cancelled`
    );
  }

  if (booking.cancellation) {
    throw new ConflictError('Booking is already cancelled');
  }

  // Calculate potential cancellation charge
  const now = new Date();
  const startTime = new Date(booking.startDateTime);
  const hoursUntilStart = (startTime - now) / (1000 * 60 * 60);

  let cancellationCharge = 0;
  let chargeWillApply = false;
  let reason = '';

  if (hoursUntilStart < 0) {
    reason = 'Booking start time has passed';
    chargeWillApply = false;
  } else if (booking.status === BOOKING_STATUS.PENDING) {
    reason = 'No charge for pending bookings';
    chargeWillApply = false;
  } else if (hoursUntilStart >= BOOKING_CONFIG.CANCELLATION_WINDOW_HOURS) {
    reason = `Free cancellation available (more than ${BOOKING_CONFIG.CANCELLATION_WINDOW_HOURS} hours before start)`;
    chargeWillApply = false;
  } else {
    cancellationCharge = Math.round(
      booking.fareDetails.finalAmount * BOOKING_CONFIG.CANCELLATION_CHARGE_PERCENT
    );
    chargeWillApply = true;
    reason = `Cancellation charge applies (less than ${BOOKING_CONFIG.CANCELLATION_WINDOW_HOURS} hours before start)`;
  }

  const refundAmount = Math.max(0, booking.fareDetails.finalAmount - cancellationCharge);

  return sendSuccess(
    res,
    {
      bookingId: booking.bookingId,
      totalAmount: booking.fareDetails.finalAmount,
      cancellationCharge,
      refundAmount,
      chargeWillApply,
      reason,
      hoursUntilStart: Math.max(0, hoursUntilStart),
      cancellationPolicy: {
        windowHours: BOOKING_CONFIG.CANCELLATION_WINDOW_HOURS,
        chargePercent: BOOKING_CONFIG.CANCELLATION_CHARGE_PERCENT * 100
      }
    },
    'Cancellation charges retrieved successfully',
    200
  );
});

// ========================================
// UPDATE BOOKING STATUS (ADMIN/DRIVER)
// ========================================

/**
 * @desc    Update booking status
 * @route   PATCH /api/bookings/:id/status
 * @access  Admin/Driver
 */
export const updateBookingStatus = catchAsync(async (req, res) => {
  const { status, reason } = req.body;
  const bookingId = req.params.id;

  // Validate ObjectId format
  if (!bookingId.match(/^[0-9a-fA-F]{24}$/)) {
    throw new BadRequestError('Invalid booking ID format');
  }

  // Validate status
  if (!status) {
    throw new BadRequestError('Status is required');
  }

  if (!Object.values(BOOKING_STATUS).includes(status)) {
    throw new BadRequestError(`Invalid status: ${status}`);
  }

  const booking = await Booking.findById(bookingId)
    .populate('userId', 'deviceInfo name email phoneNumber')
    .populate({ path: 'driverId', model: 'Driver', select: 'deviceInfo name' });

  if (!booking) {
    throw new NotFoundError(`Booking with ID ${bookingId} not found`);
  }

  // Role-based authorization
  if (req.user.role === 'CUSTOMER') {
    throw new AuthorizationError(
      'Customers cannot update booking status directly. Use the /cancel endpoint'
    );
  }

  // Validate status transitions
  const currentStatus = booking.status;

  if (currentStatus === BOOKING_STATUS.COMPLETED || currentStatus === BOOKING_STATUS.CANCELLED) {
    throw new BadRequestError(
      `Booking is already in a final state (${currentStatus})`
    );
  }

  // Validate driver can only update their own bookings
  if (req.user.role === 'DRIVER') {
    if (!booking.driverId || booking.driverId._id.toString() !== req.user._id.toString()) {
      throw new AuthorizationError('You can only update bookings assigned to you');
    }
  }

  const now = new Date();

  // Handle status-specific logic
  if (status === BOOKING_STATUS.IN_PROGRESS) {
    if (!booking.trip) booking.trip = {};
    if (!booking.trip.actualStartTime) {
      booking.trip.actualStartTime = now;
      logger.info('Trip started', { bookingId: booking.bookingId });
    }
  } else if (status === BOOKING_STATUS.COMPLETED) {
    if (!booking.trip) booking.trip = {};
    if (!booking.trip.actualEndTime) {
      booking.trip.actualEndTime = now;

      // Increment driver's completed rides
      if (booking.driverId) {
        try {
          await Driver.findByIdAndUpdate(
            booking.driverId._id,
            { $inc: { completedRides: 1 } }
          );

          logger.info("Incremented driver's completed rides", {
            driverId: booking.driverId._id,
            bookingId: booking.bookingId
          });
        } catch (error) {
          logger.error('Failed to increment driver rides', {
            error: error.message,
            driverId: booking.driverId._id
          });
        }
      }

      logger.info('Trip completed', { bookingId: booking.bookingId });
    }
  } else if (status === BOOKING_STATUS.CANCELLED) {
    if (!booking.cancellation) {
      const cleanReason = reason && typeof reason === 'string'
        ? reason.trim().substring(0, 200)
        : `Cancelled by ${req.user.role}`;

      booking.cancellation = {
        cancelledBy: req.user.role,
        cancelledAt: now,
        reason: cleanReason,
        charge: 0 // Admin/Driver cancellations typically don't charge user
      };

      logger.info('Booking cancelled', {
        bookingId: booking.bookingId,
        cancelledBy: req.user.role,
        reason: cleanReason
      });
    }
  }

  // Update status
  booking.status = status;
  await booking.save();

  logger.info('Booking status updated', {
    bookingId: booking.bookingId,
    from: currentStatus,
    to: status,
    updatedBy: req.user.role
  });

  // Send notifications
  const user = booking.userId;
  if (user) {
    const statusMessages = {
      [BOOKING_STATUS.ASSIGNED]: 'A driver has been assigned to your booking',
      [BOOKING_STATUS.IN_PROGRESS]: 'Your trip has started',
      [BOOKING_STATUS.COMPLETED]: 'Your trip has been completed. Please rate your experience',
      [BOOKING_STATUS.CANCELLED]: 'Your booking has been cancelled'
    };

    const message = statusMessages[status] || `Booking status updated to ${status}`;

    await notifyUser(user, booking.bookingId, status.toLowerCase(), message);
  }

  const driver = booking.driverId;
  if (driver && status === BOOKING_STATUS.CANCELLED) {
    await notifyDriver(
      driver,
      'Booking Cancelled',
      `Booking ${booking.bookingId} has been cancelled`
    );
  }

  return sendSuccess(
    res,
    {
      bookingId: booking.bookingId,
      status: booking.status,
      previousStatus: currentStatus,
      updatedAt: booking.updatedAt,
      trip: booking.trip
    },
    'Booking status updated successfully',
    200
  );
});

// ========================================
// APPLY DISCOUNT
// ========================================

/**
 * @desc    Apply discount code to booking
 * @route   POST /api/bookings/:id/discount
 * @access  Private
 */
export const applyDiscount = catchAsync(async (req, res) => {
  const { discountCode } = req.body;
  const bookingId = req.params.id;

  // Validate discount code
  if (!discountCode || typeof discountCode !== 'string') {
    throw new BadRequestError('Discount code is required');
  }

  const cleanCode = discountCode.trim().toUpperCase();

  if (cleanCode.length < 3 || cleanCode.length > 20) {
    throw new BadRequestError('Invalid discount code format');
  }

  // Validate ObjectId format
  if (!bookingId.match(/^[0-9a-fA-F]{24}$/)) {
    throw new BadRequestError('Invalid booking ID format');
  }

  const booking = await Booking.findOne({
    _id: bookingId,
    userId: req.user._id
  }).populate('paymentId');

  if (!booking) {
    throw new NotFoundError('Booking not found');
  }

  // Validate booking status
  if (booking.status === BOOKING_STATUS.CANCELLED || booking.status === BOOKING_STATUS.COMPLETED) {
    throw new BadRequestError(
      `Cannot apply discount to ${booking.status.toLowerCase()} booking`
    );
  }

  // Check if discount already applied
  if (booking.fareDetails?.discountCode) {
    throw new ConflictError(
      `Discount code "${booking.fareDetails.discountCode}" is already applied to this booking`
    );
  }

  // Validate discount code and calculate discount
  // TODO: Implement proper discount service/database lookup
  let discountAmount = 0;
  let discountType = 'FIXED';

  if (cleanCode === 'FIRST100') {
    discountAmount = 100;
  } else if (cleanCode === 'FLAT50') {
    discountAmount = 50;
  } else if (cleanCode === 'SAVE200') {
    discountAmount = 200;
  } else {
    throw new BadRequestError('Invalid or expired discount code');
  }

  // Ensure discount doesn't exceed fare amount
  const maxDiscount = Math.floor(booking.fareDetails.finalAmount * 0.5); // Max 50% discount

  if (discountAmount > maxDiscount) {
    discountAmount = maxDiscount;
  }

  // Update fare details
  const oldFinalAmount = booking.fareDetails.finalAmount;

  booking.fareDetails.discountCode = cleanCode;
  booking.fareDetails.discountAmount = discountAmount;
  booking.fareDetails.discountType = discountType;
  booking.fareDetails.finalAmount = Math.max(0, oldFinalAmount - discountAmount);

  await booking.save();

  // Update payment document if exists
  if (booking.paymentId) {
    const payment = booking.paymentId;

    if (payment.status === PAYMENT_STATUS.PENDING) {
      payment.amount = booking.fareDetails.finalAmount;
      await payment.save();

      logger.info('Payment amount updated after discount', {
        bookingId: booking.bookingId,
        oldAmount: oldFinalAmount,
        newAmount: booking.fareDetails.finalAmount
      });
    }
  }

  logger.info('Discount applied to booking', {
    bookingId: booking.bookingId,
    discountCode: cleanCode,
    discountAmount,
    oldAmount: oldFinalAmount,
    newAmount: booking.fareDetails.finalAmount
  });

  return sendSuccess(
    res,
    {
      bookingId: booking.bookingId,
      discountCode: cleanCode,
      discountAmount,
      fareDetails: booking.fareDetails
    },
    'Discount applied successfully',
    200
  );
});

// ========================================
// GET UPCOMING BOOKINGS (DEPRECATED)
// ========================================

/**
 * @desc    Get upcoming bookings (Deprecated - use /api/user/me/bookings/upcoming)
 * @route   GET /api/bookings/upcoming
 * @access  Private
 */
export const getUpcomingBookings = catchAsync(async (req, res) => {
  logger.warn('Deprecated endpoint accessed', {
    endpoint: '/api/bookings/upcoming',
    userId: req.user._id
  });

  req.query.status = `${BOOKING_STATUS.CONFIRMED},${BOOKING_STATUS.ASSIGNED}`;
  req.query.fromDate = new Date().toISOString();
  req.query.sortBy = 'startDateTime';

  return getAllBookings(req, res);
});

// ========================================
// GET BOOKING HISTORY (DEPRECATED)
// ========================================

/**
 * @desc    Get booking history (Deprecated - use /api/user/me/bookings/past)
 * @route   GET /api/bookings/history
 * @access  Private
 */
export const getBookingHistory = catchAsync(async (req, res) => {
  logger.warn('Deprecated endpoint accessed', {
    endpoint: '/api/bookings/history',
    userId: req.user._id
  });

  req.query.status = `${BOOKING_STATUS.COMPLETED},${BOOKING_STATUS.CANCELLED}`;
  req.query.sortBy = '-startDateTime';

  return getAllBookings(req, res);
});

// ========================================
// GET BOOKING STATS (DEPRECATED)
// ========================================

/**
 * @desc    Get booking statistics (Deprecated - use /api/user/me/stats)
 * @route   GET /api/bookings/stats
 * @access  Private
 */
export const getBookingStats = catchAsync(async (req, res) => {
  logger.warn('Deprecated endpoint accessed', {
    endpoint: '/api/bookings/stats',
    userId: req.user._id
  });

  return sendSuccess(
    res,
    {
      message: 'This endpoint is deprecated. Please use /api/user/me/stats for user statistics'
    },
    'Endpoint deprecated',
    200
  );
});

// ========================================
// GET CONFIRMED BOOKINGS (ADMIN)
// ========================================

/**
 * @desc    Get all confirmed bookings (Admin only)
 * @route   GET /api/bookings/admin/confirmed
 * @access  Admin
 */
export const getConfirmedBookings = catchAsync(async (req, res) => {
  // Authorization check
  if (req.user.role !== 'ADMIN') {
    throw new AuthorizationError('Access denied. Admin only');
  }

  const { page, limit, skip } = parsePagination(req.query);
  const { sortBy = '-startDateTime', fromDate, toDate } = req.query;

  const query = {
    status: BOOKING_STATUS.CONFIRMED
  };

  // Filter by date range
  if (fromDate) {
    const fromDateObj = new Date(fromDate);
    if (!isNaN(fromDateObj.getTime())) {
      query.startDateTime = { $gte: fromDateObj };
    }
  }

  if (toDate) {
    const toDateObj = new Date(toDate);
    if (!isNaN(toDateObj.getTime())) {
      query.startDateTime = { ...query.startDateTime, $lte: toDateObj };
    }
  }

  const total = await Booking.countDocuments(query);

  const bookings = await Booking.find(query)
    .sort(sortBy)
    .skip(skip)
    .limit(limit)
    .populate('userId', 'name phoneNumber email')
    .populate('driverId', 'name phoneNumber')
    .populate('vehicleId', 'modelName licensePlate type')
    .populate('paymentId', 'status method amount')
    .select('-metadata -__v')
    .lean();

  logger.info('Admin retrieved confirmed bookings', {
    adminId: req.user._id,
    page,
    limit,
    total
  });

  return sendPaginatedResponse(
    res,
    bookings,
    page,
    limit,
    total,
    'Confirmed bookings retrieved successfully'
  );
});

// ========================================
// GET ALL BOOKINGS (ADMIN)
// ========================================

/**
 * @desc    Get all bookings with filters (Admin only)
 * @route   GET /api/bookings/admin/all
 * @access  Admin
 */
export const getAllBookingsAdmin = catchAsync(async (req, res) => {
  // Authorization check
  if (req.user.role !== 'ADMIN') {
    throw new AuthorizationError('Access denied. Admin only');
  }

  const { page, limit, skip } = parsePagination(req.query);
  const {
    status,
    bookingType,
    vehicleType,
    fromDate,
    toDate,
    userId,
    driverId,
    sortBy = '-createdAt',
    search
  } = req.query;

  const query = {};

  // Filter by status
  if (status) {
    const statuses = status
      .split(',')
      .map(s => s.trim().toUpperCase())
      .filter(s => Object.values(BOOKING_STATUS).includes(s));

    if (statuses.length > 0) {
      query.status = { $in: statuses };
    }
  }

  // Filter by booking type
  if (bookingType && Object.values(BOOKING_TYPES).includes(bookingType.toUpperCase())) {
    query.bookingType = bookingType.toUpperCase();
  }

  // Filter by vehicle type
  if (vehicleType && Object.values(VEHICLE_TYPES).includes(vehicleType.toUpperCase())) {
    query.vehicleType = vehicleType.toUpperCase();
  }

  // Filter by date range
  if (fromDate) {
    const fromDateObj = new Date(fromDate);
    if (!isNaN(fromDateObj.getTime())) {
      query.startDateTime = { $gte: fromDateObj };
    }
  }

  if (toDate) {
    const toDateObj = new Date(toDate);
    if (!isNaN(toDateObj.getTime())) {
      query.startDateTime = { ...query.startDateTime, $lte: toDateObj };
    }
  }

  // Filter by user ID
  if (userId && userId.match(/^[0-9a-fA-F]{24}$/)) {
    query.userId = userId;
  }

  // Filter by driver ID
  if (driverId && driverId.match(/^[0-9a-fA-F]{24}$/)) {
    query.driverId = driverId;
  }

  // Search by booking ID or passenger name
  if (search && typeof search === 'string') {
    const searchTerm = search.trim();
    query.$or = [
      { bookingId: { $regex: searchTerm, $options: 'i' } },
      { 'passengerDetails.name': { $regex: searchTerm, $options: 'i' } },
      { 'passengerDetails.phone': { $regex: searchTerm, $options: 'i' } }
    ];
  }

  const total = await Booking.countDocuments(query);

  const bookings = await Booking.find(query)
    .sort(sortBy)
    .skip(skip)
    .limit(limit)
    .populate('userId', 'name phoneNumber email profilePicture')
    .populate('driverId', 'name phoneNumber rating')
    .populate('vehicleId', 'modelName licensePlate type')
    .populate('paymentId', 'status method amount razorpayPaymentId')
    .lean();

  logger.info('Admin retrieved all bookings', {
    adminId: req.user._id,
    page,
    limit,
    total,
    filters: { status, bookingType, vehicleType }
  });

  return sendPaginatedResponse(
    res,
    bookings,
    page,
    limit,
    total,
    'All bookings retrieved successfully'
  );
});

// ========================================
// GET BOOKING STATISTICS (ADMIN)
// ========================================

/**
 * @desc    Get booking statistics (Admin only)
 * @route   GET /api/bookings/admin/statistics
 * @access  Admin
 */
export const getBookingStatistics = catchAsync(async (req, res) => {
  // Authorization check
  if (req.user.role !== 'ADMIN') {
    throw new AuthorizationError('Access denied. Admin only');
  }

  const { fromDate, toDate } = req.query;

  const query = {};

  // Filter by date range
  if (fromDate) {
    const fromDateObj = new Date(fromDate);
    if (!isNaN(fromDateObj.getTime())) {
      query.createdAt = { $gte: fromDateObj };
    }
  }

  if (toDate) {
    const toDateObj = new Date(toDate);
    if (!isNaN(toDateObj.getTime())) {
      query.createdAt = { ...query.createdAt, $lte: toDateObj };
    }
  }

  // Get counts by status
  const statusCounts = await Booking.aggregate([
    { $match: query },
    { $group: { _id: '$status', count: { $sum: 1 } } }
  ]);

  // Get counts by booking type
  const typeCounts = await Booking.aggregate([
    { $match: query },
    { $group: { _id: '$bookingType', count: { $sum: 1 } } }
  ]);

  // Get counts by vehicle type
  const vehicleCounts = await Booking.aggregate([
    { $match: query },
    { $group: { _id: '$vehicleType', count: { $sum: 1 } } }
  ]);

  // Get revenue statistics
  const revenueStats = await Booking.aggregate([
    {
      $match: {
        ...query,
        status: { $in: [BOOKING_STATUS.COMPLETED, BOOKING_STATUS.CONFIRMED] }
      }
    },
    {
      $group: {
        _id: null,
        totalRevenue: { $sum: '$fareDetails.finalAmount' },
        averageRevenue: { $avg: '$fareDetails.finalAmount' },
        totalBookings: { $sum: 1 }
      }
    }
  ]);

  // Get top customers
  const topCustomers = await Booking.aggregate([
    { $match: query },
    {
      $group: {
        _id: '$userId',
        bookingCount: { $sum: 1 },
        totalSpent: { $sum: '$fareDetails.finalAmount' }
      }
    },
    { $sort: { bookingCount: -1 } },
    { $limit: 10 },
    {
      $lookup: {
        from: 'users',
        localField: '_id',
        foreignField: '_id',
        as: 'userDetails'
      }
    },
    { $unwind: '$userDetails' },
    {
      $project: {
        userId: '$_id',
        name: '$userDetails.name',
        phoneNumber: '$userDetails.phoneNumber',
        bookingCount: 1,
        totalSpent: 1
      }
    }
  ]);

  logger.info('Admin retrieved booking statistics', {
    adminId: req.user._id,
    dateRange: { fromDate, toDate }
  });

  return sendSuccess(
    res,
    {
      dateRange: {
        from: fromDate || 'all time',
        to: toDate || 'now'
      },
      statusBreakdown: statusCounts,
      typeBreakdown: typeCounts,
      vehicleBreakdown: vehicleCounts,
      revenue: revenueStats[0] || { totalRevenue: 0, averageRevenue: 0, totalBookings: 0 },
      topCustomers
    },
    'Booking statistics retrieved successfully',
    200
  );
});

// ========================================
// EXPORTS
// ========================================

export default {
  // Public endpoints
  searchCabs,
  getApplicableTypes,
  getFareEstimate,

  // User endpoints
  createBooking,
  verifyBookingPayment,
  getBooking,
  getBookingByCode,
  getAllBookings,
  cancelBooking,
  addRating,
  applyDiscount,
  getCancellationCharges,

  // Deprecated endpoints
  getUpcomingBookings,
  getBookingHistory,
  getBookingStats,

  // Admin/Driver endpoints
  updateBookingStatus,
  getConfirmedBookings,
  getAllBookingsAdmin,
  getBookingStatistics
};