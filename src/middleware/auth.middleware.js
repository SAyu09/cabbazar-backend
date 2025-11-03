// src/middleware/auth.middleware.js - Complete Authentication Middleware
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import {catchAsync} from '../utils/catchAsync.js';
import { AuthenticationError, AuthorizationError } from '../utils/customError.js';
import logger from '../config/logger.js';
// We no longer import or run dotenv.config() here.
// server.js is the single source of truth for loading and validating env vars.

// We can safely assume JWT_SECRET exists because server.js validates it at startup.
const JWT_SECRET = process.env.JWT_SECRET;

/**
 * Protect routes - Verify JWT token and authenticate user
 */
export const protect = catchAsync(async (req, res, next) => {
  let token;

  // 1. Check if token exists in headers
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  } 
  // Also check in cookies (for web applications)
  else if (req.cookies && req.cookies.jwt) {
    token = req.cookies.jwt;
  }

  // 2. Verify token exists
  if (!token) {
    logger.warn('Access attempt without token', {
      ip: req.ip,
      url: req.originalUrl,
      method: req.method
    });
    throw new AuthenticationError('You are not logged in. Please log in to get access.');
  }

  try {
    // 3. Verify token
    const decoded = jwt.verify(token, JWT_SECRET); // Use the checked variable

    // 4. Check if user still exists
    const user = await User.findById(decoded.id).select('-otp');

    if (!user) {
      logger.warn('Token valid but user not found', {
        userId: decoded.id,
        ip: req.ip
      });
      throw new AuthenticationError('The user belonging to this token no longer exists.');
    }

    // 5. Check if user is active
    if (!user.isActive) {
      logger.warn('Inactive user access attempt', {
        userId: user._id,
        phoneNumber: user.phoneNumber
      });
      throw new AuthenticationError('Your account has been deactivated. Please contact support.');
    }

    // 6. Grant access to protected route
    req.user = user;
    
    logger.info('User authenticated successfully', {
      userId: user._id,
      phoneNumber: user.phoneNumber,
      url: req.originalUrl
    });

    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      throw new AuthenticationError('Invalid token. Please log in again.');
    } else if (error.name === 'TokenExpiredError') {
      throw new AuthenticationError('Your token has expired. Please log in again.');
    }
    throw error;
  }
});

/**
 * Restrict access to specific roles
 * @param  {...string} roles - Allowed roles
 */
export const restrictTo = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      logger.warn('Unauthorized access attempt', {
        userId: req.user._id,
        userRole: req.user.role,
        requiredRoles: roles,
        url: req.originalUrl
      });
      
      throw new AuthorizationError('You do not have permission to perform this action');
    }
    next();
  };
};

/**
 * Generate JWT Token
 * @param {string} id - User ID
 * @param {string} expiresIn - Token expiration time
 * @returns {string} JWT token
 */
export const generateToken = (id, expiresIn = null) => {
  const expiry = expiresIn || process.env.JWT_EXPIRE || '30d';
  
  const token = jwt.sign({ id }, JWT_SECRET, { // Use the checked variable
    expiresIn: expiry
  });

  logger.info('JWT token generated', {
    userId: id,
    expiresIn: expiry
  });

  return token;
};

/**
 * Generate refresh token using the same JWT_SECRET
 */
export const generateRefreshToken = (id) => {
  return jwt.sign({ id }, JWT_SECRET, { 
    expiresIn: process.env.JWT_REFRESH_EXPIRE || '90d'
  });
};

/**
 * Verify refresh token using JWT_SECRET
 */
export const verifyRefreshToken = (token) => {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (error) {
    throw new AuthenticationError('Invalid refresh token');
  }
};

/**
 * Optional authentication - attach user if token exists but don't require it
 */
export const optionalAuth = catchAsync(async (req, res, next) => {
  let token;

  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (token) {
    try {
      const decoded = jwt.verify(token, JWT_SECRET); // Use the checked variable
      const user = await User.findById(decoded.id).select('-otp');
      
      if (user && user.isActive) {
        req.user = user;
      }
    } catch (error) {
      // Token invalid but continue anyway
      logger.debug('Optional auth - invalid token', { error: error.message });
    }
  }

  next();
});

/**
 * Check if user owns the resource
 * @param {string} resourceUserIdField - Field name that contains user ID in the resource
 */
export const checkOwnership = (resourceUserIdField = 'userId') => {
  return catchAsync(async (req, res, next) => {
    // The resource should be attached to req by previous middleware
    const resource = req.booking || req.resource;
    
    if (!resource) {
      throw new Error('Resource not found for ownership check');
    }

    const resourceUserId = resource[resourceUserIdField];
    
    if (!resourceUserId) {
      throw new Error(`Field ${resourceUserIdField} not found in resource`);
    }

    // Check if user owns the resource
    if (resourceUserId.toString() !== req.user._id.toString()) {
      logger.warn('Ownership check failed', {
        userId: req.user._id,
        resourceUserId: resourceUserId,
        resourceType: resource.constructor.modelName
      });
      
      throw new AuthorizationError('You do not have permission to access this resource');
    }

    next();
  });
};

/**
 * Set token cookie (for web applications)
 * @param {Object} res - Response object
 * @param {string} token - JWT token
 */
export const setTokenCookie = (res, token) => {
  const cookieOptions = {
    expires: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
    httpOnly: true, // Prevents XSS attacks
    secure: process.env.NODE_ENV === 'production', // HTTPS only in production
    sameSite: 'strict' // CSRF protection
  };

  res.cookie('jwt', token, cookieOptions);
};

/**
 * Clear token cookie
 * @param {Object} res - Response object
 */
export const clearTokenCookie = (res) => {
  res.cookie('jwt', 'loggedout', {
    expires: new Date(Date.now() + 1000),
    httpOnly: true
  });
};

export default {
  protect,
  restrictTo,
  generateToken,
  generateRefreshToken,
  verifyRefreshToken,
  optionalAuth,
  checkOwnership,
  setTokenCookie,
  clearTokenCookie
};
