// src/services/pricing.service.js - UPDATED with Toll/Tax Logic
import {
  PRICING,
  LOCAL_PACKAGES,
  AIRPORT_BASE_PRICE,
  BOOKING_TYPES,
  VEHICLE_TYPES,
  TAX_CONFIG,
  VEHICLE_CAPACITY,
  VEHICLE_FEATURES,
  DISTANCE_CONFIG,
  BOOKING_CONFIG,
  OUTSTATION_SURCHARGES // --- [NEW] ---
} from '../config/constants.js';
import { BadRequestError } from '../utils/customError.js';
import { calculateGST, isNightTime } from '../utils/helpers.js';
import logger from '../config/logger.js';

// --- [NEW] ---
// This constant defines the minimum KMs charged per day for a multi-day round trip.
// It's placed here because constants.js was not requested for update.
const MIN_OUTSTATION_KM_PER_DAY = DISTANCE_CONFIG.MIN_OUTSTATION_KM_PER_DAY || 50;
// --- [END NEW] ---


class PricingService {
  constructor() {
    this.priceCache = new Map();
    this.cacheTimeout = 5 * 60 * 1000; // 5 minutes
    this.maxCacheSize = 1000;

    // Start cache cleanup interval
    this.startCacheCleanup();
  }

  /**
   * Periodic cache cleanup to prevent memory leaks
   */
  startCacheCleanup() {
    setInterval(() => {
      const now = Date.now();
      let cleanedCount = 0;

      for (const [key, value] of this.priceCache.entries()) {
        if (value.expiry < now) {
          this.priceCache.delete(key);
          cleanedCount++;
        }
      }

      // If cache is too large, remove oldest entries
      if (this.priceCache.size > this.maxCacheSize) {
        const entriesToRemove = this.priceCache.size - this.maxCacheSize;
        const entries = Array.from(this.priceCache.entries());
        entries.sort((a, b) => a[1].expiry - b[1].expiry);

        for (let i = 0; i < entriesToRemove; i++) {
          this.priceCache.delete(entries[i][0]);
          cleanedCount++;
        }
      }

      if (cleanedCount > 0) {
        logger.debug('Price cache cleaned', {
          cleanedEntries: cleanedCount,
          remainingEntries: this.priceCache.size
        });
      }
    }, 60 * 1000); // Run every minute
  }

  /**
   * Generate cache key
   */
  generateCacheKey(method, params) {
    return `${method}:${JSON.stringify(params)}`;
  }

  /**
   * Get from cache
   */
  getFromCache(key) {
    const cached = this.priceCache.get(key);
    if (cached && cached.expiry > Date.now()) {
      logger.debug('Price cache HIT', { key });
      return cached.data;
    }
    if (cached) {
      this.priceCache.delete(key);
    }
    return null;
  }

  /**
   * Set to cache
   */
  setToCache(key, data) {
    this.priceCache.set(key, {
      data,
      expiry: Date.now() + this.cacheTimeout
    });
  }

  /**
   * Validate vehicle type
   */
  validateVehicleType(vehicleType, context = '') {
    if (!vehicleType || typeof vehicleType !== 'string') {
      throw new BadRequestError(
        `Vehicle type is required and must be a string${context ? ` (${context})` : ''}`
      );
    }

    const normalized = vehicleType.toUpperCase().trim();

    if (!Object.values(VEHICLE_TYPES).includes(normalized)) {
      throw new BadRequestError(
        `Invalid vehicle type: ${vehicleType}. Valid types: ${Object.values(VEHICLE_TYPES).join(', ')}`
      );
    }

    return normalized;
  }

  /**
   * Validate distance
   */
  validateDistance(distance, min = 0, max = DISTANCE_CONFIG.MAX_DISTANCE, context = '') {
    if (distance === null || distance === undefined) {
      throw new BadRequestError(`Distance is required${context ? ` (${context})` : ''}`);
    }

    if (typeof distance !== 'number' || isNaN(distance)) {
      throw new BadRequestError(`Distance must be a valid number${context ? ` (${context})` : ''}`);
    }

    if (distance < min) {
      throw new BadRequestError(
        `Distance must be at least ${min} km${context ? ` (${context})` : ''}`
      );
    }

    if (distance > max) {
      throw new BadRequestError(
        `Maximum distance is ${max} km${context ? ` (${context})` : ''}`
      );
    }

    return Math.round(distance * 10) / 10; // Round to 1 decimal
  }

  /**
   * Validate and parse date
   */
  validateDateTime(startDateTime, context = '') {
    let tripDate;

    try {
      tripDate = new Date(startDateTime);
      if (isNaN(tripDate.getTime())) {
        throw new Error('Invalid date');
      }
    } catch (error) {
      throw new BadRequestError(`Invalid date/time format${context ? ` (${context})` : ''}`);
    }

    // Check if date is too far in the future
    const maxFutureDate = new Date(
      Date.now() + BOOKING_CONFIG.ADVANCE_BOOKING_DAYS * 24 * 60 * 60 * 1000
    );

    if (tripDate > maxFutureDate) {
      throw new BadRequestError(
        `Cannot book more than ${BOOKING_CONFIG.ADVANCE_BOOKING_DAYS} days in advance`
      );
    }

    // Check if date is in the past (with 1 hour buffer for testing)
    const minDate = new Date(Date.now() - 60 * 60 * 1000);
    if (tripDate < minDate) {
      throw new BadRequestError('Cannot create booking for past dates');
    }

    return tripDate;
  }

  /**
   * Calculate fare for outstation trips (one-way or round trip)
   * UPDATED: Now supports multi-day round trip and toll/tax logic
   */
  calculateOutstationFare(
    vehicleType,
    distance,
    isRoundTrip = false,
    startDateTime = new Date(),
    endDateTime = null, // --- [MODIFIED] ---
    includeTolls = false // --- [NEW] ---
  ) {
    const cacheKey = this.generateCacheKey('outstation', {
      vehicleType,
      distance,
      isRoundTrip,
      date: new Date(startDateTime).toDateString(),
      endDate: endDateTime ? new Date(endDateTime).toDateString() : null,
      includeTolls // --- [NEW] ---
    });

    const cached = this.getFromCache(cacheKey);
    if (cached) return cached;

    try {
      // Validation
      const normalizedVehicleType = this.validateVehicleType(vehicleType, 'outstation');
      const validDistance = this.validateDistance(distance, 0.1, DISTANCE_CONFIG.MAX_DISTANCE, 'outstation');

      if (typeof isRoundTrip !== 'boolean') {
        throw new BadRequestError('isRoundTrip must be a boolean value');
      }

      const tripDate = this.validateDateTime(startDateTime, 'outstation');

      // Check if vehicle type has pricing configured
      const rates = PRICING[normalizedVehicleType];
      if (!rates) {
        throw new BadRequestError(
          `Pricing not configured for vehicle type: ${normalizedVehicleType}`
        );
      }

      // ========================================
      // PRICING CALCULATION
      // ========================================

      // --- [MODIFIED] Round Trip Logic ---
      let totalDistance;
      let numberOfDays = 1;
      let breakdownCalculation;

      if (isRoundTrip) {
        // 1. Calculate actual round trip distance
        const actualRoundTripDistance = Math.round(validDistance * 2 * 10) / 10;

        // 2. Calculate number of calendar days
        const start = new Date(startDateTime);
        // If no end date or end date is before start, assume 1 day
        const end = (endDateTime && new Date(endDateTime) > start) ? new Date(endDateTime) : new Date(startDateTime);

        const msPerDay = 1000 * 60 * 60 * 24;
        const utcStart = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate());
        const utcEnd = Date.UTC(end.getFullYear(), end.getMonth(), end.getDate());

        // +1 to include both start and end dates
        numberOfDays = Math.max(1, ((utcEnd - utcStart) / msPerDay) + 1);

        // 3. Calculate minimum distance based on days
        const minKmByDays = numberOfDays * MIN_OUTSTATION_KM_PER_DAY;

        // 4. Final distance is the MAX of (actual) or (daily minimum)
        totalDistance = Math.max(actualRoundTripDistance, minKmByDays);

        if (totalDistance > actualRoundTripDistance) {
          breakdownCalculation = `${numberOfDays} day(s) × ${MIN_OUTSTATION_KM_PER_DAY} km/day = ${totalDistance} km (Minimum daily charge applied)`;
        } else {
          breakdownCalculation = `${actualRoundTripDistance} km (Actual round trip) × ₹${rates.perKmRate}/km`;
        }

      } else {
        // One-way logic (unchanged)
        totalDistance = Math.round(validDistance * 10) / 10;
        breakdownCalculation = `${totalDistance} km × ₹${rates.perKmRate}/km`;
      }
      // --- [END MODIFIED] ---

      let baseFare = totalDistance * rates.perKmRate;

      // --- [MODIFIED] Min fare logic simplified ---
      // The daily km rule replaces the old 1.5x multiplier for min fare.
      // We just ensure the fare is not below the absolute minimum fare.
      const minFareToApply = rates.minFare;

      const minFareApplied = baseFare < minFareToApply;
      if (minFareApplied) {
        baseFare = minFareToApply;
        breakdownCalculation = `Minimum fare applied = ₹${Math.round(baseFare)}`;
      }

      // Night charges
      let nightCharges = 0;
      const isNight = isNightTime(tripDate);

      if (isNight) {
        const nightMultiplier = rates.nightChargeMultiplier || 1.2;
        nightCharges = baseFare * (nightMultiplier - 1);
      }

      // --- [NEW] Toll & Tax Logic ---
      let tollCharges = 0;
      let stateTax = 0;

      if (includeTolls) {
        tollCharges = totalDistance * (OUTSTATION_SURCHARGES.TOLL_PER_KM || 1.5);
        stateTax = OUTSTATION_SURCHARGES[`STATE_PERMIT_${normalizedVehicleType}`] ||
          OUTSTATION_SURCHARGES.DEFAULT_STATE_PERMIT_FEE ||
          500;
      }
      // --- [END NEW] ---

      // Calculate totals
      const subtotal = baseFare + nightCharges + tollCharges + stateTax; // --- [MODIFIED] ---
      const gst = calculateGST(subtotal, TAX_CONFIG.GST_RATE);
      const totalFare = subtotal;
      const finalAmount = subtotal + gst;

      // Estimated travel time
      const avgSpeed = DISTANCE_CONFIG.AVERAGE_SPEED_HIGHWAY || 60;
      const estimatedHours = (totalDistance / avgSpeed).toFixed(1);

      // --- [NEW] Dynamic Inclusions/Exclusions ---
      const inclusions = [
        'Driver allowance',
        'Fuel charges included',
        'Base fare',
        'GST included',
        isRoundTrip ? 'Return journey included' : null,
        isRoundTrip ? `Min. ${MIN_OUTSTATION_KM_PER_DAY} km/day charge` : null,
        includeTolls ? 'Toll charges included' : null,
        includeTolls ? 'State permit charges included' : null
      ].filter(Boolean);

      const exclusions = [
        includeTolls ? null : 'Toll charges (paid separately)',
        'Parking charges (if any)',
        includeTolls ? null : 'State permit charges (if applicable)',
        'Extra km beyond agreed distance'
      ].filter(Boolean);
      // --- [END NEW] ---


      // Build response
      const fareData = {
        vehicleType: normalizedVehicleType,
        bookingType: isRoundTrip ? BOOKING_TYPES.ROUND_TRIP : BOOKING_TYPES.ONE_WAY,
        baseFare: Math.round(baseFare),
        distance: totalDistance,
        numberOfDays: isRoundTrip ? numberOfDays : null, // --- [NEW] ---
        duration: null,
        nightCharges: Math.round(nightCharges),
        tollCharges: Math.round(tollCharges), // --- [NEW] ---
        stateTax: Math.round(stateTax), // --- [NEW] ---
        isNightTime: isNight,
        subtotal: Math.round(subtotal),
        gst: Math.round(gst),
        gstRate: `${TAX_CONFIG.GST_RATE * 100}%`,
        totalFare: Math.round(totalFare),
        finalAmount: Math.round(finalAmount),
        perKmRate: rates.perKmRate,
        minFareApplied,
        estimatedTravelTime: `${estimatedHours} hours`,
        validUntil: new Date(Date.now() + 60 * 60 * 1000),
        inclusions, // --- [MODIFIED] ---
        exclusions, // --- [MODIFIED] ---
        breakdown: {
          calculation: breakdownCalculation.includes('Minimum fare applied')
            ? breakdownCalculation
            : `${breakdownCalculation} = ₹${Math.round(baseFare)}`, // --- [MODIFIED] ---
          nightCharges: nightCharges > 0
            ? `Night charges (${((rates.nightChargeMultiplier || 1.2) - 1) * 100}%) = ₹${Math.round(nightCharges)}`
            : null,
          tollCharges: tollCharges > 0 // --- [NEW] ---
            ? `Toll charges (Est.) = ₹${Math.round(tollCharges)}`
            : null,
          stateTax: stateTax > 0 // --- [NEW] ---
            ? `State permit charges (Est.) = ₹${Math.round(stateTax)}`
            : null,
          gst: `GST (${TAX_CONFIG.GST_RATE * 100}%) = ₹${Math.round(gst)}`,
          total: `Total Amount = ₹${Math.round(finalAmount)}`
        },
        tripDetails: {
          startTime: tripDate.toISOString(),
          endTime: endDateTime ? new Date(endDateTime).toISOString() : null, // --- [NEW] ---
          isRoundTrip,
          distance: totalDistance,
          estimatedDuration: estimatedHours
        }
      };

      logger.info('Outstation fare calculated', {
        vehicleType: normalizedVehicleType,
        distance: totalDistance,
        isRoundTrip,
        numberOfDays, // --- [NEW] ---
        includeTolls, // --- [NEW] ---
        isNight,
        minFareApplied,
        finalAmount: fareData.finalAmount
      });

      this.setToCache(cacheKey, fareData);
      return fareData;

    } catch (error) {
      if (error instanceof BadRequestError) {
        throw error;
      }

      logger.error('Error in calculateOutstationFare', {
        error: error.message,
        stack: error.stack,
        vehicleType,
        distance,
        isRoundTrip
      });

      throw new BadRequestError(`Failed to calculate outstation fare: ${error.message}`);
    }
  }

  /**
   * Calculate fare for local rental packages
   */
  calculateLocalPackageFare(vehicleType, packageType, extras = {}) {
    const cacheKey = this.generateCacheKey('local', {
      vehicleType,
      packageType,
      extras
    });

    const cached = this.getFromCache(cacheKey);
    if (cached) return cached;

    try {
      // Validation
      const normalizedVehicleType = this.validateVehicleType(vehicleType, 'local package');

      if (!packageType || typeof packageType !== 'string') {
        throw new BadRequestError('Package type (e.g., "8_80") is required');
      }

      const pkg = LOCAL_PACKAGES[packageType];
      if (!pkg) {
        throw new BadRequestError(
          `Invalid package type: ${packageType}. Valid types: ${Object.keys(LOCAL_PACKAGES).join(', ')}`
        );
      }

      const vehicleKey = normalizedVehicleType.toLowerCase();
      const baseFare = pkg[vehicleKey];

      if (!baseFare || typeof baseFare !== 'number') {
        throw new BadRequestError(
          `Vehicle type ${normalizedVehicleType} not available for package ${packageType}`
        );
      }

      // Validate extras
      let extraKm = 0;
      let extraHours = 0;

      if (extras && typeof extras === 'object') {
        if (extras.extraKm !== undefined) {
          if (typeof extras.extraKm !== 'number' || extras.extraKm < 0) {
            throw new BadRequestError('Extra km must be a non-negative number');
          }
          if (extras.extraKm > 500) {
            throw new BadRequestError('Extra km cannot exceed 500 km');
          }
          extraKm = Math.round(extras.extraKm * 10) / 10;
        }

        if (extras.extraHours !== undefined) {
          if (typeof extras.extraHours !== 'number' || extras.extraHours < 0) {
            throw new BadRequestError('Extra hours must be a non-negative number');
          }
          if (extras.extraHours > 24) {
            throw new BadRequestError('Extra hours cannot exceed 24 hours');
          }
          extraHours = Math.round(extras.extraHours * 10) / 10;
        }
      }

      // Pricing calculation
      const extraKmRate = pkg.extraKmCharge?.[vehicleKey] || 0;
      const extraHourRate = pkg.extraHourCharge?.[vehicleKey] || 0;

      if (!extraKmRate || !extraHourRate) {
        throw new BadRequestError(
          `Extra charges not configured for ${normalizedVehicleType} in package ${packageType}`
        );
      }

      const extraKmCharge = extraKm > 0 ? extraKm * extraKmRate : 0;
      const extraHourCharge = extraHours > 0 ? extraHours * extraHourRate : 0;

      const subtotal = baseFare + extraKmCharge + extraHourCharge;
      const gst = calculateGST(subtotal, TAX_CONFIG.GST_RATE);
      const finalAmount = subtotal + gst;

      // Map package type to booking type
      const bookingTypeMap = {
        '2_20': BOOKING_TYPES.LOCAL_2_20,
        '4_40': BOOKING_TYPES.LOCAL_4_40,
        '8_80': BOOKING_TYPES.LOCAL_8_80,
        '12_120': BOOKING_TYPES.LOCAL_12_120
      };

      // Build response
      const fareData = {
        vehicleType: normalizedVehicleType,
        bookingType: bookingTypeMap[packageType] || BOOKING_TYPES.LOCAL_8_80,
        packageType,
        baseFare,
        packageDetails: {
          hours: pkg.hours,
          km: pkg.km,
          description: `${pkg.hours} hours / ${pkg.km} km package`
        },
        includedDistance: pkg.km,
        includedDuration: pkg.hours,
        extraKm: Math.round(extraKm * 10) / 10,
        extraHours: Math.round(extraHours * 10) / 10,
        extraKmCharge: Math.round(extraKmCharge),
        extraHourCharge: Math.round(extraHourCharge),
        subtotal: Math.round(subtotal),
        gst: Math.round(gst),
        gstRate: `${TAX_CONFIG.GST_RATE * 100}%`,
        totalFare: Math.round(subtotal),
        finalAmount: Math.round(finalAmount),
        extraKmRate,
        extraHourRate,
        validUntil: new Date(Date.now() + 60 * 60 * 1000),
        inclusions: [
          `${pkg.hours} hours included`,
          `${pkg.km} kilometers included`,
          'Fuel charges included',
          'Driver allowance included',
          'GST included',
          'Perfect for local sightseeing'
        ],
        exclusions: [
          'Toll charges (paid separately)',
          'Parking charges (if any)',
          `Extra km: ₹${extraKmRate}/km after ${pkg.km} km`,
          `Extra hour: ₹${extraHourRate}/hr after ${pkg.hours} hours`,
          'Interstate travel charges (if applicable)'
        ],
        breakdown: {
          packageCharge: `${pkg.hours}hrs/${pkg.km}km Package = ₹${baseFare}`,
          extraKm: extraKmCharge > 0
            ? `Extra ${extraKm} km × ₹${extraKmRate} = ₹${Math.round(extraKmCharge)}`
            : null,
          extraHour: extraHourCharge > 0
            ? `Extra ${extraHours} hrs × ₹${extraHourRate} = ₹${Math.round(extraHourCharge)}`
            : null,
          gst: `GST (${TAX_CONFIG.GST_RATE * 100}%) = ₹${Math.round(gst)}`,
          total: `Total Amount = ₹${Math.round(finalAmount)}`
        }
      };

      logger.info('Local package fare calculated', {
        vehicleType: normalizedVehicleType,
        packageType,
        extraKm,
        extraHours,
        finalAmount: fareData.finalAmount
      });

      this.setToCache(cacheKey, fareData);
      return fareData;

    } catch (error) {
      if (error instanceof BadRequestError) {
        throw error;
      }

      logger.error('Error in calculateLocalPackageFare', {
        error: error.message,
        stack: error.stack,
        vehicleType,
        packageType,
        extras
      });

      throw new BadRequestError(`Failed to calculate local package fare: ${error.message}`);
    }
  }

  /**
   * Calculate fare for airport transfers
   */
  calculateAirportFare(vehicleType, distance, startDateTime = new Date()) {
    const cacheKey = this.generateCacheKey('airport', {
      vehicleType,
      distance,
      date: new Date(startDateTime).toDateString()
    });

    const cached = this.getFromCache(cacheKey);
    if (cached) return cached;

    try {
      // Validation
      const normalizedVehicleType = this.validateVehicleType(vehicleType, 'airport transfer');

      const basePrice = AIRPORT_BASE_PRICE[normalizedVehicleType];
      if (!basePrice || typeof basePrice !== 'number') {
        throw new BadRequestError(
          `Airport transfer not configured for vehicle type: ${normalizedVehicleType}`
        );
      }

      const validDistance = this.validateDistance(distance, 0.1, 200, 'airport transfer');
      const tripDate = this.validateDateTime(startDateTime, 'airport transfer');

      // Check if vehicle has pricing configured
      const rates = PRICING[normalizedVehicleType];
      if (!rates) {
        throw new BadRequestError(
          `Pricing not configured for vehicle type: ${normalizedVehicleType}`
        );
      }

      // Pricing calculation
      const freeKm = DISTANCE_CONFIG.FREE_KM_FOR_AIRPORT || 10;
      const extraKm = Math.max(0, validDistance - freeKm);
      const extraKmCharge = extraKm * rates.perKmRate;
      let baseFare = basePrice + extraKmCharge;

      // Night charges
      let nightCharges = 0;
      const isNight = isNightTime(tripDate);

      if (isNight) {
        const nightMultiplier = rates.nightChargeMultiplier || 1.2;
        nightCharges = baseFare * (nightMultiplier - 1);
      }

      // Calculate totals
      const subtotal = baseFare + nightCharges;
      const gst = calculateGST(subtotal, TAX_CONFIG.GST_RATE);
      const finalAmount = subtotal + gst;

      // Estimated travel time
      const avgSpeed = DISTANCE_CONFIG.AVERAGE_SPEED_CITY || 30;
      const estimatedMinutes = Math.round((validDistance / avgSpeed) * 60);

      // Build response
      const fareData = {
        vehicleType: normalizedVehicleType,
        bookingType: 'AIRPORT_TRANSFER',
        baseFare: Math.round(baseFare),
        basePrice,
        distance: Math.round(validDistance * 10) / 10,
        freeKmIncluded: freeKm,
        extraKm: Math.round(extraKm * 10) / 10,
        extraKmCharge: Math.round(extraKmCharge),
        nightCharges: Math.round(nightCharges),
        isNightTime: isNight,
        subtotal: Math.round(subtotal),
        gst: Math.round(gst),
        gstRate: `${TAX_CONFIG.GST_RATE * 100}%`,
        totalFare: Math.round(subtotal),
        finalAmount: Math.round(finalAmount),
        perKmRate: rates.perKmRate,
        estimatedTravelTime: `${estimatedMinutes} minutes`,
        validUntil: new Date(Date.now() + 60 * 60 * 1000),
        inclusions: [
          'Airport pickup/drop',
          `First ${freeKm} km included`,
          'Driver allowance',
          'Fuel charges',
          'GST included',
          'Meet & Greet service',
          'Flight tracking'
        ],
        exclusions: [
          'Toll charges (paid separately)',
          'Parking charges at airport',
          `Extra km beyond ${freeKm} km: ₹${rates.perKmRate}/km`,
          'Waiting charges after 30 minutes'
        ],
        breakdown: {
          basePrice: `Base charge = ₹${basePrice}`,
          freeKm: `First ${freeKm} km included`,
          extraKm: extraKm > 0
            ? `Extra ${Math.round(extraKm * 10) / 10} km × ₹${rates.perKmRate} = ₹${Math.round(extraKmCharge)}`
            : 'No extra km',
          nightCharges: nightCharges > 0
            ? `Night charges (${((rates.nightChargeMultiplier || 1.2) - 1) * 100}%) = ₹${Math.round(nightCharges)}`
            : null,
          gst: `GST (${TAX_CONFIG.GST_RATE * 100}%) = ₹${Math.round(gst)}`,
          total: `Total Amount = ₹${Math.round(finalAmount)}`
        },
        tripDetails: {
          startTime: tripDate.toISOString(),
          estimatedDuration: `${estimatedMinutes} minutes`
        }
      };

      logger.info('Airport fare calculated', {
        vehicleType: normalizedVehicleType,
        distance: validDistance,
        isNight,
        finalAmount: fareData.finalAmount
      });

      this.setToCache(cacheKey, fareData);
      return fareData;

    } catch (error) {
      if (error instanceof BadRequestError) {
        throw error;
      }

      logger.error('Error in calculateAirportFare', {
        error: error.message,
        stack: error.stack,
        vehicleType,
        distance
      });

      throw new BadRequestError(`Failed to calculate airport fare: ${error.message}`);
    }
  }

  /**
   * Get all vehicle options with complete pricing
   */
  getVehicleOptions(bookingType, params = {}) {
    try {
      const options = [];

      // Validate booking type
      if (!bookingType || typeof bookingType !== 'string') {
        throw new BadRequestError('Booking type is required');
      }

      if (!Object.values(BOOKING_TYPES).includes(bookingType)) {
        throw new BadRequestError(
          `Invalid booking type: ${bookingType}. Valid types: ${Object.values(BOOKING_TYPES).join(', ')}`
        );
      }

      // Distance required types
      const requiresDistance = [
        BOOKING_TYPES.ONE_WAY,
        BOOKING_TYPES.ROUND_TRIP,
        BOOKING_TYPES.AIRPORT_DROP,
        BOOKING_TYPES.AIRPORT_PICKUP
      ];

      if (requiresDistance.includes(bookingType)) {
        if (!params.distance || typeof params.distance !== 'number' || params.distance <= 0) {
          throw new BadRequestError(
            'Distance is required and must be greater than 0 for this booking type'
          );
        }
      }

      const startDateTime = params.startDateTime
        ? new Date(params.startDateTime)
        : new Date();

      const endDateTime = params.endDateTime ? new Date(params.endDateTime) : null; // --- [MODIFIED] ---

      // --- [NEW] ---
      const includeTolls = params.includeTolls || false;
      // --- [END NEW] ---

      // Calculate fares for all vehicle types
      Object.values(VEHICLE_TYPES).forEach(vehicleType => {
        try {
          let fareDetails;

          switch (bookingType) {
            case BOOKING_TYPES.ONE_WAY:
              fareDetails = this.calculateOutstationFare(
                vehicleType,
                params.distance,
                false,
                startDateTime,
                null, // --- [MODIFIED] ---
                includeTolls // --- [NEW] ---
              );
              break;

            case BOOKING_TYPES.ROUND_TRIP:
              fareDetails = this.calculateOutstationFare(
                vehicleType,
                params.distance,
                true,
                startDateTime,
                endDateTime,
                includeTolls 
              );
              break;

            case BOOKING_TYPES.LOCAL_2_20:
              fareDetails = this.calculateLocalPackageFare(
                vehicleType,
                '2_20',
                params.extras
              );
              break;

            case BOOKING_TYPES.LOCAL_4_40:
              fareDetails = this.calculateLocalPackageFare(
                vehicleType,
                '4_40',
                params.extras
              );
              break;

            case BOOKING_TYPES.LOCAL_8_80:
              fareDetails = this.calculateLocalPackageFare(
                vehicleType,
                '8_80',
                params.extras
              );
              break;

            case BOOKING_TYPES.LOCAL_12_120:
              fareDetails = this.calculateLocalPackageFare(
                vehicleType,
                '12_120',
                params.extras
              );
              break;

            case BOOKING_TYPES.AIRPORT_DROP:
            case BOOKING_TYPES.AIRPORT_PICKUP:
              fareDetails = this.calculateAirportFare(
                vehicleType,
                params.distance,
                startDateTime
              );
              break;

            default:
              logger.warn(`Unsupported booking type for pricing: ${bookingType}`);
              return;
          }

          // Add complete vehicle option
          options.push({
            vehicleType,
            displayName: this.getVehicleDisplayName(vehicleType),
            modelExamples: this.getVehicleModelExamples(vehicleType),
            capacity: this.getVehicleCapacity(vehicleType),
            features: this.getVehicleFeatures(vehicleType),
            fareDetails,
            recommended: vehicleType === VEHICLE_TYPES.SEDAN,
            available: true,
            description: this.getVehicleDescription(vehicleType),
            savings: vehicleType === VEHICLE_TYPES.HATCHBACK ? 'Most Economical' : null,
            bestFor: this.getBestForDescription(vehicleType)
          });

        } catch (error) {
          logger.debug(`Skipping ${vehicleType} for ${bookingType}`, {
            reason: error.message
          });
        }
      });

      if (options.length === 0) {
        throw new BadRequestError(
          'No vehicles available for the selected booking type and parameters'
        );
      }

      // Sort by price (ascending)
      options.sort((a, b) => a.fareDetails.finalAmount - b.fareDetails.finalAmount);

      logger.info('Vehicle options generated', {
        bookingType,
        includeTolls, // --- [NEW] ---
        optionsCount: options.length,
        distance: params.distance || 'N/A'
      });

      return options;

    } catch (error) {
      if (error instanceof BadRequestError) {
        throw error;
      }

      logger.error('Error in getVehicleOptions', {
        error: error.message,
        stack: error.stack,
        bookingType,
        params
      });

      throw new BadRequestError(`Failed to get vehicle options: ${error.message}`);
    }
  }

  /**
   * Calculate distance from coordinates using Haversine formula
   */
  calculateDistanceFromCoordinates(origin, destination) {
    try {
      // Validate input
      if (!origin || !destination) {
        throw new BadRequestError('Both origin and destination coordinates are required');
      }

      if (typeof origin !== 'object' || typeof destination !== 'object') {
        throw new BadRequestError('Coordinates must be objects with lat and lng properties');
      }

      const { lat: lat1, lng: lng1 } = origin;
      const { lat: lat2, lng: lng2 } = destination;

      // Validate coordinate values
      if (
        typeof lat1 !== 'number' || typeof lng1 !== 'number' ||
        typeof lat2 !== 'number' || typeof lng2 !== 'number'
      ) {
        throw new BadRequestError('Latitude and longitude must be numbers');
      }

      if (lat1 < -90 || lat1 > 90 || lat2 < -90 || lat2 > 90) {
        throw new BadRequestError('Latitude must be between -90 and 90 degrees');
      }

      if (lng1 < -180 || lng1 > 180 || lng2 < -180 || lng2 > 180) {
        throw new BadRequestError('Longitude must be between -180 and 180 degrees');
      }

      // Haversine formula
      const R = 6371; // Earth's radius in km
      const dLat = this.toRad(lat2 - lat1);
      const dLon = this.toRad(lng2 - lng1);

      const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(this.toRad(lat1)) * Math.cos(this.toRad(lat2)) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);

      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      const straightLineDistance = R * c;

      // Apply road distance multiplier (roads are not straight lines)
      const roadMultiplier = 1.4; // 40% longer for actual road distance
      const roadDistance = straightLineDistance * roadMultiplier;

      const finalDistance = Math.round(roadDistance * 10) / 10;

      logger.debug('Distance calculated from coordinates', {
        origin,
        destination,
        straightLineDistance: Math.round(straightLineDistance * 10) / 10,
        roadDistance: finalDistance
      });

      return finalDistance;

    } catch (error) {
      if (error instanceof BadRequestError) {
        throw error;
      }

      logger.error('Error calculating distance from coordinates', {
        error: error.message,
        stack: error.stack,
        origin,
        destination
      });

      throw new BadRequestError(`Failed to calculate distance: ${error.message}`);
    }
  }

  /**
   * Convert degrees to radians
   */
  toRad(degrees) {
    if (typeof degrees !== 'number' || isNaN(degrees)) {
      throw new BadRequestError('Degrees must be a valid number');
    }
    return degrees * (Math.PI / 180);
  }

  // ========================================
  // HELPER METHODS
  // ========================================

  getVehicleCapacity(vehicleType) {
    const capacity = VEHICLE_CAPACITY[vehicleType];
    if (!capacity) {
      logger.warn(`Capacity not configured for vehicle type: ${vehicleType}`);
      return { passengers: 4, luggage: 2 };
    }
    return capacity;
  }

  getVehicleFeatures(vehicleType) {
    const features = VEHICLE_FEATURES[vehicleType];
    if (!features || !Array.isArray(features)) {
      logger.warn(`Features not configured for vehicle type: ${vehicleType}`);
      return ['AC', 'Music System'];
    }
    return features;
  }

  getVehicleModelExamples(vehicleType) {
    const models = {
      [VEHICLE_TYPES.HATCHBACK]: ['Maruti Swift', 'Hyundai i20', 'Tata Altroz'],
      [VEHICLE_TYPES.SEDAN]: ['Honda City', 'Maruti Ciaz', 'Hyundai Verna'],
      [VEHICLE_TYPES.SUV]: ['Toyota Innova', 'Maruti Ertiga', 'Mahindra Scorpio'],
      [VEHICLE_TYPES.PREMIUM_SEDAN]: ['Honda Accord', 'Toyota Camry', 'BMW 3 Series']
    };
    return models[vehicleType] || [];
  }

  getVehicleDisplayName(vehicleType) {
    const names = {
      [VEHICLE_TYPES.HATCHBACK]: 'AC Hatchback',
      [VEHICLE_TYPES.SEDAN]: 'AC Sedan',
      [VEHICLE_TYPES.SUV]: 'AC SUV / MUV',
      [VEHICLE_TYPES.PREMIUM_SEDAN]: 'Premium Sedan'
    };
    return names[vehicleType] || vehicleType;
  }

  getVehicleDescription(vehicleType) {
    const descriptions = {
      [VEHICLE_TYPES.HATCHBACK]: 'Economical and perfect for short trips',
      [VEHICLE_TYPES.SEDAN]: 'Comfortable for city and outstation travel',
      [VEHICLE_TYPES.SUV]: 'Spacious and ideal for families and groups',
      [VEHICLE_TYPES.PREMIUM_SEDAN]: 'Luxury travel experience with premium amenities'
    };
    return descriptions[vehicleType] || '';
  }

  getBestForDescription(vehicleType) {
    const bestFor = {
      [VEHICLE_TYPES.HATCHBACK]: 'Solo travelers & couples',
      [VEHICLE_TYPES.SEDAN]: 'Small families & business trips',
      [VEHICLE_TYPES.SUV]: 'Large families & group travel',
      [VEHICLE_TYPES.PREMIUM_SEDAN]: 'Luxury seekers & VIP travel'
    };
    return bestFor[vehicleType] || '';
  }

  /**
   * Clear cache (useful for testing or manual refresh)
   */
  clearCache() {
    const size = this.priceCache.size;
    this.priceCache.clear();
    logger.info('Price cache cleared', { clearedEntries: size });
  }

  /**
   * Get cache statistics
   */
  getCacheStats() {
    return {
      size: this.priceCache.size,
      maxSize: this.maxCacheSize,
      timeout: this.cacheTimeout
    };
  }
}

export default new PricingService();