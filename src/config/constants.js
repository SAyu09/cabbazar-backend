// src/config/constants.js - Complete Application Constants

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
  COMPLETED: 'COMPLETED', // Full payment done
  ADVANCED: 'ADVANCED',   // --- [NEW] Advance payment done
  FAILED: 'FAILED',
  REFUNDED: 'REFUNDED',
  PARTIALLY_REFUNDED: 'PARTIALLY_REFUNDED'
};
// Payment Methods
export const PAYMENT_METHODS = {
  RAZORPAY: 'RAZORPAY',
  CASH: 'CASH',
  UPI: 'UPI',
  CARD: 'CARD',
  WALLET: 'WALLET',
  NET_BANKING: 'NET_BANKING'
};

// Vehicle Types
export const VEHICLE_TYPES = {
  HATCHBACK: 'HATCHBACK',
  SEDAN: 'SEDAN',
  SUV_ERTIGA: 'SUV_ERTIGA',
  SUV_CARENS: 'SUV_CARENS',
  SUV_INOVA: 'SUV_INOVA',
  SUV_INOVA_6_1: 'SUV_INOVA_6_1',
  SUV_INOVA_7_1: 'SUV_INOVA_7_1',
  SUV_INOVA_PREMIUM: 'SUV_INOVA_PREMIUM',
  TRAVELLER_12_1: 'TRAVELLER_12_1',
  TRAVELLER_17_1: 'TRAVELLER_17_1',
  TRAVELLER_20_1: 'TRAVELLER_20_1',
  TRAVELLER_26_1: 'TRAVELLER_26_1',
  TRAVELLER_MAHARAJA_12_1: 'TRAVELLER_MAHARAJA_12_1',
  TRAVELLER_MAHARAJA_15_1: 'TRAVELLER_MAHARAJA_15_1'
};

// Pricing Configuration
export const PRICING = {
  HATCHBACK: {
    perKmRateOneWay: 14,
    perKmRateRoundTrip: 10,
    minFare: 300,
    nightChargeMultiplier: 1.2
  },
  SEDAN: {
    perKmRateOneWay: 15,
    perKmRateRoundTrip: 11,
    minFare: 350,
    nightChargeMultiplier: 1.2
  },
  SUV_ERTIGA: {
    perKmRateOneWay: 18,
    perKmRateRoundTrip: 13,
    minFare: 450,
    nightChargeMultiplier: 1.2
  },
  SUV_CARENS: {
    perKmRateOneWay: 16,
    perKmRateRoundTrip: 16, // Assuming same if not specified
    minFare: 450,
    nightChargeMultiplier: 1.2
  },
  SUV_INOVA: {
    perKmRateOneWay: 20,
    perKmRateRoundTrip: 17,
    minFare: 500,
    nightChargeMultiplier: 1.2
  },
  SUV_INOVA_6_1: {
    perKmRateOneWay: 18,
    perKmRateRoundTrip: 18, // Assuming same
    minFare: 500,
    nightChargeMultiplier: 1.2
  },
  SUV_INOVA_7_1: {
    perKmRateOneWay: 19,
    perKmRateRoundTrip: 19, // Assuming same
    minFare: 550,
    nightChargeMultiplier: 1.2
  },
  SUV_INOVA_PREMIUM: {
    perKmRateOneWay: 32,
    perKmRateRoundTrip: 32, // Assuming same
    minFare: 700,
    nightChargeMultiplier: 1.2
  },
  TRAVELLER_12_1: {
    perKmRateOneWay: 25,
    perKmRateRoundTrip: 25, // Assuming same
    minFare: 1000,
    nightChargeMultiplier: 1.2
  },
  TRAVELLER_17_1: {
    perKmRateOneWay: 27,
    perKmRateRoundTrip: 27, // Assuming same
    minFare: 1200,
    nightChargeMultiplier: 1.2
  },
  TRAVELLER_20_1: {
    perKmRateOneWay: 30,
    perKmRateRoundTrip: 30, // Assuming same
    minFare: 1400,
    nightChargeMultiplier: 1.2
  },
  TRAVELLER_26_1: {
    perKmRateOneWay: 35,
    perKmRateRoundTrip: 35, // Assuming same
    minFare: 1800,
    nightChargeMultiplier: 1.2
  },
  TRAVELLER_MAHARAJA_12_1: {
    perKmRateOneWay: 28,
    perKmRateRoundTrip: 28, // Assuming same
    minFare: 1300,
    nightChargeMultiplier: 1.2
  },
  TRAVELLER_MAHARAJA_15_1: {
    perKmRateOneWay: 32,
    perKmRateRoundTrip: 32, // Assuming same
    minFare: 1500,
    nightChargeMultiplier: 1.2
  }
};

// Local Package Configuration
export const LOCAL_PACKAGES = {
  '2_20': {
    hours: 2,
    km: 20,
    hatchback: 599,
    sedan: 699,
    suv_ertiga: 899,
    suv_carens: 949,
    suv_inova: 999,
    suv_inova_premium: 1299,
    extraKmCharge: {
      hatchback: 14,
      sedan: 15,
      suv_ertiga: 18,
      suv_carens: 16,
      suv_inova: 20,
      suv_inova_premium: 32
    },
    extraHourCharge: {
      hatchback: 150,
      sedan: 175,
      suv_ertiga: 200,
      suv_carens: 200,
      suv_inova: 220,
      suv_inova_premium: 300
    }
  },
  '4_40': {
    hours: 4,
    km: 40,
    hatchback: 899,
    sedan: 999,
    suv_ertiga: 1299,
    suv_carens: 1349,
    suv_inova: 1399,
    suv_inova_premium: 1799,
    extraKmCharge: {
      hatchback: 14,
      sedan: 15,
      suv_ertiga: 18,
      suv_carens: 16,
      suv_inova: 20,
      suv_inova_premium: 32
    },
    extraHourCharge: {
      hatchback: 150,
      sedan: 175,
      suv_ertiga: 200,
      suv_carens: 200,
      suv_inova: 220,
      suv_inova_premium: 300
    }
  },
  '8_80': {
    hours: 8,
    km: 80,
    hatchback: 1299,
    sedan: 1499,
    suv_ertiga: 1899,
    suv_carens: 1999,
    suv_inova: 2099,
    suv_inova_premium: 2499,
    traveller_12_1: 4500,
    traveller_maharaja_12_1: 5000,
    extraKmCharge: {
      hatchback: 14,
      sedan: 15,
      suv_ertiga: 18,
      suv_carens: 16,
      suv_inova: 20,
      suv_inova_premium: 32,
      traveller_12_1: 25,
      traveller_maharaja_12_1: 28
    },
    extraHourCharge: {
      hatchback: 150,
      sedan: 175,
      suv_ertiga: 200,
      suv_carens: 200,
      suv_inova: 220,
      suv_inova_premium: 300,
      traveller_12_1: 350,
      traveller_maharaja_12_1: 400
    }
  },
  '12_120': {
    hours: 12,
    km: 120,
    hatchback: 1799,
    sedan: 1999,
    suv_ertiga: 2499,
    suv_carens: 2599,
    suv_inova: 2699,
    suv_inova_premium: 3299,
    traveller_12_1: 6000,
    traveller_17_1: 7000,
    traveller_maharaja_12_1: 6800,
    traveller_maharaja_15_1: 7500,
    extraKmCharge: {
      hatchback: 14,
      sedan: 15,
      suv_ertiga: 18,
      suv_carens: 16,
      suv_inova: 20,
      suv_inova_premium: 32,
      traveller_12_1: 25,
      traveller_17_1: 27,
      traveller_maharaja_12_1: 28,
      traveller_maharaja_15_1: 32
    },
    extraHourCharge: {
      hatchback: 150,
      sedan: 175,
      suv_ertiga: 200,
      suv_carens: 200,
      suv_inova: 220,
      suv_inova_premium: 300,
      traveller_12_1: 350,
      traveller_17_1: 400,
      traveller_maharaja_12_1: 400,
      traveller_maharaja_15_1: 450
    }
  }
};

// Airport Transfer Base Prices
export const AIRPORT_BASE_PRICE = {
  HATCHBACK: 499,
  SEDAN: 599,
  SUV_ERTIGA: 799,
  SUV_CARENS: 849,
  SUV_INOVA: 899,
  SUV_INOVA_6_1: 899,
  SUV_INOVA_7_1: 949,
  SUV_INOVA_PREMIUM: 1199
};

// Booking Types
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

// Tax Configuration
export const TAX_CONFIG = {
  GST_RATE: 0.05 // 5% GST
};

// Outstation Surcharges (Estimates)
export const OUTSTATION_SURCHARGES = {
  TOLL_PER_KM: 1.5, // Estimated ₹1.5 per km for tolls
  STATE_PERMIT_HATCHBACK: 300,
  STATE_PERMIT_SEDAN: 400,
  STATE_PERMIT_SUV: 500,
  STATE_PERMIT_TRAVELLER: 800,
  DEFAULT_STATE_PERMIT_FEE: 450
};

// ADD-ON SERVICES
export const ADD_ON_SERVICES = {
  LUGGAGE: { name: 'Assured luggage space', price: 495 },
  PET: { name: 'Pet Allowed', price: 840 },
  REFUNDABLE: { name: 'Upgrade to Refundable booking', price: 99 },
  NEW_CAR: { name: 'Confirmed Car Model 2022 or above', price: 420 },
  DRIVER_LANG: { name: 'Preferred Driver language', price: 315 }
};

// Vehicle Capacity Configuration
export const VEHICLE_CAPACITY = {
  HATCHBACK: { passengers: 4, luggage: 2 },
  SEDAN: { passengers: 4, luggage: 3 },
  SUV_ERTIGA: { passengers: 6, luggage: 4 },
  SUV_CARENS: { passengers: 6, luggage: 4 },
  SUV_INOVA: { passengers: 6, luggage: 4 },
  SUV_INOVA_6_1: { passengers: 6, luggage: 4 },
  SUV_INOVA_7_1: { passengers: 7, luggage: 4 },
  SUV_INOVA_PREMIUM: { passengers: 6, luggage: 4 },
  TRAVELLER_12_1: { passengers: 12, luggage: 10 },
  TRAVELLER_17_1: { passengers: 17, luggage: 15 },
  TRAVELLER_20_1: { passengers: 20, luggage: 18 },
  TRAVELLER_26_1: { passengers: 26, luggage: 22 },
  TRAVELLER_MAHARAJA_12_1: { passengers: 12, luggage: 10 },
  TRAVELLER_MAHARAJA_15_1: { passengers: 15, luggage: 12 }
};

// Vehicle Features
export const VEHICLE_FEATURES = {
  HATCHBACK: ['AC', 'Music System'],
  SEDAN: ['AC', 'Music System', 'Power Windows'],
  SUV_ERTIGA: ['AC', 'Music System', 'Extra Space', '6+1 Seating'],
  SUV_CARENS: ['AC', 'Music System', 'Extra Space', 'Sunroof', '6+1 Seating'],
  SUV_INOVA: ['AC', 'Music System', 'Extra Space', 'Captain Seats', '6+1 Seating'],
  SUV_INOVA_6_1: ['AC', 'Music System', 'Extra Space', '6+1 Seating'],
  SUV_INOVA_7_1: ['AC', 'Music System', 'Extra Space', '7+1 Seating'],
  SUV_INOVA_PREMIUM: ['AC', 'Premium Music', 'Leather Seats', 'Sunroof', '6+1 Seating'],
  TRAVELLER_12_1: ['AC', 'Music System', '12+1 Seating'],
  TRAVELLER_17_1: ['AC', 'Music System', '17+1 Seating'],
  TRAVELLER_20_1: ['AC', 'Music System', '20+1 Seating'],
  TRAVELLER_26_1: ['AC', 'Music System', '26+1 Seating'],
  TRAVELLER_MAHARAJA_12_1: ['AC', 'Premium Interior', 'Music System', '12+1 Seating'],
  TRAVELLER_MAHARAJA_15_1: ['AC', 'Premium Interior', 'Music System', '15+1 Seating']
};

// Distance Configuration
export const DISTANCE_CONFIG = {
  MIN_DISTANCE: 50,
  MAX_DISTANCE: 2000,
  MIN_OUTSTATION_KM_PER_DAY: 250,
  FREE_KM_FOR_AIRPORT: 10,
  AVERAGE_SPEED_HIGHWAY: 60,
  AVERAGE_SPEED_CITY: 30
};

// Booking Configuration
export const BOOKING_CONFIG = {
  CANCELLATION_WINDOW_HOURS: 24,
  CANCELLATION_CHARGE_PERCENT: 0.20,
  MIN_BOOKING_HOURS_AHEAD: 2,
  ADVANCE_BOOKING_DAYS: 30,
  DRIVER_ACCEPTANCE_TIMEOUT_MINUTES: 5,
  MAX_BOOKING_PER_DAY: 10,
  ADVANCE_PAYMENT_PERCENTAGE: 0.20 // 20% Advance Payment
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
  ADMIN_ALERT: 'ADMIN_ALERT'
};

// Socket Events
export const SOCKET_EVENTS = {
  CONNECTION: 'connection',
  DISCONNECT: 'disconnect',
  USER_JOINED: 'user:joined',
  USER_LEFT: 'user:left',
  BOOKING_CREATED: 'booking:created',
  BOOKING_REQUEST: 'booking:request',
  BOOKING_ACCEPTED: 'booking:accepted',
  BOOKING_REJECTED: 'booking:rejected',
  BOOKING_CANCELLED: 'booking:cancelled',
  BOOKING_UPDATED: 'booking:updated',
  TRIP_STARTED: 'trip:started',
  TRIP_UPDATED: 'trip:updated',
  TRIP_COMPLETED: 'trip:completed',
  DRIVER_LOCATION: 'driver:location',
  DRIVER_STATUS: 'driver:status',
  DRIVER_ARRIVED: 'driver:arrived',
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
  OUTSTATION_SURCHARGES,
  ADD_ON_SERVICES,
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