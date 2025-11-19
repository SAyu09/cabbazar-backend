// src/services/pricing.service.js - Logic with Min 250km/day Rule & Advance Payment
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
  OUTSTATION_SURCHARGES
} from '../config/constants.js';
import { BadRequestError } from '../utils/customError.js';
import { calculateGST, isNightTime } from '../utils/helpers.js';
import logger from '../config/logger.js';

// Minimum chargeable distance per day for outstation round trips
const MIN_OUTSTATION_KM_PER_DAY = 250;

class PricingService {
  constructor() {
    this.priceCache = new Map();
    this.cacheTimeout = 5 * 60 * 1000; // 5 minutes
    this.maxCacheSize = 1000;
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
    }, 60 * 1000);
  }

  generateCacheKey(method, params) {
    return `${method}:${JSON.stringify(params)}`;
  }

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

  setToCache(key, data) {
    this.priceCache.set(key, {
      data,
      expiry: Date.now() + this.cacheTimeout
    });
  }

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
    return Math.round(distance * 10) / 10;
  }

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
    const maxFutureDate = new Date(
      Date.now() + BOOKING_CONFIG.ADVANCE_BOOKING_DAYS * 24 * 60 * 60 * 1000
    );
    if (tripDate > maxFutureDate) {
      throw new BadRequestError(
        `Cannot book more than ${BOOKING_CONFIG.ADVANCE_BOOKING_DAYS} days in advance`
      );
    }
    const minDate = new Date(Date.now() - 60 * 60 * 1000);
    if (tripDate < minDate) {
      throw new BadRequestError('Cannot create booking for past dates');
    }
    return tripDate;
  }

  // --- Helper to calculate Advance Payment ---
  calculateAdvance(totalAmount) {
    // Use percentage from config, default to 20%
    const percentage = BOOKING_CONFIG.ADVANCE_PAYMENT_PERCENTAGE || 0.20;
    const advance = Math.round(totalAmount * percentage);
    const remaining = Math.round(totalAmount - advance);
    return { advanceAmount: advance, remainingAmount: remaining };
  }

  calculateOutstationFare(
    vehicleType,
    distance,
    isRoundTrip = false,
    startDateTime = new Date(),
    endDateTime = null,
    includeTolls = false
  ) {
    const cacheKey = this.generateCacheKey('outstation', {
      vehicleType,
      distance,
      isRoundTrip,
      date: new Date(startDateTime).toDateString(),
      endDate: endDateTime ? new Date(endDateTime).toDateString() : null,
      includeTolls
    });

    const cached = this.getFromCache(cacheKey);
    if (cached) return cached;

    try {
      const normalizedVehicleType = this.validateVehicleType(vehicleType, 'outstation');
      const validDistance = this.validateDistance(distance, 0.1, DISTANCE_CONFIG.MAX_DISTANCE, 'outstation');

      if (typeof isRoundTrip !== 'boolean') {
        throw new BadRequestError('isRoundTrip must be a boolean value');
      }

      const tripDate = this.validateDateTime(startDateTime, 'outstation');
      const rates = PRICING[normalizedVehicleType];
      if (!rates) {
        throw new BadRequestError(
          `Pricing not configured for vehicle type: ${normalizedVehicleType}`
        );
      }

      const perKmRate = isRoundTrip ? rates.perKmRateRoundTrip : rates.perKmRateOneWay;
      if (!perKmRate) {
        throw new BadRequestError(
          `Pricing not configured for ${isRoundTrip ? 'round trip' : 'one-way'} for ${normalizedVehicleType}`
        );
      }

      let finalChargeableDistance = validDistance;
      let numberOfDays = 1;
      let breakdownCalculation = '';
      let minDailyKmApplied = false;
      let actualRoundTripDistance = validDistance;

      // --- [ROUND TRIP LOGIC START] ---
      if (isRoundTrip) {
        const start = new Date(startDateTime);
        let end = start;

        if (endDateTime) {
          end = new Date(endDateTime);
          if (end < start) end = start;
        }

        // Calculate days based on 24-hour blocks
        const diffTime = Math.abs(end - start);
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        numberOfDays = diffDays > 0 ? diffDays : 1;

        // Actual distance (e.g. 231.2 * 2 = 462.4)
        actualRoundTripDistance = Math.round(validDistance * 2 * 10) / 10;

        // Min chargeable (e.g. 1 day * 250 = 250, 2 days * 250 = 500)
        const minChargeableDistance = numberOfDays * MIN_OUTSTATION_KM_PER_DAY;

        if (actualRoundTripDistance < minChargeableDistance) {
          finalChargeableDistance = minChargeableDistance;
          minDailyKmApplied = true;
          breakdownCalculation = `${numberOfDays} Day(s) × ${MIN_OUTSTATION_KM_PER_DAY} km (Min Rule) = ${finalChargeableDistance} km × ₹${perKmRate}/km`;
        } else {
          finalChargeableDistance = actualRoundTripDistance;
          breakdownCalculation = `${actualRoundTripDistance} km (Actual Round Trip) × ₹${perKmRate}/km`;
        }
      } else {
        // One-Way
        finalChargeableDistance = Math.round(validDistance * 10) / 10;
        breakdownCalculation = `${finalChargeableDistance} km × ₹${perKmRate}/km`;
        actualRoundTripDistance = finalChargeableDistance;
      }
      // --- [ROUND TRIP LOGIC END] ---

      let baseFare = finalChargeableDistance * perKmRate;

      const minFareToApply = rates.minFare;
      const minFareApplied = baseFare < minFareToApply;
      if (minFareApplied) {
        baseFare = minFareToApply;
        breakdownCalculation = `Minimum fare (₹${minFareToApply}) applied`;
      }

      let nightCharges = 0;
      const isNight = isNightTime(tripDate);
      if (isNight) {
        const nightMultiplier = rates.nightChargeMultiplier || 1.2;
        nightCharges = baseFare * (nightMultiplier - 1);
      }

      let tollCharges = 0;
      let stateTax = 0;
      if (includeTolls) {
        tollCharges = actualRoundTripDistance * (OUTSTATION_SURCHARGES.TOLL_PER_KM || 1.5);

        let statePermitKey = 'DEFAULT_STATE_PERMIT_FEE';
        if (normalizedVehicleType.includes('TRAVELLER')) {
          statePermitKey = 'STATE_PERMIT_TRAVELLER';
        } else if (normalizedVehicleType.includes('SUV')) {
          statePermitKey = 'STATE_PERMIT_SUV';
        } else if (normalizedVehicleType === 'SEDAN') {
          statePermitKey = 'STATE_PERMIT_SEDAN';
        } else if (normalizedVehicleType === 'HATCHBACK') {
          statePermitKey = 'STATE_PERMIT_HATCHBACK';
        }
        stateTax = OUTSTATION_SURCHARGES[statePermitKey] || OUTSTATION_SURCHARGES.DEFAULT_STATE_PERMIT_FEE || 450;
      }

      const subtotal = baseFare + nightCharges + tollCharges + stateTax;
      const gst = calculateGST(subtotal, TAX_CONFIG.GST_RATE);
      const totalFare = subtotal;
      const finalAmount = Math.round(subtotal + gst);

      // --- Calculate Advance Payment ---
      const { advanceAmount, remainingAmount } = this.calculateAdvance(finalAmount);

      const avgSpeed = DISTANCE_CONFIG.AVERAGE_SPEED_HIGHWAY || 60;
      const estimatedHours = (finalChargeableDistance / avgSpeed).toFixed(1);

      const inclusions = [
        'Driver allowance',
        'Fuel charges included',
        'Base fare',
        'GST included',
        isRoundTrip ? 'Return journey included' : null,
        isRoundTrip ? `Min. ${MIN_OUTSTATION_KM_PER_DAY} km/day charged` : null,
        includeTolls ? 'Toll charges included' : null,
        includeTolls ? 'State permit charges included' : null
      ].filter(Boolean);

      const exclusions = [
        includeTolls ? null : 'Toll charges (paid separately)',
        'Parking charges (if any)',
        includeTolls ? null : 'State permit charges (if applicable)',
        'Extra km beyond agreed distance'
      ].filter(Boolean);

      const fareData = {
        vehicleType: normalizedVehicleType,
        bookingType: isRoundTrip ? BOOKING_TYPES.ROUND_TRIP : BOOKING_TYPES.ONE_WAY,
        baseFare: Math.round(baseFare),
        distance: finalChargeableDistance,
        actualDistance: actualRoundTripDistance,
        numberOfDays: isRoundTrip ? numberOfDays : null,
        duration: null,
        nightCharges: Math.round(nightCharges),
        tollCharges: Math.round(tollCharges),
        stateTax: Math.round(stateTax),
        isNightTime: isNight,
        subtotal: Math.round(subtotal),
        gst: Math.round(gst),
        gstRate: `${TAX_CONFIG.GST_RATE * 100}%`,
        totalFare: Math.round(totalFare),
        finalAmount: finalAmount,
        advanceAmount,   // --- [NEW] Present in Search Response
        remainingAmount, // --- [NEW]
        perKmRate: perKmRate,
        minFareApplied,
        minDailyKmApplied,
        estimatedTravelTime: `${estimatedHours} hours`,
        validUntil: new Date(Date.now() + 60 * 60 * 1000),
        inclusions,
        exclusions,
        breakdown: {
          calculation: breakdownCalculation,
          nightCharges: nightCharges > 0 ? `Night charges (${((rates.nightChargeMultiplier || 1.2) - 1) * 100}%) = ₹${Math.round(nightCharges)}` : null,
          tollCharges: tollCharges > 0 ? `Toll charges (Est.) = ₹${Math.round(tollCharges)}` : null,
          stateTax: stateTax > 0 ? `State permit charges (Est.) = ₹${Math.round(stateTax)}` : null,
          gst: `GST (${TAX_CONFIG.GST_RATE * 100}%) = ₹${Math.round(gst)}`,
          total: `Total Amount = ₹${Math.round(finalAmount)}`,
          advance: `Advance to Pay Now (20%) = ₹${advanceAmount}`,
          remaining: `Pay to Driver = ₹${remainingAmount}`
        },
        tripDetails: {
          startTime: tripDate.toISOString(),
          endTime: endDateTime ? new Date(endDateTime).toISOString() : null,
          isRoundTrip,
          distance: finalChargeableDistance,
          estimatedDuration: estimatedHours
        }
      };

      this.setToCache(cacheKey, fareData);
      return fareData;

    } catch (error) {
      if (error instanceof BadRequestError) { throw error; }
      logger.error('Error in calculateOutstationFare', { error: error.message });
      throw new BadRequestError(`Failed to calculate outstation fare: ${error.message}`);
    }
  }

  calculateLocalPackageFare(vehicleType, packageType, extras = {}) {
    const cacheKey = this.generateCacheKey('local', { vehicleType, packageType, extras });
    const cached = this.getFromCache(cacheKey);
    if (cached) return cached;

    try {
      const normalizedVehicleType = this.validateVehicleType(vehicleType, 'local package');
      if (!packageType || typeof packageType !== 'string') {
        throw new BadRequestError('Package type is required');
      }

      const pkg = LOCAL_PACKAGES[packageType];
      if (!pkg) throw new BadRequestError(`Invalid package type: ${packageType}`);

      const vehicleKey = normalizedVehicleType.toLowerCase();
      const baseFare = pkg[vehicleKey];
      if (!baseFare) throw new BadRequestError(`Vehicle type ${normalizedVehicleType} not available for ${packageType}`);

      let extraKm = 0;
      let extraHours = 0;
      if (extras && typeof extras === 'object') {
        if (extras.extraKm !== undefined) extraKm = Math.max(0, Number(extras.extraKm));
        if (extras.extraHours !== undefined) extraHours = Math.max(0, Number(extras.extraHours));
      }

      const extraKmRate = pkg.extraKmCharge?.[vehicleKey] || 0;
      const extraHourRate = pkg.extraHourCharge?.[vehicleKey] || 0;
      const extraKmCharge = extraKm * extraKmRate;
      const extraHourCharge = extraHours * extraHourRate;

      const subtotal = baseFare + extraKmCharge + extraHourCharge;
      const gst = calculateGST(subtotal, TAX_CONFIG.GST_RATE);
      const finalAmount = Math.round(subtotal + gst);

      // --- Calculate Advance Payment ---
      const { advanceAmount, remainingAmount } = this.calculateAdvance(finalAmount);

      const fareData = {
        vehicleType: normalizedVehicleType,
        bookingType: BOOKING_TYPES.LOCAL_8_80, // Placeholder, adjusts in loop
        packageType,
        baseFare,
        packageDetails: { hours: pkg.hours, km: pkg.km, description: `${pkg.hours} hours / ${pkg.km} km package` },
        includedDistance: pkg.km,
        includedDuration: pkg.hours,
        extraKm,
        extraHours,
        extraKmCharge,
        extraHourCharge,
        subtotal,
        gst: Math.round(gst),
        gstRate: `${TAX_CONFIG.GST_RATE * 100}%`,
        totalFare: subtotal,
        finalAmount,
        advanceAmount,   // --- [NEW]
        remainingAmount, // --- [NEW]
        extraKmRate,
        extraHourRate,
        validUntil: new Date(Date.now() + 60 * 60 * 1000),
        inclusions: [`${pkg.hours} hours included`, `${pkg.km} kilometers included`, 'Fuel charges included', 'Driver allowance included', 'GST included'],
        exclusions: ['Toll charges (paid separately)', 'Parking charges (if any)', `Extra km: ₹${extraKmRate}/km`, `Extra hour: ₹${extraHourRate}/hr`],
        breakdown: {
          packageCharge: `${pkg.hours}hrs/${pkg.km}km Package = ₹${baseFare}`,
          gst: `GST (${TAX_CONFIG.GST_RATE * 100}%) = ₹${Math.round(gst)}`,
          total: `Total Amount = ₹${finalAmount}`,
          advance: `Advance to Pay Now = ₹${advanceAmount}`,
          remaining: `Pay to Driver = ₹${remainingAmount}`
        }
      };

      this.setToCache(cacheKey, fareData);
      return fareData;
    } catch (error) {
      logger.error('Error in calculateLocalPackageFare', { error: error.message });
      throw new BadRequestError(`Failed to calculate local package fare: ${error.message}`);
    }
  }

  calculateAirportFare(vehicleType, distance, startDateTime = new Date()) {
    const cacheKey = this.generateCacheKey('airport', { vehicleType, distance, date: new Date(startDateTime).toDateString() });
    const cached = this.getFromCache(cacheKey);
    if (cached) return cached;

    try {
      const normalizedVehicleType = this.validateVehicleType(vehicleType, 'airport transfer');
      const basePrice = AIRPORT_BASE_PRICE[normalizedVehicleType];
      if (!basePrice) throw new BadRequestError(`Airport transfer not configured for ${normalizedVehicleType}`);

      const validDistance = this.validateDistance(distance, 0.1, 200, 'airport transfer');
      const tripDate = this.validateDateTime(startDateTime, 'airport transfer');
      const rates = PRICING[normalizedVehicleType];

      const perKmRate = rates.perKmRateOneWay;
      const freeKm = DISTANCE_CONFIG.FREE_KM_FOR_AIRPORT || 10;
      const extraKm = Math.max(0, validDistance - freeKm);
      const extraKmCharge = extraKm * perKmRate;
      let baseFare = basePrice + extraKmCharge;

      let nightCharges = 0;
      const isNight = isNightTime(tripDate);
      if (isNight) {
        const nightMultiplier = rates.nightChargeMultiplier || 1.2;
        nightCharges = baseFare * (nightMultiplier - 1);
      }

      const subtotal = baseFare + nightCharges;
      const gst = calculateGST(subtotal, TAX_CONFIG.GST_RATE);
      const finalAmount = Math.round(subtotal + gst);

      // --- Calculate Advance Payment ---
      const { advanceAmount, remainingAmount } = this.calculateAdvance(finalAmount);

      const avgSpeed = DISTANCE_CONFIG.AVERAGE_SPEED_CITY || 30;
      const estimatedMinutes = Math.round((validDistance / avgSpeed) * 60);

      const fareData = {
        vehicleType: normalizedVehicleType,
        bookingType: BOOKING_TYPES.AIRPORT_DROP, // Placeholder
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
        finalAmount,
        advanceAmount,   // --- [NEW]
        remainingAmount, // --- [NEW]
        perKmRate: perKmRate,
        estimatedTravelTime: `${estimatedMinutes} minutes`,
        validUntil: new Date(Date.now() + 60 * 60 * 1000),
        inclusions: ['Airport pickup/drop', `First ${freeKm} km included`, 'Driver allowance', 'Fuel charges', 'GST included'],
        exclusions: ['Toll charges (paid separately)', 'Parking charges', `Extra km beyond ${freeKm} km: ₹${perKmRate}/km`],
        breakdown: {
          basePrice: `Base charge = ₹${basePrice}`,
          extraKm: extraKm > 0 ? `Extra ${Math.round(extraKm * 10) / 10} km × ₹${perKmRate} = ₹${Math.round(extraKmCharge)}` : 'No extra km',
          gst: `GST (${TAX_CONFIG.GST_RATE * 100}%) = ₹${Math.round(gst)}`,
          total: `Total Amount = ₹${finalAmount}`,
          advance: `Advance to Pay Now = ₹${advanceAmount}`,
          remaining: `Pay to Driver = ₹${remainingAmount}`
        },
        tripDetails: {
          startTime: tripDate.toISOString(),
          estimatedDuration: `${estimatedMinutes} minutes`
        }
      };

      this.setToCache(cacheKey, fareData);
      return fareData;

    } catch (error) {
      logger.error('Error in calculateAirportFare', { error: error.message });
      throw new BadRequestError(`Failed to calculate airport fare: ${error.message}`);
    }
  }

  getVehicleOptions(bookingType, params = {}) {
    try {
      const options = [];
      if (!bookingType) throw new BadRequestError('Booking type is required');
      if (!Object.values(BOOKING_TYPES).includes(bookingType)) throw new BadRequestError(`Invalid booking type: ${bookingType}`);

      const requiresDistance = [BOOKING_TYPES.ONE_WAY, BOOKING_TYPES.ROUND_TRIP, BOOKING_TYPES.AIRPORT_DROP, BOOKING_TYPES.AIRPORT_PICKUP];
      if (requiresDistance.includes(bookingType) && (params.distance === undefined || params.distance < 0)) {
        throw new BadRequestError('Valid distance is required for this booking type');
      }

      const startDateTime = params.startDateTime ? new Date(params.startDateTime) : new Date();
      const endDateTime = params.endDateTime ? new Date(params.endDateTime) : null;
      const includeTolls = params.includeTolls || false;

      Object.values(VEHICLE_TYPES).forEach(vehicleType => {
        try {
          let fareDetails;
          switch (bookingType) {
            case BOOKING_TYPES.ONE_WAY:
              fareDetails = this.calculateOutstationFare(vehicleType, params.distance, false, startDateTime, null, includeTolls);
              break;
            case BOOKING_TYPES.ROUND_TRIP:
              fareDetails = this.calculateOutstationFare(vehicleType, params.distance, true, startDateTime, endDateTime, includeTolls);
              break;
            case BOOKING_TYPES.LOCAL_2_20:
            case BOOKING_TYPES.LOCAL_4_40:
            case BOOKING_TYPES.LOCAL_8_80:
            case BOOKING_TYPES.LOCAL_12_120:
              const packageCode = bookingType.replace('LOCAL_', '');
              fareDetails = this.calculateLocalPackageFare(vehicleType, packageCode, params.extras);
              break;
            case BOOKING_TYPES.AIRPORT_DROP:
            case BOOKING_TYPES.AIRPORT_PICKUP:
              fareDetails = this.calculateAirportFare(vehicleType, params.distance, startDateTime);
              break;
          }
          options.push({
            vehicleType,
            displayName: this.getVehicleDisplayName(vehicleType),
            modelExamples: this.getVehicleModelExamples(vehicleType),
            capacity: this.getVehicleCapacity(vehicleType),
            features: this.getVehicleFeatures(vehicleType),
            fareDetails,
            recommended: vehicleType === VEHICLE_TYPES.SEDAN || (vehicleType.startsWith('SUV') && vehicleType.includes('INOVA')),
            available: true,
            description: this.getVehicleDescription(vehicleType),
            savings: vehicleType === VEHICLE_TYPES.HATCHBACK ? 'Most Economical' : null,
            bestFor: this.getBestForDescription(vehicleType)
          });
        } catch (error) {
          logger.debug(`Skipping ${vehicleType}`, { reason: error.message });
        }
      });

      if (options.length === 0) throw new BadRequestError('No vehicles available');
      options.sort((a, b) => a.fareDetails.finalAmount - b.fareDetails.finalAmount);

      // Ensure one option is recommended
      const existingRec = options.find(opt => opt.recommended);
      options.forEach(opt => opt.recommended = false);
      if (existingRec) existingRec.recommended = true;
      else if (options.length > 0) options[Math.floor(options.length / 2)].recommended = true;

      return options;
    } catch (error) {
      logger.error('Error in getVehicleOptions', { error: error.message });
      throw new BadRequestError(`Failed to get vehicle options: ${error.message}`);
    }
  }

  // ... (Helper methods like getVehicleCapacity, getVehicleFeatures etc. remain identical to previous version)
  getVehicleCapacity(vehicleType) { return VEHICLE_CAPACITY[vehicleType] || { passengers: 4, luggage: 2 }; }
  getVehicleFeatures(vehicleType) { return VEHICLE_FEATURES[vehicleType] || ['AC', 'Music System']; }
  getVehicleModelExamples(vehicleType) {
    const models = {
      [VEHICLE_TYPES.HATCHBACK]: ['Maruti Swift', 'Hyundai i20', 'Tata Altroz'],
      [VEHICLE_TYPES.SEDAN]: ['Honda City', 'Maruti Ciaz', 'Hyundai Verna'],
      [VEHICLE_TYPES.SUV_ERTIGA]: ['Maruti Ertiga', 'Renault Triber'],
      [VEHICLE_TYPES.SUV_CARENS]: ['Kia Carens', 'Mahindra Marazzo'],
      [VEHICLE_TYPES.SUV_INOVA]: ['Toyota Innova Crysta'],
      [VEHICLE_TYPES.SUV_INOVA_6_1]: ['Toyota Innova (6+1 Seater)'],
      [VEHICLE_TYPES.SUV_INOVA_7_1]: ['Toyota Innova (7+1 Seater)'],
      [VEHICLE_TYPES.SUV_INOVA_PREMIUM]: ['Toyota Innova Hycross', 'Kia Carnival'],
      [VEHICLE_TYPES.TRAVELLER_12_1]: ['Force Traveller (12 Seater)'],
      [VEHICLE_TYPES.TRAVELLER_17_1]: ['Force Traveller (17 Seater)'],
      [VEHICLE_TYPES.TRAVELLER_20_1]: ['Force Traveller (20 Seater)'],
      [VEHICLE_TYPES.TRAVELLER_26_1]: ['Force Traveller (26 Seater)'],
      [VEHICLE_TYPES.TRAVELLER_MAHARAJA_12_1]: ['Tempo Traveller Maharaja (12 Seater)'],
      [VEHICLE_TYPES.TRAVELLER_MAHARAJA_15_1]: ['Tempo Traveller Maharaja (15 Seater)'],
    };
    return models[vehicleType] || [];
  }
  getVehicleDisplayName(vehicleType) {
    const names = {
      [VEHICLE_TYPES.HATCHBACK]: 'AC Hatchback',
      [VEHICLE_TYPES.SEDAN]: 'AC Sedan',
      [VEHICLE_TYPES.SUV_ERTIGA]: 'AC SUV (Ertiga)',
      [VEHICLE_TYPES.SUV_CARENS]: 'AC SUV (Kia Carens)',
      [VEHICLE_TYPES.SUV_INOVA]: 'AC SUV (Innova)',
      [VEHICLE_TYPES.SUV_INOVA_6_1]: 'AC SUV (Innova 6+1)',
      [VEHICLE_TYPES.SUV_INOVA_7_1]: 'AC SUV (Innova 7+1)',
      [VEHICLE_TYPES.SUV_INOVA_PREMIUM]: 'Premium SUV (Innova Hycross)',
      [VEHICLE_TYPES.TRAVELLER_12_1]: 'Tempo Traveller (12+1)',
      [VEHICLE_TYPES.TRAVELLER_17_1]: 'Tempo Traveller (17+1)',
      [VEHICLE_TYPES.TRAVELLER_20_1]: 'Tempo Traveller (20+1)',
      [VEHICLE_TYPES.TRAVELLER_26_1]: 'Tempo Traveller (26+1)',
      [VEHICLE_TYPES.TRAVELLER_MAHARAJA_12_1]: 'Maharaja Traveller (12+1)',
      [VEHICLE_TYPES.TRAVELLER_MAHARAJA_15_1]: 'Maharaja Traveller (15+1)',
    };
    return names[vehicleType] || vehicleType;
  }
  getVehicleDescription(vehicleType) {
    const descriptions = {
      [VEHICLE_TYPES.HATCHBACK]: 'Economical and perfect for short trips.',
      [VEHICLE_TYPES.SEDAN]: 'Comfortable for city and outstation travel.',
      [VEHICLE_TYPES.SUV_ERTIGA]: 'Ideal for small groups, 6-seater.',
      [VEHICLE_TYPES.SUV_CARENS]: 'Modern 6-seater with comfort features.',
      [VEHICLE_TYPES.SUV_INOVA]: 'Reliable and spacious 6-seater.',
      [VEHICLE_TYPES.SUV_INOVA_6_1]: 'Spacious 6-seater Innova.',
      [VEHICLE_TYPES.SUV_INOVA_7_1]: 'Spacious 7-seater Innova.',
      [VEHICLE_TYPES.SUV_INOVA_PREMIUM]: 'Luxury SUV experience with premium amenities.',
      [VEHICLE_TYPES.TRAVELLER_12_1]: 'For medium-sized groups.',
      [VEHICLE_TYPES.TRAVELLER_17_1]: 'For large-sized groups.',
      [VEHICLE_TYPES.TRAVELLER_20_1]: 'For very large groups.',
      [VEHICLE_TYPES.TRAVELLER_26_1]: 'For extra large groups.',
      [VEHICLE_TYPES.TRAVELLER_MAHARAJA_12_1]: 'Premium comfort for medium groups.',
      [VEHICLE_TYPES.TRAVELLER_MAHARAJA_15_1]: 'Premium comfort for large groups.',
    };
    return descriptions[vehicleType] || '';
  }
  getBestForDescription(vehicleType) {
    const bestFor = {
      [VEHICLE_TYPES.HATCHBACK]: 'Solo travelers & couples',
      [VEHICLE_TYPES.SEDAN]: 'Small families & business trips',
      [VEHICLE_TYPES.SUV_ERTIGA]: 'Families (up to 6)',
      [VEHICLE_TYPES.SUV_CARENS]: 'Modern families (up to 6)',
      [VEHICLE_TYPES.SUV_INOVA]: 'Group travel (up to 6)',
      [VEHICLE_TYPES.SUV_INOVA_6_1]: 'Group travel (up to 6)',
      [VEHICLE_TYPES.SUV_INOVA_7_1]: 'Large families (up to 7)',
      [VEHICLE_TYPES.SUV_INOVA_PREMIUM]: 'VIPs & luxury seekers',
      [VEHICLE_TYPES.TRAVELLER_12_1]: 'Group tours (12 passengers)',
      [VEHICLE_TYPES.TRAVELLER_17_1]: 'Large events (17 passengers)',
      [VEHICLE_TYPES.TRAVELLER_20_1]: 'Large events (20 passengers)',
      [VEHICLE_TYPES.TRAVELLER_26_1]: 'Large events (26 passengers)',
      [VEHICLE_TYPES.TRAVELLER_MAHARAJA_12_1]: 'Luxury group travel (12 passengers)',
      [VEHICLE_TYPES.TRAVELLER_MAHARAJA_15_1]: 'Luxury group travel (15 passengers)',
    };
    return bestFor[vehicleType] || '';
  }
  calculateDistanceFromCoordinates(origin, destination) {
    // ... (Logic remains same, using Haversine)
    try {
      if (!origin || !destination) throw new BadRequestError('Coordinates required');
      const { lat: lat1, lng: lng1 } = origin;
      const { lat: lat2, lng: lng2 } = destination;
      if ([lat1, lng1, lat2, lng2].some(coord => typeof coord !== 'number')) {
        throw new BadRequestError('Coordinates must be numbers');
      }
      const R = 6371;
      const dLat = this.toRad(lat2 - lat1);
      const dLon = this.toRad(lng2 - lng1);
      const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(this.toRad(lat1)) * Math.cos(this.toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      const straightLineDistance = R * c;
      const roadDistance = straightLineDistance * 1.4;
      return Math.round(roadDistance * 10) / 10;
    } catch (error) {
      throw new BadRequestError(`Failed to calculate distance: ${error.message}`);
    }
  }
  toRad(degrees) { return degrees * (Math.PI / 180); }

  clearCache() { this.priceCache.clear(); }
  getCacheStats() { return { size: this.priceCache.size, maxSize: this.maxCacheSize, timeout: this.cacheTimeout }; }
}

export default new PricingService();