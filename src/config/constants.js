// src/config/constants.js - Complete Application Constants (with 4 Local Packages)
// Environment
export const ENV = {
  DEVELOPMENT: 'development',
  PRODUCTION: 'production',
  TEST: 'test'
};
// HTTP Status Codes
export const STATUS_CODES = {
  OK: 200,
  CREATED: 201,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_SERVER: 500
};
// Response Messages
export const MESSAGES = {
  SUCCESS: 'Success',
  FAILED: 'Failed',
  UNAUTHORIZED: 'Unauthorized access',
  INVALID_CREDENTIALS: 'Invalid credentials',
  NOT_FOUND: 'Resource not found',
  SERVER_ERROR: 'Internal server error',
  VALIDATION_ERROR: 'Validation error'
};
// JWT Configuration
export const JWT = {
  SECRET: process.env.JWT_SECRET || 'your-secret-key-change-in-production',
  EXPIRES_IN: process.env.JWT_EXPIRE || '30d'
};
// Database Configuration
export const DATABASE = {
  URL: process.env.MONGODB_URL || 'mongodb://localhost:27017/cabbazar',
  OPTIONS: {
    useNewUrlParser: true,
    useUnifiedTopology: true
  }
};
// Pagination Defaults
export const PAGINATION = {
  DEFAULT_PAGE: 1,
  DEFAULT_LIMIT: 10,
  MAX_LIMIT: 100
};
// User Roles
export const USER_ROLES = {
  ADMIN: 'ADMIN',
  DRIVER: 'DRIVER',
  CUSTOMER: 'CUSTOMER'
};
// Booking Status
export const BOOKING_STATUS = {
  PENDING: 'PENDING',
  CONFIRMED: 'CONFIRMED',
  ASSIGNED: 'ASSIGNED',
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
  REJECTED: 'REJECTED'
};
// Payment Status
export const PAYMENT_STATUS = {
  PENDING: 'PENDING',
  PROCESSING: 'PROCESSING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  REFUNDED: 'REFUNDED',
  PARTIALLY_REFUNDED: 'PARTIALLY_REFUNDED'
};
// Payment Methods
export const PAYMENT_METHODS = {
  CASH: 'CASH',
  UPI: 'UPI',
  CARD: 'CARD',
  WALLET: 'WALLET',
  NET_BANKING: 'NET_BANKING'
};
// Pricing Configuration
export const PRICING = {
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
// Local Package Configuration (UPDATED with 4 packages)
export const LOCAL_PACKAGES = {
  '2_20': {
    hours: 2,
    km: 20,
    hatchback: 599,
    sedan: 699,
    suv: 899,
    premium_sedan: 1199,
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
  '4_40': { // NAYA PACKAGE
    hours: 4,
    km: 40,
    hatchback: 899,
    sedan: 999,
    suv: 1299,
    premium_sedan: 1799,
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
export const AIRPORT_BASE_PRICE = {
  HATCHBACK: 499,
  SEDAN: 599,
  SUV: 799,
  PREMIUM_SEDAN: 999
};
// Booking Types (UPDATED with 4 packages)
export const BOOKING_TYPES = {
  ONE_WAY: 'ONE_WAY',
  ROUND_TRIP: 'ROUND_TRIP',
  LOCAL_2_20: 'LOCAL_2_20',
  LOCAL_4_40: 'LOCAL_4_40',
  LOCAL_8_80: 'LOCAL_8_80',
  LOCAL_12_120: 'LOCAL_12_120',
  AIRPORT_PICKUP: 'AIRPORT_PICKUP',
  AIRPORT_DROP: 'AIRPORT_DROP'
};
// Vehicle Types
export const VEHICLE_TYPES = {
  HATCHBACK: 'HATCHBACK',
  SEDAN: 'SEDAN',
  SUV: 'SUV',
  PREMIUM_SEDAN: 'PREMIUM_SEDAN'
};
// Tax Configuration
export const TAX_CONFIG = {
  GST_RATE: 0.05 // 5% GST
};

// --- [NEW] ---
// Outstation Surcharges (Estimates)
// These are estimates for tolls, state permits, etc.
// In a real app, this should come from a route API (like Google)
export const OUTSTATION_SURCHARGES = {
  TOLL_PER_KM: 1.5, // Estimated ₹1.5 per km for tolls
  STATE_PERMIT_HATCHBACK: 300,
  STATE_PERMIT_SEDAN: 400,
  STATE_PERMIT_SUV: 500,
  STATE_PERMIT_PREMIUM_SEDAN: 600,
  DEFAULT_STATE_PERMIT_FEE: 450 // Fallback
};
// --- [END NEW] ---

// --- [NEW] ADD-ON SERVICES ---
export const ADD_ON_SERVICES = {
  LUGGAGE: {
    name: 'Assured luggage space',
    price: 105,
  },
  PET: {
    name: 'Pet Allowed',
    price: 840,
  },
  REFUNDABLE: {
    name: 'Upgrade to Refundable booking',
    price: 58,
  },
  NEW_CAR: {
    name: 'Confirmed Car Model 2022 or above',
    price: 420,
  },
  DRIVER_LANG: {
    name: 'Preferred Driver language',
    price: 315,
  }
};
// --- [END NEW] ---

// Vehicle Capacity Configuration
export const VEHICLE_CAPACITY = {
  HATCHBACK: { passengers: 4, luggage: 2 },
  SEDAN: { passengers: 4, luggage: 3 },
  SUV: { passengers: 6, luggage: 4 },
  PREMIUM_SEDAN: { passengers: 4, luggage: 3 }
};
// Vehicle Features
export const VEHICLE_FEATURES = {
  HATCHBACK: ['AC', 'Music System', 'Central Locking'],
  SEDAN: ['AC', 'Music System', 'Central Locking', 'Power Windows'],
  SUV: ['AC', 'Music System', 'Central Locking', 'Power Windows', 'Extra Space'],
  PREMIUM_SEDAN: ['AC', 'Premium Music System', 'Leather Seats', 'Premium Interior']
};
// Distance Configuration
// Distance Configuration
export const DISTANCE_CONFIG = {
  MIN_DISTANCE: 50,
  MAX_DISTANCE: 2000,
  MIN_OUTSTATION_KM_PER_DAY: 50,
  FREE_KM_FOR_AIRPORT: 10,
  AVERAGE_SPEED_HIGHWAY: 60, // km/h
  AVERAGE_SPEED_CITY: 30 // km/h
};

export const BOOKING_CONFIG = {
  CANCELLATION_WINDOW_HOURS: 24,
  CANCELLATION_CHARGE_PERCENT: 0.20,
  MIN_BOOKING_HOURS_AHEAD: 2,
  ADVANCE_BOOKING_DAYS: 30,
  DRIVER_ACCEPTANCE_TIMEOUT_MINUTES: 5,
  MAX_BOOKING_PER_DAY: 10
};
// OTP Configuration
export const OTP_CONFIG = {
  EXPIRY_MINUTES: Number(process.env.OTP_EXPIRY_MINUTES) || 10,
  MAX_ATTEMPTS: Number(process.env.OTP_MAX_ATTEMPTS) || 3,
  RESEND_TIMEOUT_SECONDS: Number(process.env.OTP_RESEND_TIMEOUT_SECONDS) || 60,
  LENGTH: 6
};
// Notification Types
export const NOTIFICATION_TYPES = {
  BOOKING_CREATED: 'BOOKING_CREATED',
  BOOKING_CONFIRMED: 'BOOKING_CONFIRMED',
  BOOKING_CANCELLED: 'BOOKING_CANCELLED',
  DRIVER_ASSIGNED: 'DRIVER_ASSIGNED',
  DRIVER_ARRIVED: 'DRIVER_ARRIVED',
  TRIP_STARTED: 'TRIP_STARTED',
  TRIP_COMPLETED: 'TRIP_COMPLETED',
  PAYMENT_RECEIVED: 'PAYMENT_RECEIVED',
  OTP_SENT: 'OTP_SENT',
  RATING_RECEIVED: 'RATING_RECEIVED',
  ADMIN_ALERT: 'ADMIN_ALERT' // --- [NEW] ---
};
// Socket Events
export const SOCKET_EVENTS = {
  // Connection
  CONNECTION: 'connection',
  DISCONNECT: 'disconnect',
  // User Events
  USER_JOINED: 'user:joined',
  USER_LEFT: 'user:left',
  // Booking Events
  BOOKING_CREATED: 'booking:created',
  BOOKING_REQUEST: 'booking:request',
  BOOKING_ACCEPTED: 'booking:accepted',
  BOOKING_REJECTED: 'booking:rejected',
  BOOKING_CANCELLED: 'booking:cancelled',
  BOOKING_UPDATED: 'booking:updated',
  // Trip Events
  TRIP_STARTED: 'trip:started',
  TRIP_UPDATED: 'trip:updated',
  TRIP_COMPLETED: 'trip:completed',
  // Driver Events
  DRIVER_LOCATION: 'driver:location',
  DRIVER_STATUS: 'driver:status',
  DRIVER_ARRIVED: 'driver:arrived',
  // Chat Events
  MESSAGE_SENT: 'message:sent',
  MESSAGE_RECEIVED: 'message:received',
  TYPING: 'typing'
};
// File Upload Configuration
export const UPLOAD_CONFIG = {
  MAX_FILE_SIZE: 5 * 1024 * 1024, // 5MB
  ALLOWED_IMAGE_TYPES: ['image/jpeg', 'image/png', 'image/jpg'],
  ALLOWED_DOCUMENT_TYPES: ['application/pdf', 'image/jpeg', 'image/png']
};
// Rate Limiting Configuration
export const RATE_LIMIT = {
  WINDOW_MS: 15 * 60 * 1000, // 15 minutes
  MAX_REQUESTS: 100,
  OTP_MAX_REQUESTS: 3,
  OTP_WINDOW_MS: 60 * 60 * 1000 // 1 hour
};
// Default Values
export const DEFAULTS = {
  LANGUAGE: 'en',
  CURRENCY: 'INR',
  COUNTRY: 'India',
  TIMEZONE: 'Asia/Kolkata'
};
export default {
  ENV,
  STATUS_CODES,
  MESSAGES,
  JWT,
  DATABASE,
  PAGINATION,
  USER_ROLES,
  BOOKING_STATUS,
  PAYMENT_STATUS,
  PAYMENT_METHODS,
  PRICING,
  LOCAL_PACKAGES,
  AIRPORT_BASE_PRICE,
  BOOKING_TYPES,
  VEHICLE_TYPES,
  TAX_CONFIG,
  OUTSTATION_SURCHARGES, // --- [NEW] ---
  ADD_ON_SERVICES, // --- [NEW] ---
  VEHICLE_CAPACITY,
  VEHICLE_FEATURES,
  DISTANCE_CONFIG,
  BOOKING_CONFIG,
  OTP_CONFIG,
  NOTIFICATION_TYPES,
  SOCKET_EVENTS,
  UPLOAD_CONFIG,
  RATE_LIMIT,
  DEFAULTS
};