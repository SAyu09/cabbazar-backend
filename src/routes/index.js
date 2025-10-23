// src/routes/index.js - Main Routes Configuration
import express from 'express';
import authRoutes from './auth.routes.js';
import bookingRoutes from './booking.routes.js';
import userRoutes from './user.routes.js';
import logger from '../config/logger.js';

const router = express.Router();

// Request logging middleware for API routes
router.use((req, res, next) => {
  const startTime = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    logger.info('API Request', {
      method: req.method,
      url: req.originalUrl,
      status: res.statusCode,
      duration: `${duration}ms`,
      ip: req.ip,
      userAgent: req.get('user-agent')
    });
  });
  
  next();
});

// ============================================
// MOUNT ROUTES
// ============================================

/**
 * Authentication Routes
 * Base: /api/auth
 */
router.use('/auth', authRoutes);

/**
 * Booking Routes
 * Base: /api/bookings
 */
router.use('/bookings', bookingRoutes);

/**
 * User Routes
 * Base: /api/users
 */
router.use('/users', userRoutes);

// ============================================
// API ROOT - Documentation
// ============================================

/**
 * @route   GET /api
 * @desc    API documentation and available endpoints
 * @access  Public
 */
router.get('/', (req, res) => {
  res.status(200).json({
    message: 'CabBazar API v1.0',
    version: '1.0.0',
    status: 'active',
    documentation: {
      authentication: {
        base: '/api/auth',
        endpoints: {
          sendOTP: 'POST /api/auth/otp',
          login: 'POST /api/auth/login',
          resendOTP: 'POST /api/auth/resend-otp',
          checkPhone: 'POST /api/auth/check-phone',
          getProfile: 'GET /api/auth/me (Protected)',
          updateProfile: 'PUT /api/auth/profile (Protected)',
          changePhone: 'POST /api/auth/change-phone (Protected)',
          logout: 'POST /api/auth/logout (Protected)',
          deleteAccount: 'DELETE /api/auth/account (Protected)'
        }
      },
      bookings: {
        base: '/api/bookings',
        endpoints: {
          search: 'POST /api/bookings/search',
          estimateFare: 'POST /api/bookings/estimate-fare',
          create: 'POST /api/bookings (Protected)',
          getAll: 'GET /api/bookings (Protected)',
          getById: 'GET /api/bookings/:id (Protected)',
          getByCode: 'GET /api/bookings/code/:bookingId (Protected)',
          getStats: 'GET /api/bookings/stats (Protected)',
          updateStatus: 'PATCH /api/bookings/:id/status (Protected)',
          cancel: 'PATCH /api/bookings/:id/cancel (Protected)',
          getCancellationCharges: 'GET /api/bookings/:id/cancellation-charges (Protected)',
          addRating: 'POST /api/bookings/:id/rating (Protected)',
          applyDiscount: 'POST /api/bookings/:id/apply-discount (Protected)'
        }
      },
      users: {
        base: '/api/users',
        endpoints: {
          getBookings: 'GET /api/users/me/bookings (Protected)',
          getUpcoming: 'GET /api/users/me/bookings/upcoming (Protected)',
          getPast: 'GET /api/users/me/bookings/past (Protected)',
          getActive: 'GET /api/users/me/bookings/active (Protected)',
          searchBookings: 'GET /api/users/me/bookings/search (Protected)',
          getStats: 'GET /api/users/me/stats (Protected)',
          getNotifications: 'GET /api/users/me/notifications (Protected)',
          getSavedAddresses: 'GET /api/users/me/addresses (Protected)',
          exportData: 'GET /api/users/me/export (Protected)'
        }
      }
    },
    authentication: {
      type: 'Bearer Token (JWT)',
      header: 'Authorization: Bearer <token>',
      note: 'Login with OTP to get access token'
    },
    supportedBookingTypes: [
      'ONE_WAY',
      'ROUND_TRIP',
      'LOCAL_8_80',
      'LOCAL_12_120',
      'AIRPORT_DROP',
      'AIRPORT_PICKUP'
    ],
    supportedVehicleTypes: [
      'HATCHBACK',
      'SEDAN',
      'SUV',
      'PREMIUM_SEDAN'
    ],
    contact: {
      support: 'support@cabbazar.com',
      website: 'https://cabbazar.com'
    },
    links: {
      health: '/health',
      docs: '/api'
    }
  });
});

// ============================================
// HEALTH CHECK
// ============================================

/**
 * @route   GET /api/health
 * @desc    Health check for API routes
 * @access  Public
 */
router.get('/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    service: 'API',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

export default router;