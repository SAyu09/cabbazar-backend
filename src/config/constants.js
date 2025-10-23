// Environment
const ENV = {
  DEVELOPMENT: 'development',
  PRODUCTION: 'production',
  TEST: 'test'
};

// HTTP Status Codes
const STATUS_CODES = {
  OK: 200,
  CREATED: 201,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INTERNAL_SERVER: 500
};

// Response Messages
const MESSAGES = {
  SUCCESS: 'Success',
  FAILED: 'Failed',
  UNAUTHORIZED: 'Unauthorized access',
  INVALID_CREDENTIALS: 'Invalid credentials',
  NOT_FOUND: 'Resource not found',
  SERVER_ERROR: 'Internal server error',
  VALIDATION_ERROR: 'Validation error'
};

// JWT Configuration
const JWT = {
  SECRET: process.env.JWT_SECRET || 'your-secret-key',
  EXPIRES_IN: '24h'
};

// Database Configuration
const DATABASE = {
  URL: process.env.MONGODB_URL || 'mongodb://localhost:27017/cabbazar',
  OPTIONS: {
    useNewUrlParser: true,
    useUnifiedTopology: true
  }
};

// Pagination defaults
const PAGINATION = {
  DEFAULT_PAGE: 1,
  DEFAULT_LIMIT: 10
};

// User Roles
const USER_ROLES = {
  ADMIN: 'admin',
  DRIVER: 'driver',
  PASSENGER: 'passenger'
};

// Ride Status
const RIDE_STATUS = {
  PENDING: 'pending',
  ACCEPTED: 'accepted',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled'
};

// Pricing Configuration
const PRICING = {
  HATCHBACK: {
    perKmRate: 12,
    minFare: 300,
    nightChargeMultiplier: 1.2
  },
  SEDAN: {
    perKmRate: 14,
    minFare: 350,
    nightChargeMultiplier: 1.2
  },
  SUV: {
    perKmRate: 18,
    minFare: 450,
    nightChargeMultiplier: 1.2
  },
  PREMIUM_SEDAN: {
    perKmRate: 22,
    minFare: 550,
    nightChargeMultiplier: 1.2
  }
};

// Local Package Configuration
const LOCAL_PACKAGES = {
  '8_80': {
    hours: 8,
    km: 80,
    hatchback: 1299,
    sedan: 1499,
    suv: 1899,
    premium_sedan: 2499,
    extraKmCharge: {
      hatchback: 12,
      sedan: 14,
      suv: 18,
      premium_sedan: 22
    },
    extraHourCharge: {
      hatchback: 150,
      sedan: 175,
      suv: 200,
      premium_sedan: 250
    }
  },
  '12_120': {
    hours: 12,
    km: 120,
    hatchback: 1799,
    sedan: 1999,
    suv: 2499,
    premium_sedan: 3299,
    extraKmCharge: {
      hatchback: 12,
      sedan: 14,
      suv: 18,
      premium_sedan: 22
    },
    extraHourCharge: {
      hatchback: 150,
      sedan: 175,
      suv: 200,
      premium_sedan: 250
    }
  }
};

// Airport Transfer Base Prices
const AIRPORT_BASE_PRICE = {
  HATCHBACK: 499,
  SEDAN: 599,
  SUV: 799,
  PREMIUM_SEDAN: 999
};

// Booking Types
const BOOKING_TYPES = {
  ONE_WAY: 'ONE_WAY',
  ROUND_TRIP: 'ROUND_TRIP',
  LOCAL_8_80: 'LOCAL_8_80',
  LOCAL_12_120: 'LOCAL_12_120',
  AIRPORT_PICKUP: 'AIRPORT_PICKUP',
  AIRPORT_DROP: 'AIRPORT_DROP'
};

// Vehicle Types
const VEHICLE_TYPES = {
  HATCHBACK: 'HATCHBACK',
  SEDAN: 'SEDAN',
  SUV: 'SUV',
  PREMIUM_SEDAN: 'PREMIUM_SEDAN'
};

// Tax Configuration
const TAX_CONFIG = {
  GST_RATE: 5 // 5% GST
};

// Vehicle Capacity Configuration
const VEHICLE_CAPACITY = {
  HATCHBACK: { passengers: 4, luggage: 2 },
  SEDAN: { passengers: 4, luggage: 3 },
  SUV: { passengers: 6, luggage: 4 },
  PREMIUM_SEDAN: { passengers: 4, luggage: 3 }
};

// Vehicle Features
const VEHICLE_FEATURES = {
  HATCHBACK: ['AC', 'Music System', 'Central Locking'],
  SEDAN: ['AC', 'Music System', 'Central Locking', 'Power Windows'],
  SUV: ['AC', 'Music System', 'Central Locking', 'Power Windows', 'Extra Space'],
  PREMIUM_SEDAN: ['AC', 'Premium Music System', 'Leather Seats', 'Premium Interior']
};

// Distance Configuration
const DISTANCE_CONFIG = {
  MIN_DISTANCE: 50, // Minimum distance for outstation
  MAX_DISTANCE: 2000, // Maximum distance per booking
  FREE_KM_FOR_AIRPORT: 10 // Free km included in airport transfers
};

// Booking Configuration
const BOOKING_CONFIG = {
  CANCELLATION_WINDOW_HOURS: 24,
  CANCELLATION_CHARGE_PERCENT: 20,
  ADVANCE_BOOKING_HOURS: 2
};

module.exports = {
  ENV,
  STATUS_CODES,
  MESSAGES,
  JWT,
  DATABASE,
  PAGINATION,
  USER_ROLES,
  RIDE_STATUS,
  PRICING,
  LOCAL_PACKAGES,
  AIRPORT_BASE_PRICE,
  BOOKING_TYPES,
  VEHICLE_TYPES,
  TAX_CONFIG,
  VEHICLE_CAPACITY,
  VEHICLE_FEATURES,
  DISTANCE_CONFIG,
  BOOKING_CONFIG
};
