// src/utils/helpers.js - Complete Helper Functions

/**
 * Mask phone number for security
 * Example: 9876543210 -> XXXXXX3210
 * @param {string} phoneNumber - Phone number to mask
 * @returns {string} Masked phone number
 */
export const maskPhoneNumber = (phoneNumber) => {
  if (!phoneNumber || typeof phoneNumber !== 'string') {
    return 'XXXXXXXXXX';
  }
  
  const cleaned = phoneNumber.replace(/\D/g, '');
  
  if (cleaned.length < 4) {
    return 'XXXXXXXXXX';
  }
  
  const lastFour = cleaned.slice(-4);
  const masked = 'X'.repeat(cleaned.length - 4) + lastFour;
  
  return masked;
};

/**
 * Mask email address for security
 * Example: john.doe@example.com -> j***e@example.com
 * @param {string} email - Email to mask
 * @returns {string} Masked email
 */
export const maskEmail = (email) => {
  if (!email || typeof email !== 'string' || !email.includes('@')) {
    return 'hidden@email.com';
  }
  
  const [localPart, domain] = email.split('@');
  
  if (localPart.length <= 2) {
    return `${localPart[0]}***@${domain}`;
  }
  
  const firstChar = localPart[0];
  const lastChar = localPart[localPart.length - 1];
  const maskedLocal = `${firstChar}${'*'.repeat(3)}${lastChar}`;
  
  return `${maskedLocal}@${domain}`;
};

/**
 * Calculate GST (Goods and Services Tax)
 * @param {number} amount - Base amount
 * @param {number} gstRate - GST rate (e.g., 0.05 for 5%)
 * @returns {number} GST amount
 */
export const calculateGST = (amount, gstRate = 0.05) => {
  if (typeof amount !== 'number' || amount < 0) {
    throw new Error('Amount must be a positive number');
  }
  
  if (typeof gstRate !== 'number' || gstRate < 0 || gstRate > 1) {
    throw new Error('GST rate must be between 0 and 1');
  }
  
  return amount * gstRate;
};

/**
 * Calculate amount including GST
 * @param {number} amount - Base amount
 * @param {number} gstRate - GST rate (e.g., 0.05 for 5%)
 * @returns {Object} Object with base, gst, and total
 */
export const calculateAmountWithGST = (amount, gstRate = 0.05) => {
  const gst = calculateGST(amount, gstRate);
  const total = amount + gst;
  
  return {
    baseAmount: Math.round(amount),
    gst: Math.round(gst),
    total: Math.round(total),
    gstRate: `${gstRate * 100}%`
  };
};

/**
 * Check if time is night time (10 PM - 6 AM)
 * @param {Date|string} dateTime - Date time to check
 * @returns {boolean} True if night time
 */
export const isNightTime = (dateTime = new Date()) => {
  try {
    const date = new Date(dateTime);
    
    if (isNaN(date.getTime())) {
      throw new Error('Invalid date');
    }
    
    const hours = date.getHours();
    
    // Night time: 10 PM (22:00) to 6 AM (06:00)
    return hours >= 22 || hours < 6;
  } catch (error) {
    console.error('Error checking night time:', error);
    return false;
  }
};

/**
 * Check if date is weekend (Saturday or Sunday)
 * @param {Date|string} date - Date to check
 * @returns {boolean} True if weekend
 */
export const isWeekend = (date = new Date()) => {
  try {
    const d = new Date(date);
    const day = d.getDay();
    return day === 0 || day === 6; // 0 = Sunday, 6 = Saturday
  } catch (error) {
    return false;
  }
};

/**
 * Check if date is a holiday
 * @param {Date|string} date - Date to check
 * @param {Array} holidays - Array of holiday dates
 * @returns {boolean} True if holiday
 */
export const isHoliday = (date, holidays = []) => {
  try {
    const d = new Date(date);
    const dateString = d.toISOString().split('T')[0];
    
    return holidays.some(holiday => {
      const holidayDate = new Date(holiday).toISOString().split('T')[0];
      return holidayDate === dateString;
    });
  } catch (error) {
    return false;
  }
};

/**
 * Format currency to Indian Rupees
 * @param {number} amount - Amount to format
 * @returns {string} Formatted currency string
 */
export const formatCurrency = (amount) => {
  if (typeof amount !== 'number') {
    return '₹0';
  }
  
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0
  }).format(amount);
};

/**
 * Format distance
 * @param {number} distance - Distance in km
 * @returns {string} Formatted distance string
 */
export const formatDistance = (distance) => {
  if (typeof distance !== 'number' || distance < 0) {
    return '0 km';
  }
  
  if (distance < 1) {
    return `${Math.round(distance * 1000)} m`;
  }
  
  return `${distance.toFixed(1)} km`;
};

/**
 * Format duration
 * @param {number} minutes - Duration in minutes
 * @returns {string} Formatted duration string
 */
export const formatDuration = (minutes) => {
  if (typeof minutes !== 'number' || minutes < 0) {
    return '0 min';
  }
  
  if (minutes < 60) {
    return `${Math.round(minutes)} min`;
  }
  
  const hours = Math.floor(minutes / 60);
  const mins = Math.round(minutes % 60);
  
  if (mins === 0) {
    return `${hours} hr${hours > 1 ? 's' : ''}`;
  }
  
  return `${hours} hr${hours > 1 ? 's' : ''} ${mins} min`;
};

/**
 * Generate random OTP
 * @param {number} length - Length of OTP (default 6)
 * @returns {string} Generated OTP
 */
export const generateOTP = (length = 6) => {
  if (length < 4 || length > 8) {
    throw new Error('OTP length must be between 4 and 8');
  }
  
  const min = Math.pow(10, length - 1);
  const max = Math.pow(10, length) - 1;
  
  return Math.floor(min + Math.random() * (max - min + 1)).toString();
};

/**
 * Validate Indian phone number
 * @param {string} phoneNumber - Phone number to validate
 * @returns {boolean} True if valid
 */
export const isValidIndianPhone = (phoneNumber) => {
  if (!phoneNumber || typeof phoneNumber !== 'string') {
    return false;
  }
  
  const cleaned = phoneNumber.replace(/\D/g, '');
  
  // Indian phone numbers: 10 digits starting with 6-9
  return /^[6-9]\d{9}$/.test(cleaned);
};

/**
 * Validate email address
 * @param {string} email - Email to validate
 * @returns {boolean} True if valid
 */
export const isValidEmail = (email) => {
  if (!email || typeof email !== 'string') {
    return false;
  }
  
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

/**
 * Validate pincode (Indian)
 * @param {string} pincode - Pincode to validate
 * @returns {boolean} True if valid
 */
export const isValidPincode = (pincode) => {
  if (!pincode) {
    return false;
  }
  
  const cleaned = pincode.toString().replace(/\D/g, '');
  return /^\d{6}$/.test(cleaned);
};

/**
 * Calculate distance between two coordinates (Haversine formula)
 * @param {Object} origin - Origin coordinates {lat, lng}
 * @param {Object} destination - Destination coordinates {lat, lng}
 * @returns {number} Distance in kilometers
 */
export const calculateDistance = (origin, destination) => {
  if (!origin || !destination || !origin.lat || !origin.lng || !destination.lat || !destination.lng) {
    throw new Error('Invalid coordinates');
  }
  
  const R = 6371; // Earth's radius in km
  const dLat = toRadians(destination.lat - origin.lat);
  const dLng = toRadians(destination.lng - origin.lng);
  
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(origin.lat)) * Math.cos(toRadians(destination.lat)) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = R * c;
  
  return Math.round(distance * 10) / 10;
};

/**
 * Convert degrees to radians
 * @param {number} degrees - Degrees
 * @returns {number} Radians
 */
const toRadians = (degrees) => {
  return degrees * (Math.PI / 180);
};

/**
 * Sanitize string (remove special characters)
 * @param {string} str - String to sanitize
 * @returns {string} Sanitized string
 */
export const sanitizeString = (str) => {
  if (!str || typeof str !== 'string') {
    return '';
  }
  
  return str.trim().replace(/[<>]/g, '');
};

/**
 * Generate unique ID
 * @param {string} prefix - Prefix for ID
 * @returns {string} Unique ID
 */
export const generateUniqueId = (prefix = 'ID') => {
  const timestamp = Date.now().toString(36);
  const randomPart = Math.random().toString(36).substring(2, 9);
  return `${prefix}_${timestamp}${randomPart}`.toUpperCase();
};

/**
 * Generate booking reference number
 * @returns {string} Booking reference
 */
export const generateBookingReference = () => {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `BK${timestamp}${random}`;
};

/**
 * Calculate percentage
 * @param {number} value - Value
 * @param {number} total - Total
 * @returns {number} Percentage
 */
export const calculatePercentage = (value, total) => {
  if (!total || total === 0) {
    return 0;
  }
  
  return Math.round((value / total) * 100 * 10) / 10;
};

/**
 * Sleep/delay function
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise}
 */
export const sleep = (ms) => {
  return new Promise(resolve => setTimeout(resolve, ms));
};

/**
 * Chunk array into smaller arrays
 * @param {Array} array - Array to chunk
 * @param {number} size - Chunk size
 * @returns {Array} Array of chunks
 */
export const chunkArray = (array, size) => {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
};

/**
 * Deep clone object
 * @param {Object} obj - Object to clone
 * @returns {Object} Cloned object
 */
export const deepClone = (obj) => {
  return JSON.parse(JSON.stringify(obj));
};

/**
 * Check if object is empty
 * @param {Object} obj - Object to check
 * @returns {boolean} True if empty
 */
export const isEmptyObject = (obj) => {
  return obj && Object.keys(obj).length === 0 && obj.constructor === Object;
};

/**
 * Capitalize first letter
 * @param {string} str - String to capitalize
 * @returns {string} Capitalized string
 */
export const capitalizeFirst = (str) => {
  if (!str || typeof str !== 'string') {
    return '';
  }
  
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
};

/**
 * Add days to date
 * @param {Date} date - Base date
 * @param {number} days - Days to add
 * @returns {Date} New date
 */
export const addDays = (date, days) => {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
};

/**
 * Add hours to date
 * @param {Date} date - Base date
 * @param {number} hours - Hours to add
 * @returns {Date} New date
 */
export const addHours = (date, hours) => {
  const result = new Date(date);
  result.setHours(result.getHours() + hours);
  return result;
};

/**
 * Add minutes to date
 * @param {Date} date - Base date
 * @param {number} minutes - Minutes to add
 * @returns {Date} New date
 */
export const addMinutes = (date, minutes) => {
  const result = new Date(date);
  result.setMinutes(result.getMinutes() + minutes);
  return result;
};

/**
 * Parse pagination parameters
 * @param {Object} query - Query parameters
 * @returns {Object} Pagination values
 */
export const parsePagination = (query = {}) => {
  const page = Math.max(1, parseInt(query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit) || 10));
  const skip = (page - 1) * limit;
  
  return { page, limit, skip };
};

/**
 * Format date to readable string
 * @param {Date|string} date - Date to format
 * @returns {string} Formatted date
 */
export const formatDate = (date) => {
  try {
    const d = new Date(date);
    return d.toLocaleDateString('en-IN', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  } catch (error) {
    return 'Invalid date';
  }
};

/**
 * Format date time to readable string
 * @param {Date|string} dateTime - DateTime to format
 * @returns {string} Formatted date time
 */
export const formatDateTime = (dateTime) => {
  try {
    const d = new Date(dateTime);
    return d.toLocaleString('en-IN', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch (error) {
    return 'Invalid date time';
  }
};

/**
 * Get time difference in human readable format
 * @param {Date|string} date - Date to compare
 * @returns {string} Time difference
 */
export const getTimeAgo = (date) => {
  try {
    const now = new Date();
    const past = new Date(date);
    const diffMs = now - past;
    const diffMins = Math.floor(diffMs / 60000);
    
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins} minute${diffMins > 1 ? 's' : ''} ago`;
    
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
    
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 30) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
    
    const diffMonths = Math.floor(diffDays / 30);
    if (diffMonths < 12) return `${diffMonths} month${diffMonths > 1 ? 's' : ''} ago`;
    
    const diffYears = Math.floor(diffMonths / 12);
    return `${diffYears} year${diffYears > 1 ? 's' : ''} ago`;
  } catch (error) {
    return 'Unknown';
  }
};

/**
 * Remove duplicates from array
 * @param {Array} array - Array with duplicates
 * @returns {Array} Array without duplicates
 */
export const removeDuplicates = (array) => {
  return [...new Set(array)];
};

/**
 * Sort array of objects by key
 * @param {Array} array - Array to sort
 * @param {string} key - Key to sort by
 * @param {string} order - Order: 'asc' or 'desc'
 * @returns {Array} Sorted array
 */
export const sortByKey = (array, key, order = 'asc') => {
  return array.sort((a, b) => {
    if (order === 'asc') {
      return a[key] > b[key] ? 1 : -1;
    }
    return a[key] < b[key] ? 1 : -1;
  });
};

export default {
  maskPhoneNumber,
  maskEmail,
  calculateGST,
  calculateAmountWithGST,
  isNightTime,
  isWeekend,
  isHoliday,
  formatCurrency,
  formatDistance,
  formatDuration,
  generateOTP,
  isValidIndianPhone,
  isValidEmail,
  isValidPincode,
  calculateDistance,
  sanitizeString,
  generateUniqueId,
  generateBookingReference,
  calculatePercentage,
  sleep,
  chunkArray,
  deepClone,
  isEmptyObject,
  capitalizeFirst,
  formatDate,
  formatDateTime,
  getTimeAgo,
  removeDuplicates,
  sortByKey
};