// src/utils/notification.utils.js - Universal Notification Service
import { messaging, isFirebaseAvailable } from '../config/firebase.js';
import logger from '../config/logger.js';

/**
 * Notification types enum
 */
export const NOTIFICATION_TYPES = {
  OTP: 'otp_verification',
  ORDER: 'order_update',
  DELIVERY: 'delivery_update',
  PROMOTION: 'promotional',
  ALERT: 'alert',
  REMINDER: 'reminder',
  GENERAL: 'general'
};

/**
 * Notification priority levels
 */
export const NOTIFICATION_PRIORITY = {
  HIGH: 'high',
  NORMAL: 'normal',
  LOW: 'low'
};

/**
 * Check if Firebase Messaging is available
 * @returns {boolean}
 */
export const isNotificationServiceAvailable = () => {
  return isFirebaseAvailable && !!messaging;
};

/**
 * Validate FCM token format
 * @param {string} token - FCM token to validate
 * @returns {boolean}
 */
export const validateFCMToken = (token) => {
  if (!token || typeof token !== 'string') {
    return false;
  }
  
  const cleanToken = token.trim();
  return cleanToken.length > 0;
};

/**
 * Send a push notification via Firebase Cloud Messaging
 * @param {Object} options - Notification options
 * @param {string} options.token - FCM device token
 * @param {string} options.title - Notification title
 * @param {string} options.body - Notification body message
 * @param {string} options.type - Notification type (from NOTIFICATION_TYPES)
 * @param {Object} options.data - Additional data payload
 * @param {string} options.priority - Notification priority (high/normal)
 * @param {string} options.imageUrl - Optional image URL
 * @param {string} options.sound - Notification sound (default/custom)
 * @param {number} options.badge - Badge count for iOS
 * @returns {Promise<Object>}
 */
export const sendNotification = async ({
  token,
  title,
  body,
  type = NOTIFICATION_TYPES.GENERAL,
  data = {},
  priority = NOTIFICATION_PRIORITY.NORMAL,
  imageUrl = null,
  sound = 'default',
  badge = null
}) => {
  // Check Firebase availability
  if (!isNotificationServiceAvailable()) {
    logger.warn('Firebase Messaging not available', {
      hasMessaging: !!messaging,
      isAvailable: isFirebaseAvailable
    });
    
    return {
      success: false,
      reason: 'notification_service_unavailable',
      message: 'Push notification service is currently unavailable'
    };
  }

  // Validate token
  if (!validateFCMToken(token)) {
    logger.warn('Invalid FCM token provided', {
      tokenProvided: !!token,
      tokenType: typeof token
    });
    
    throw new Error('Invalid FCM token provided');
  }

  const cleanToken = token.trim();

  // Validate required fields
  if (!title || !body) {
    throw new Error('Notification title and body are required');
  }

  try {
    // Construct base message
    const message = {
      notification: {
        title: title.substring(0, 100), // Limit title length
        body: body.substring(0, 500) // Limit body length
      },
      data: {
        type,
        timestamp: new Date().toISOString(),
        ...data
      },
      token: cleanToken
    };

    // Add image if provided
    if (imageUrl) {
      message.notification.imageUrl = imageUrl;
    }

    // Android-specific configuration
    message.android = {
      priority: priority === NOTIFICATION_PRIORITY.HIGH ? 'high' : 'normal',
      notification: {
        channelId: `${type}_notifications`,
        priority: priority === NOTIFICATION_PRIORITY.HIGH ? 'high' : 'default',
        sound: sound,
        defaultSound: sound === 'default',
        defaultVibrateTimings: true,
        defaultLightSettings: true
      }
    };

    // iOS (APNS) specific configuration
    message.apns = {
      payload: {
        aps: {
          sound: sound,
          contentAvailable: true
        }
      }
    };

    // Add badge for iOS if provided
    if (badge !== null && typeof badge === 'number') {
      message.apns.payload.aps.badge = badge;
    }

    // High priority configuration
    if (priority === NOTIFICATION_PRIORITY.HIGH) {
      message.android.priority = 'high';
      message.apns.headers = {
        'apns-priority': '10'
      };
    }

    // Send notification
    const response = await messaging.send(message);

    logger.info('Notification sent successfully', {
      messageId: response,
      type,
      priority,
      tokenPrefix: cleanToken.substring(0, 20) + '...'
    });

    return {
      success: true,
      messageId: response,
      message: 'Notification sent successfully'
    };

  } catch (error) {
    // Log detailed error
    logger.error('Failed to send notification', {
      errorCode: error.errorInfo?.code,
      errorMessage: error.errorInfo?.message || error.message,
      type,
      tokenPrefix: cleanToken.substring(0, 20) + '...'
    });

    // Handle specific Firebase errors
    return handleFirebaseError(error);
  }
};

/**
 * Send OTP notification (convenience function)
 * @param {string} token - FCM token
 * @param {string} otp - OTP code
 * @returns {Promise<Object>}
 */
export const sendOTPNotification = async (token, otp) => {
  // Validate OTP format
  if (!otp || !/^\d{6}$/.test(otp)) {
    throw new Error('Invalid OTP format - must be 6 digits');
  }

  return sendNotification({
    token,
    title: 'Your OTP Code',
    body: `Your verification code is ${otp}. Valid for 10 minutes. Do not share this code.`,
    type: NOTIFICATION_TYPES.OTP,
    priority: NOTIFICATION_PRIORITY.HIGH,
    data: {
      otp,
      expiresIn: '10 minutes'
    }
  });
};

/**
 * Send order update notification
 * @param {string} token - FCM token
 * @param {string} orderId - Order ID
 * @param {string} status - Order status
 * @param {string} message - Custom message
 * @returns {Promise<Object>}
 */
export const sendOrderNotification = async (token, orderId, status, message) => {
  return sendNotification({
    token,
    title: 'Order Update',
    body: message || `Your order #${orderId} is now ${status}`,
    type: NOTIFICATION_TYPES.ORDER,
    priority: NOTIFICATION_PRIORITY.NORMAL,
    data: {
      orderId,
      status
    }
  });
};

/**
 * Send delivery update notification
 * @param {string} token - FCM token
 * @param {string} orderId - Order ID
 * @param {string} message - Delivery message
 * @param {string} driverName - Driver name (optional)
 * @returns {Promise<Object>}
 */
export const sendDeliveryNotification = async (token, orderId, message, driverName = null) => {
  const data = { orderId };
  if (driverName) data.driverName = driverName;

  return sendNotification({
    token,
    title: 'Delivery Update',
    body: message,
    type: NOTIFICATION_TYPES.DELIVERY,
    priority: NOTIFICATION_PRIORITY.HIGH,
    data
  });
};

/**
 * Send promotional notification
 * @param {string} token - FCM token
 * @param {string} title - Promo title
 * @param {string} message - Promo message
 * @param {string} imageUrl - Promo image URL (optional)
 * @param {Object} extraData - Additional data
 * @returns {Promise<Object>}
 */
export const sendPromotionalNotification = async (token, title, message, imageUrl = null, extraData = {}) => {
  return sendNotification({
    token,
    title,
    body: message,
    type: NOTIFICATION_TYPES.PROMOTION,
    priority: NOTIFICATION_PRIORITY.LOW,
    imageUrl,
    data: extraData
  });
};

/**
 * Send alert notification
 * @param {string} token - FCM token
 * @param {string} title - Alert title
 * @param {string} message - Alert message
 * @param {Object} extraData - Additional data
 * @returns {Promise<Object>}
 */
export const sendAlertNotification = async (token, title, message, extraData = {}) => {
  return sendNotification({
    token,
    title,
    body: message,
    type: NOTIFICATION_TYPES.ALERT,
    priority: NOTIFICATION_PRIORITY.HIGH,
    data: extraData
  });
};

/**
 * Send bulk notifications to multiple tokens
 * @param {Array<Object>} notifications - Array of notification objects
 * @returns {Promise<Object>} Results summary
 */
export const sendBulkNotifications = async (notifications) => {
  if (!isNotificationServiceAvailable()) {
    logger.warn('Firebase Messaging not available for bulk send');
    return {
      success: false,
      reason: 'notification_service_unavailable'
    };
  }

  const results = {
    total: notifications.length,
    successCount: 0,
    failureCount: 0,
    errors: []
  };

  // Process notifications concurrently with limit
  const BATCH_SIZE = 500; // FCM batch limit
  const batches = [];
  
  for (let i = 0; i < notifications.length; i += BATCH_SIZE) {
    batches.push(notifications.slice(i, i + BATCH_SIZE));
  }

  for (const batch of batches) {
    const promises = batch.map(async (notificationConfig) => {
      try {
        await sendNotification(notificationConfig);
        results.successCount++;
      } catch (error) {
        results.failureCount++;
        results.errors.push({
          token: notificationConfig.token?.substring(0, 20) + '...',
          error: error.message
        });
      }
    });

    await Promise.allSettled(promises);
  }

  logger.info('Bulk notifications processed', {
    total: results.total,
    success: results.successCount,
    failed: results.failureCount
  });

  return results;
};

/**
 * Handle Firebase-specific errors
 * @param {Error} error - Firebase error
 * @returns {never} - Throws formatted error
 */
const handleFirebaseError = (error) => {
  const errorCode = error.errorInfo?.code;
  const errorMessage = error.errorInfo?.message || error.message;

  const errorMap = {
    'messaging/mismatched-credential': {
      message: 'Firebase SenderId mismatch. Please regenerate FCM token with correct Firebase configuration.',
      code: 'FCM_SENDER_MISMATCH'
    },
    'messaging/invalid-registration-token': {
      message: 'Invalid FCM token format. Please request a new token.',
      code: 'FCM_INVALID_TOKEN'
    },
    'messaging/registration-token-not-registered': {
      message: 'FCM token not registered. App may be uninstalled. Please request new token.',
      code: 'FCM_TOKEN_UNREGISTERED'
    },
    'messaging/invalid-argument': {
      message: 'Invalid notification payload format.',
      code: 'FCM_INVALID_PAYLOAD'
    },
    'messaging/server-unavailable': {
      message: 'Firebase messaging service temporarily unavailable. Please retry.',
      code: 'FCM_SERVER_UNAVAILABLE'
    },
    'messaging/internal-error': {
      message: 'Internal Firebase error occurred.',
      code: 'FCM_INTERNAL_ERROR'
    }
  };

  const mappedError = errorMap[errorCode] || {
    message: `Failed to send notification: ${errorMessage}`,
    code: 'FCM_UNKNOWN_ERROR'
  };

  const customError = new Error(mappedError.message);
  customError.code = mappedError.code;
  customError.originalError = errorMessage;
  
  throw customError;
};

/**
 * Send booking notification
 * @param {string} token - FCM token
 * @param {string} bookingId - Booking ID
 * @param {string} status - Booking status (confirmed/cancelled/completed)
 * @param {string} message - Custom message
 * @returns {Promise<Object>}
 */
export const sendBookingNotification = async (token, bookingId, status, message) => {
  const statusTitles = {
    confirmed: 'Booking Confirmed',
    cancelled: 'Booking Cancelled',
    assigned: 'Driver Assigned',
    completed: 'Trip Completed'
  };

  return sendNotification({
    token,
    title: statusTitles[status] || 'Booking Update',
    body: message,
    type: NOTIFICATION_TYPES.ORDER,
    priority: NOTIFICATION_PRIORITY.HIGH,
    data: {
      bookingId,
      status,
      action: 'VIEW_BOOKING'
    }
  });
};

/**
 * Send driver notification
 * @param {string} token - FCM token
 * @param {string} title - Notification title
 * @param {string} message - Notification message
 * @param {Object} extraData - Additional data
 * @returns {Promise<Object>}
 */
export const sendDriverNotification = async (token, title, message, extraData = {}) => {
  return sendNotification({
    token,
    title,
    body: message,
    type: NOTIFICATION_TYPES.DELIVERY,
    priority: NOTIFICATION_PRIORITY.HIGH,
    data: {
      ...extraData,
      action: 'DRIVER_UPDATE'
    }
  });
};

/**
 * Send trip notification
 * @param {string} token - FCM token
 * @param {string} bookingId - Booking ID
 * @param {string} status - Trip status (started/ongoing/completed)
 * @param {string} message - Custom message
 * @returns {Promise<Object>}
 */
export const sendTripNotification = async (token, bookingId, status, message) => {
  return sendNotification({
    token,
    title: 'Trip Update',
    body: message,
    type: NOTIFICATION_TYPES.DELIVERY,
    priority: NOTIFICATION_PRIORITY.HIGH,
    data: {
      bookingId,
      status,
      action: 'VIEW_TRIP'
    }
  });
};

export default {
  sendNotification,
  sendOTPNotification,
  sendOrderNotification,
  sendDeliveryNotification,
  sendPromotionalNotification,
  sendAlertNotification,
  sendBookingNotification,
  sendDriverNotification,
  sendTripNotification,
  sendBulkNotifications,
  isNotificationServiceAvailable,
  validateFCMToken,
  NOTIFICATION_TYPES,
  NOTIFICATION_PRIORITY
};