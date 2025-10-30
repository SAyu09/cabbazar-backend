// src/services/pricing.service.js - Complete Pricing Service with All Edge Cases
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
} from '../config/constants.js';
import { BadRequestError, ValidationError } from '../utils/customError.js';
import { calculateGST, isNightTime } from '../utils/helpers.js';
import logger from '../config/logger.js';

class PricingService {
  constructor() {
    this.priceCache = new Map(); // In-memory cache for pricing calculations
    this.cacheTimeout = 5 * 60 * 1000; // 5 minutes cache
  }

  /**
   * Calculate fare for outstation trips (one-way or round trip)
   * Handles all edge cases including night charges, minimum fare, validation
   */
  calculateOutstationFare(vehicleType, distance, isRoundTrip = false, startDateTime = new Date()) {
    try {
      // ========================================
      // VALIDATION - Edge Case Handling
      // ========================================
      
      // Validate vehicle type
      if (!vehicleType || typeof vehicleType !== 'string') {
        throw new BadRequestError('Vehicle type is required and must be a string');
      }

      const normalizedVehicleType = vehicleType.toUpperCase().trim();
      
      if (!Object.keys(PRICING).includes(normalizedVehicleType)) {
        throw new BadRequestError(
          `Invalid vehicle type: ${vehicleType}. Valid types: ${Object.keys(VEHICLE_TYPES).join(', ')}`
        );
      }

      // Validate distance
      if (distance === null || distance === undefined) {
        throw new BadRequestError('Distance is required');
      }

      if (typeof distance !== 'number' || isNaN(distance)) {
        throw new BadRequestError('Distance must be a valid number');
      }

      if (distance <= 0) {
        throw new BadRequestError('Distance must be greater than 0');
      }

      if (distance < DISTANCE_CONFIG.MIN_DISTANCE) {
        throw new BadRequestError(
          `Minimum distance for outstation booking is ${DISTANCE_CONFIG.MIN_DISTANCE} km. For shorter distances, use LOCAL or AIRPORT booking types.`
        );
      }

      if (distance > DISTANCE_CONFIG.MAX_DISTANCE) {
        throw new BadRequestError(
          `Maximum distance per booking is ${DISTANCE_CONFIG.MAX_DISTANCE} km. Please split your journey into multiple bookings.`
        );
      }

      // Validate round trip flag
      if (typeof isRoundTrip !== 'boolean') {
        throw new BadRequestError('isRoundTrip must be a boolean value');
      }

      // Validate start date time
      let tripDate;
      try {
        tripDate = new Date(startDateTime);
        if (isNaN(tripDate.getTime())) {
          throw new Error('Invalid date');
        }
      } catch (error) {
        throw new BadRequestError('Invalid start date/time format');
      }

      // Check if trip is in the past
      if (tripDate < new Date()) {
        // Allow a small grace period (e.g., 5 mins) for immediate bookings, but search should handle this.
        // For calculation, we'll proceed, but the controller validation should catch this.
      }

      // Check if trip is too far in future
      const maxFutureDate = new Date(Date.now() + BOOKING_CONFIG.ADVANCE_BOOKING_DAYS * 24 * 60 * 60 * 1000);
      if (tripDate > maxFutureDate) {
        throw new BadRequestError(
          `Cannot book more than ${BOOKING_CONFIG.ADVANCE_BOOKING_DAYS} days in advance`
        );
      }

      // ========================================
      // PRICING CALCULATION
      // ========================================

      const rates = PRICING[normalizedVehicleType];
      const multiplier = isRoundTrip ? 2 : 1;
      const totalDistance = Math.round(distance * multiplier * 10) / 10; // Round to 1 decimal
      
      // Calculate base fare
      let baseFare = totalDistance * rates.perKmRate;
      
      // Apply minimum fare
      const minFareToApply = isRoundTrip ? rates.minFare * 1.5 : rates.minFare;
      if (baseFare < minFareToApply) {
        baseFare = minFareToApply;
        logger.info('Minimum fare applied', {
          vehicleType: normalizedVehicleType,
          calculatedFare: totalDistance * rates.perKmRate,
          minFare: minFareToApply
        });
      }

      // Apply night charges if applicable (10 PM - 6 AM)
      let nightCharges = 0;
      const isNight = isNightTime(tripDate);
      
      if (isNight) {
        nightCharges = baseFare * (rates.nightChargeMultiplier - 1);
        logger.info('Night charges applied', { 
          vehicleType: normalizedVehicleType, 
          nightCharges: Math.round(nightCharges),
          time: tripDate.toISOString()
        });
      }

      // Calculate subtotal
      const subtotal = baseFare + nightCharges;
      
      // Calculate GST
      const gst = calculateGST(subtotal, TAX_CONFIG.GST_RATE);
      
      // Calculate total fare
      const totalFare = subtotal;
      const finalAmount = subtotal + gst;

      // Estimated travel time
      const avgSpeed = DISTANCE_CONFIG.AVERAGE_SPEED_HIGHWAY;
      const estimatedHours = (totalDistance / avgSpeed).toFixed(1);

      // ========================================
      // RESPONSE DATA
      // ========================================

      const fareData = {
        vehicleType: normalizedVehicleType,
        bookingType: isRoundTrip ? BOOKING_TYPES.ROUND_TRIP : BOOKING_TYPES.ONE_WAY,
        baseFare: Math.round(baseFare),
        distance: totalDistance,
        nightCharges: Math.round(nightCharges),
        isNightTime: isNight,
        subtotal: Math.round(subtotal),
        gst: Math.round(gst),
        gstRate: `${TAX_CONFIG.GST_RATE * 100}%`,
        totalFare: Math.round(totalFare),
        finalAmount: Math.round(finalAmount),
        perKmRate: rates.perKmRate,
        minFareApplied: baseFare === minFareToApply,
        estimatedTravelTime: `${estimatedHours} hours`,
        validUntil: new Date(Date.now() + 60 * 60 * 1000), // Valid for 1 hour
        inclusions: [
          'Driver allowance',
          'Fuel charges included',
          'Base fare',
          'GST included',
          isRoundTrip ? 'Return journey included' : null
        ].filter(Boolean),
        exclusions: [
          'Toll charges (paid separately)',
          'Parking charges (if any)',
          'State permit charges (if applicable)',
          'Extra km beyond package (if exceeded)'
        ],
        breakdown: {
          calculation: `${totalDistance} km × ₹${rates.perKmRate}/km = ₹${Math.round(baseFare)}`,
          nightCharges: nightCharges > 0 ? `Night charges (${(rates.nightChargeMultiplier - 1) * 100}%) = ₹${Math.round(nightCharges)}` : null,
          gst: `GST (${TAX_CONFIG.GST_RATE * 100}%) = ₹${Math.round(gst)}`,
          total: `Total Amount = ₹${Math.round(finalAmount)}`
        },
        tripDetails: {
          startTime: tripDate.toISOString(),
          isRoundTrip,
          distance: totalDistance,
          estimatedDuration: estimatedHours
        }
      };

      logger.info('Outstation fare calculated', {
        vehicleType: normalizedVehicleType,
        distance: totalDistance,
        isRoundTrip,
        isNight,
        finalAmount: fareData.finalAmount
      });

      return fareData;

    } catch (error) {
      logger.error('Error in calculateOutstationFare', {
        error: error.message,
        vehicleType,
        distance,
        isRoundTrip
      });
      throw error;
    }
  }

  /**
   * Calculate fare for local rental packages with extra charges handling
   */
  calculateLocalPackageFare(vehicleType, packageType, extras = {}) {
    try {
      // ========================================
      // VALIDATION
      // ========================================

      if (!vehicleType) {
        throw new BadRequestError('Vehicle type is required');
      }

      const normalizedVehicleType = vehicleType.toUpperCase().trim();
      
      if (!Object.keys(VEHICLE_TYPES).includes(normalizedVehicleType)) {
        throw new BadRequestError(`Invalid vehicle type: ${vehicleType}`);
      }

      if (!packageType) {
        throw new BadRequestError('Package type is required');
      }

      const pkg = LOCAL_PACKAGES[packageType];
      if (!pkg) {
        throw new BadRequestError(
          `Invalid package type: ${packageType}. Available packages: ${Object.keys(LOCAL_PACKAGES).join(', ')}`
        );
      }

      const vehicleKey = normalizedVehicleType.toLowerCase();
      const baseFare = pkg[vehicleKey];
      
      if (!baseFare) {
        throw new BadRequestError(
          `Vehicle type ${normalizedVehicleType} not available for package ${packageType}`
        );
      }

      // Validate extras
      let extraKm = 0;
      let extraHours = 0;

      if (extras && extras.extraKm !== undefined) {
        if (typeof extras.extraKm !== 'number' || extras.extraKm < 0) {
          throw new BadRequestError('Extra km must be a positive number');
        }
        if (extras.extraKm > 500) {
          throw new BadRequestError('Extra km cannot exceed 500 km');
        }
        extraKm = extras.extraKm;
      }
      
      if (extras && extras.extraHours !== undefined) {
        if (typeof extras.extraHours !== 'number' || extras.extraHours < 0) {
          throw new BadRequestError('Extra hours must be a positive number');
        }
        if (extras.extraHours > 12) {
          throw new BadRequestError('Extra hours cannot exceed 12 hours');
        }
        extraHours = extras.extraHours;
      }

      // ========================================
      // PRICING CALCULATION
      // ========================================

      // Calculate extra charges
      const extraKmCharge = extraKm > 0 ? extraKm * pkg.extraKmCharge[vehicleKey] : 0;
      const extraHourCharge = extraHours > 0 ? extraHours * pkg.extraHourCharge[vehicleKey] : 0;
      
      // Calculate total
      const subtotal = baseFare + extraKmCharge + extraHourCharge;
      const gst = calculateGST(subtotal, TAX_CONFIG.GST_RATE);
      const finalAmount = subtotal + gst;

      // ========================================
      // RESPONSE DATA
      // ========================================

      const fareData = {
        vehicleType: normalizedVehicleType,
        bookingType: packageType === '8_80' ? BOOKING_TYPES.LOCAL_8_80 : BOOKING_TYPES.LOCAL_12_120,
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
        extraKmRate: pkg.extraKmCharge[vehicleKey],
        extraHourRate: pkg.extraHourCharge[vehicleKey],
        validUntil: new Date(Date.now() + 60 * 60 * 1000),
        inclusions: [
          `${pkg.hours} hours included`,
          `${pkg.km} kilometers included`,
          'Fuel charges included',
          'Driver allowance included',
          'GST included',
          'Local sightseeing perfect'
        ],
        exclusions: [
          'Toll charges',
          'Parking charges',
          `Extra km: ₹${pkg.extraKmCharge[vehicleKey]}/km after ${pkg.km} km`,
          `Extra hour: ₹${pkg.extraHourCharge[vehicleKey]}/hr after ${pkg.hours} hours`,
          'Interstate travel charges (if applicable)'
        ],
        breakdown: {
          packageCharge: `${pkg.hours}hrs/${pkg.km}km Package = ₹${baseFare}`,
          extraKm: extraKmCharge > 0 
            ? `Extra ${extraKm} km × ₹${pkg.extraKmCharge[vehicleKey]} = ₹${Math.round(extraKmCharge)}` 
            : null,
          extraHour: extraHourCharge > 0 
            ? `Extra ${extraHours} hrs × ₹${pkg.extraHourCharge[vehicleKey]} = ₹${Math.round(extraHourCharge)}` 
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

      return fareData;

    } catch (error) {
      logger.error('Error in calculateLocalPackageFare', {
        error: error.message,
        vehicleType,
        packageType
      });
      throw error;
    }
  }

  /**
   * Calculate fare for airport transfers with distance-based pricing
   */
  calculateAirportFare(vehicleType, distance, startDateTime = new Date()) {
    try {
      // ========================================
      // VALIDATION
      // ========================================

      if (!vehicleType) {
        throw new BadRequestError('Vehicle type is required');
      }

      const normalizedVehicleType = vehicleType.toUpperCase().trim();
      
      const basePrice = AIRPORT_BASE_PRICE[normalizedVehicleType];
      if (!basePrice) {
        throw new BadRequestError(
          `Invalid vehicle type: ${vehicleType}. Available: ${Object.keys(AIRPORT_BASE_PRICE).join(', ')}`
        );
      }

      if (!distance || typeof distance !== 'number' || distance <= 0) {
        throw new BadRequestError('Distance must be a positive number');
      }

      if (distance > 200) {
        throw new BadRequestError('Airport transfers are only for distances up to 200 km. Use outstation booking for longer distances.');
      }

      // Validate date
      let tripDate;
      try {
        tripDate = new Date(startDateTime);
        if (isNaN(tripDate.getTime())) {
          throw new Error('Invalid date');
        }
      } catch (error) {
        throw new BadRequestError('Invalid start date/time');
      }

      // ========================================
      // PRICING CALCULATION
      // ========================================

      const freeKm = DISTANCE_CONFIG.FREE_KM_FOR_AIRPORT;
      const extraKm = Math.max(0, distance - freeKm);
      const extraKmCharge = extraKm * PRICING[normalizedVehicleType].perKmRate;
      
      // Base fare calculation
      let baseFare = basePrice + extraKmCharge;

      // Apply night charges if applicable
      let nightCharges = 0;
      const isNight = isNightTime(tripDate);
      
      if (isNight) {
        nightCharges = baseFare * (PRICING[normalizedVehicleType].nightChargeMultiplier - 1);
      }

      // Calculate total
      const subtotal = baseFare + nightCharges;
      const gst = calculateGST(subtotal, TAX_CONFIG.GST_RATE);
      const finalAmount = subtotal + gst;

      // Estimated travel time
      const estimatedMinutes = Math.round((distance / DISTANCE_CONFIG.AVERAGE_SPEED_CITY) * 60);

      // ========================================
      // RESPONSE DATA
      // ========================================

      const fareData = {
        vehicleType: normalizedVehicleType,
        bookingType: 'AIRPORT_TRANSFER',
        baseFare: Math.round(baseFare),
        basePrice,
        distance: Math.round(distance * 10) / 10,
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
        perKmRate: PRICING[normalizedVehicleType].perKmRate,
        estimatedTravelTime: `${estimatedMinutes} minutes`,
        validUntil: new Date(Date.now() + 60 * 60 * 1000),
        inclusions: [
          'Airport pickup/drop',
          `First ${freeKm} km included`,
          'Driver allowance',
          'Fuel charges',
          'GST included',
          'Meet & Greet service'
        ],
        exclusions: [
          'Toll charges (paid separately)',
          'Parking charges at airport',
          `Extra km beyond ${freeKm} km: ₹${PRICING[normalizedVehicleType].perKmRate}/km`,
          'Waiting charges after 30 minutes'
        ],
        breakdown: {
          basePrice: `Base charge = ₹${basePrice}`,
          freeKm: `First ${freeKm} km included`,
          extraKm: extraKm > 0 
            ? `Extra ${Math.round(extraKm * 10) / 10} km × ₹${PRICING[normalizedVehicleType].perKmRate} = ₹${Math.round(extraKmCharge)}` 
            : 'No extra km',
          nightCharges: nightCharges > 0 
            ? `Night charges (${(PRICING[normalizedVehicleType].nightChargeMultiplier - 1) * 100}%) = ₹${Math.round(nightCharges)}` 
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
        distance,
        isNight,
        finalAmount: fareData.finalAmount
      });

      return fareData;

    } catch (error) {
      logger.error('Error in calculateAirportFare', {
        error: error.message,
        vehicleType,
        distance
      });
      throw error;
    }
  }

  /**
   * Get all vehicle options with complete pricing for a booking type
   * Handles all booking types and returns sorted results
   */
  getVehicleOptions(bookingType, params) {
    try {
      const options = [];

      // Validate booking type
      if (!Object.values(BOOKING_TYPES).includes(bookingType)) {
        throw new BadRequestError(
          `Invalid booking type: ${bookingType}. Valid types: ${Object.values(BOOKING_TYPES).join(', ')}`
        );
      }

      // Validate parameters based on booking type
      const requiresDistance = [
        BOOKING_TYPES.ONE_WAY,
        BOOKING_TYPES.ROUND_TRIP,
        BOOKING_TYPES.AIRPORT_DROP,
        BOOKING_TYPES.AIRPORT_PICKUP
      ];

      if (requiresDistance.includes(bookingType)) {
        if (!params.distance || params.distance <= 0) {
          throw new BadRequestError('Distance is required and must be greater than 0 for this booking type');
        }
      }

      const startDateTime = params.startDateTime ? new Date(params.startDateTime) : new Date();

      // Calculate fares for all vehicle types
      Object.values(VEHICLE_TYPES).forEach(vehicleType => {
        try {
          let fareDetails;

          switch (bookingType) {
            case BOOKING_TYPES.ONE_WAY:
              fareDetails = this.calculateOutstationFare(vehicleType, params.distance, false, startDateTime);
              break;

            case BOOKING_TYPES.ROUND_TRIP:
              fareDetails = this.calculateOutstationFare(vehicleType, params.distance, true, startDateTime);
              break;

            case BOOKING_TYPES.LOCAL_8_80:
              fareDetails = this.calculateLocalPackageFare(vehicleType, '8_80', params.extras);
              break;

            case BOOKING_TYPES.LOCAL_12_120:
              fareDetails = this.calculateLocalPackageFare(vehicleType, '12_120', params.extras);
              break;

            case BOOKING_TYPES.AIRPORT_DROP:
            case BOOKING_TYPES.AIRPORT_PICKUP:
              fareDetails = this.calculateAirportFare(vehicleType, params.distance, startDateTime);
              break;

            default:
              logger.warn(`Unsupported booking type: ${bookingType}`);
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
            recommended: vehicleType === 'SEDAN',
            available: true,
            description: this.getVehicleDescription(vehicleType),
            savings: vehicleType === 'HATCHBACK' ? 'Most Economical' : null,
            bestFor: this.getBestForDescription(vehicleType)
          });

        } catch (error) {
          logger.debug(`Skipping ${vehicleType} for ${bookingType}: ${error.message}`);
        }
      });

      if (options.length === 0) {
        throw new BadRequestError('No vehicles available for the selected booking type and parameters');
      }

      // Sort by price (ascending)
      options.sort((a, b) => a.fareDetails.finalAmount - b.fareDetails.finalAmount);

      logger.info('Vehicle options generated', {
        bookingType,
        optionsCount: options.length,
        params
      });

      return options;

    } catch (error) {
      logger.error('Error in getVehicleOptions', {
        error: error.message,
        bookingType,
        params
      });
      throw error;
    }
  }

  // Helper methods
  getVehicleCapacity(vehicleType) {
    return VEHICLE_CAPACITY[vehicleType] || { passengers: 4, luggage: 2 };
  }

  getVehicleFeatures(vehicleType) {
    return VEHICLE_FEATURES[vehicleType] || ['AC', 'Music System'];
  }

  getVehicleModelExamples(vehicleType) {
    const models = {
      HATCHBACK: ['Maruti Swift', 'Hyundai i20', 'Maruti Baleno', 'Tata Altroz'],
      SEDAN: ['Honda City', 'Hyundai Verna', 'Maruti Ciaz', 'Honda Amaze', 'Volkswagen Vento'],
      SUV: ['Toyota Innova Crysta', 'Maruti Ertiga', 'Mahindra XUV500', 'Kia Carens', 'MG Hector'],
      PREMIUM_SEDAN: ['Honda Accord', 'Toyota Camry', 'Skoda Superb', 'BMW 3 Series', 'Mercedes C-Class']
    };
    return models[vehicleType] || [];
  }

  getVehicleDisplayName(vehicleType) {
    const names = {
      HATCHBACK: 'AC Hatchback',
      SEDAN: 'AC Sedan',
      SUV: 'AC SUV / MUV',
      PREMIUM_SEDAN: 'Premium Sedan'
    };
    return names[vehicleType] || vehicleType;
  }

  getVehicleDescription(vehicleType) {
    const descriptions = {
      HATCHBACK: 'Comfortable and economical for short trips and city rides',
      SEDAN: 'Perfect blend of comfort and affordability for city and outstation trips',
      SUV: 'Spacious and comfortable for families, groups, and long journeys',
      PREMIUM_SEDAN: 'Luxury travel experience with premium comfort and amenities'
    };
    return descriptions[vehicleType] || '';
  }

  getBestForDescription(vehicleType) {
    const bestFor = {
      HATCHBACK: 'Solo travelers & couples',
      SEDAN: 'Small families & business travel',
      SUV: 'Large families & group travel',
      PREMIUM_SEDAN: 'Luxury seekers & VIP travel'
    };
    return bestFor[vehicleType] || '';
  }

  /**
   * Calculate distance using coordinates (Haversine formula)
   * Returns distance in kilometers
   */
  calculateDistanceFromCoordinates(origin, destination) {
    try {
      if (!origin || !destination) {
        throw new BadRequestError('Origin and destination coordinates are required');
      }

      if (typeof origin.lat !== 'number' || typeof origin.lng !== 'number' ||
          typeof destination.lat !== 'number' || typeof destination.lng !== 'number') {
        logger.warn('Invalid coordinate format received', { origin, destination });
        throw new BadRequestError('Invalid coordinate format. Required: {lat, lng} with number values');
      }

      const R = 6371; // Earth's radius in km
      const dLat = this.toRad(destination.lat - origin.lat);
      const dLon = this.toRad(destination.lng - origin.lng);
      
      const a = 
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(this.toRad(origin.lat)) * Math.cos(this.toRad(destination.lat)) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
      
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      const distance = R * c;
      
      // MODIFIED: Add 40% for actual road distance (approximation)
      // This is a more realistic multiplier for road networks vs. straight-line.
      const roadDistance = distance * 1.4; 
      
      return Math.round(roadDistance * 10) / 10;
    } catch (error) {
      logger.error('Error calculating distance', { 
        error: error.message,
        origin,
        destination
      });
      // Re-throw as a known error type if it's not already
      if (error instanceof BadRequestError) {
        throw error;
      }
      throw new BadRequestError(`Failed to calculate distance: ${error.message}`);
    }
  }

  toRad(degrees) {
    return degrees * (Math.PI / 180);
  }

  /**
   * Validate fare calculation parameters
   */
  validateFareParams(bookingType, params) {
    const errors = [];

    if (!Object.values(BOOKING_TYPES).includes(bookingType)) {
      errors.push('Invalid booking type');
    }

    const requiresDistance = [
      BOOKING_TYPES.ONE_WAY,
      BOOKING_TYPES.ROUND_TRIP,
      BOOKING_TYPES.AIRPORT_DROP,
      BOOKING_TYPES.AIRPORT_PICKUP
    ];

    if (requiresDistance.includes(bookingType)) {
      if (!params.distance || params.distance <= 0) {
        errors.push('Distance is required and must be greater than 0');
      }
      if (params.distance && params.distance > DISTANCE_CONFIG.MAX_DISTANCE) {
        errors.push(`Distance cannot exceed ${DISTANCE_CONFIG.MAX_DISTANCE} km`);
      }
    }

    if (params.startDateTime) {
      const date = new Date(params.startDateTime);
      if (isNaN(date.getTime())) {
        errors.push('Invalid start date/time');
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }
}

export default new PricingService();
