// src/middleware/validation.middleware.js - Complete Validation Middleware
import { validationResult } from 'express-validator';
import { param } from 'express-validator';
import { BadRequestError, ValidationError } from '../utils/customError.js';
import logger from '../config/logger.js';

/**
 * Validate request using express-validator
 * Should be used after validation rules
 */
export const validate = (req, res, next) => {
  const errors = validationResult(req);

  if (!errors.isEmpty()) {
    const extractedErrors = {};
    const errorMessages = [];

    errors.array().forEach(err => {
      // Group errors by field
      if (!extractedErrors[err.path || err.param]) {
        extractedErrors[err.path || err.param] = [];
      }
      extractedErrors[err.path || err.param].push(err.msg);
      errorMessages.push(err.msg);
    });

    logger.warn('Validation failed', {
      path: req.path,
      method: req.method,
      errors: extractedErrors,
      body: req.body
    });

    // Return detailed validation error
    throw new ValidationError('Validation failed', {
      fields: extractedErrors,
      messages: errorMessages
    });
  }

  next();
};

/**
 * Validate MongoDB ObjectId parameter
 * Usage: validateObjectId('id') or validateObjectId('bookingId')
 */
export const validateObjectId = (paramName = 'id') => {
  return [
    param(paramName)
      .trim()
      .notEmpty()
      .withMessage(`${paramName} is required`)
      .isMongoId()
      .withMessage(`Invalid ${paramName} format`),
    validate
  ];
};

/**
 * Validate multiple ObjectId parameters
 */
export const validateObjectIds = (...paramNames) => {
  const validators = paramNames.map(paramName =>
    param(paramName)
      .trim()
      .notEmpty()
      .withMessage(`${paramName} is required`)
      .isMongoId()
      .withMessage(`Invalid ${paramName} format`)
  );

  return [...validators, validate];
};

/**
 * Validate pagination query parameters
 */
export const validatePagination = () => {
  return [
    param('page')
      .optional()
      .isInt({ min: 1 })
      .withMessage('Page must be a positive integer')
      .toInt(),
    param('limit')
      .optional()
      .isInt({ min: 1, max: 100 })
      .withMessage('Limit must be between 1 and 100')
      .toInt(),
    validate
  ];
};

/**
 * Sanitize and validate request body
 * Removes any fields not in the whitelist
 */
export const sanitizeBody = (allowedFields) => {
  return (req, res, next) => {
    if (!req.body || typeof req.body !== 'object') {
      return next();
    }

    const sanitized = {};
    
    allowedFields.forEach(field => {
      if (req.body.hasOwnProperty(field)) {
        sanitized[field] = req.body[field];
      }
    });

    req.body = sanitized;
    next();
  };
};

/**
 * Validate required fields in request body
 */
export const requireFields = (...fields) => {
  return (req, res, next) => {
    const missingFields = [];

    fields.forEach(field => {
      // Handle nested fields like 'address.city'
      const keys = field.split('.');
      let value = req.body;

      for (const key of keys) {
        if (value && typeof value === 'object' && key in value) {
          value = value[key];
        } else {
          value = undefined;
          break;
        }
      }

      if (value === undefined || value === null || value === '') {
        missingFields.push(field);
      }
    });

    if (missingFields.length > 0) {
      throw new BadRequestError(
        `Missing required fields: ${missingFields.join(', ')}`
      );
    }

    next();
  };
};

/**
 * Validate request query parameters
 */
export const validateQuery = (allowedParams) => {
  return (req, res, next) => {
    const invalidParams = Object.keys(req.query).filter(
      param => !allowedParams.includes(param)
    );

    if (invalidParams.length > 0) {
      logger.warn('Invalid query parameters', {
        path: req.path,
        invalidParams
      });
    }

    next();
  };
};

/**
 * Validate enum values
 */
export const validateEnum = (field, allowedValues, required = true) => {
  return (req, res, next) => {
    const value = req.body[field];

    if (!value) {
      if (required) {
        throw new BadRequestError(`${field} is required`);
      }
      return next();
    }

    const normalizedValue = typeof value === 'string' ? value.toUpperCase() : value;

    if (!allowedValues.includes(normalizedValue)) {
      throw new BadRequestError(
        `Invalid ${field}. Allowed values: ${allowedValues.join(', ')}`
      );
    }

    // Normalize the value in request
    req.body[field] = normalizedValue;
    next();
  };
};

/**
 * Validate date range
 */
export const validateDateRange = (startField = 'startDate', endField = 'endDate') => {
  return (req, res, next) => {
    const startDate = req.body[startField] || req.query[startField];
    const endDate = req.body[endField] || req.query[endField];

    if (startDate && endDate) {
      const start = new Date(startDate);
      const end = new Date(endDate);

      if (isNaN(start.getTime())) {
        throw new BadRequestError(`Invalid ${startField} format`);
      }

      if (isNaN(end.getTime())) {
        throw new BadRequestError(`Invalid ${endField} format`);
      }

      if (start > end) {
        throw new BadRequestError(`${startField} must be before ${endField}`);
      }
    }

    next();
  };
};

/**
 * Validate numeric range
 */
export const validateRange = (field, min, max) => {
  return (req, res, next) => {
    const value = req.body[field] || req.query[field];

    if (value !== undefined && value !== null) {
      const num = Number(value);

      if (isNaN(num)) {
        throw new BadRequestError(`${field} must be a number`);
      }

      if (min !== undefined && num < min) {
        throw new BadRequestError(`${field} must be at least ${min}`);
      }

      if (max !== undefined && num > max) {
        throw new BadRequestError(`${field} must not exceed ${max}`);
      }
    }

    next();
  };
};

/**
 * Validate array length
 */
export const validateArrayLength = (field, min = 0, max = Infinity) => {
  return (req, res, next) => {
    const value = req.body[field];

    if (value !== undefined) {
      if (!Array.isArray(value)) {
        throw new BadRequestError(`${field} must be an array`);
      }

      if (value.length < min) {
        throw new BadRequestError(`${field} must contain at least ${min} item(s)`);
      }

      if (value.length > max) {
        throw new BadRequestError(`${field} cannot contain more than ${max} item(s)`);
      }
    }

    next();
  };
};

/**
 * Trim whitespace from string fields
 */
export const trimStrings = (req, res, next) => {
  if (req.body && typeof req.body === 'object') {
    Object.keys(req.body).forEach(key => {
      if (typeof req.body[key] === 'string') {
        req.body[key] = req.body[key].trim();
      }
    });
  }

  next();
};

/**
 * Convert string booleans to actual booleans
 */
export const normalizeBooleans = (...fields) => {
  return (req, res, next) => {
    fields.forEach(field => {
      if (req.body.hasOwnProperty(field)) {
        const value = req.body[field];
        
        if (value === 'true' || value === '1') {
          req.body[field] = true;
        } else if (value === 'false' || value === '0') {
          req.body[field] = false;
        }
      }
    });

    next();
  };
};

/**
 * Validate coordinates
 */
export const validateCoordinates = (field) => {
  return (req, res, next) => {
    const coords = req.body[field];

    if (coords) {
      if (!coords.lat || !coords.lng) {
        throw new BadRequestError(
          `${field} must contain 'lat' and 'lng' properties`
        );
      }

      const lat = Number(coords.lat);
      const lng = Number(coords.lng);

      if (isNaN(lat) || isNaN(lng)) {
        throw new BadRequestError(`${field} coordinates must be valid numbers`);
      }

      if (lat < -90 || lat > 90) {
        throw new BadRequestError(`${field} latitude must be between -90 and 90`);
      }

      if (lng < -180 || lng > 180) {
        throw new BadRequestError(`${field} longitude must be between -180 and 180`);
      }
    }

    next();
  };
};

/**
 * Validate file upload
 */
export const validateFileUpload = (fieldName, options = {}) => {
  const {
    required = false,
    maxSize = 5 * 1024 * 1024, // 5MB default
    allowedTypes = ['image/jpeg', 'image/png', 'image/jpg']
  } = options;

  return (req, res, next) => {
    const file = req.file || req.files?.[fieldName];

    if (!file) {
      if (required) {
        throw new BadRequestError(`${fieldName} file is required`);
      }
      return next();
    }

    // Validate file size
    if (file.size > maxSize) {
      throw new BadRequestError(
        `File size exceeds maximum allowed size of ${maxSize / (1024 * 1024)}MB`
      );
    }

    // Validate file type
    if (!allowedTypes.includes(file.mimetype)) {
      throw new BadRequestError(
        `Invalid file type. Allowed types: ${allowedTypes.join(', ')}`
      );
    }

    next();
  };
};



export {
  validate as default,  
};