// src/utils/sendOtp.js - Clean OTP Notification Service
import { messaging, isFirebaseAvailable } from '../config/firebase.js';
import logger from '../config/logger.js';

/**
 * Send OTP notification via Firebase Cloud Messaging
 * @param {string} fcmToken - Firebase Cloud Messaging device token
 * @param {string} otp - One-Time Password to send
 * @returns {Promise<Object>} Response object with success status
 * @throws {Error} If notification fails to send
 */
export const sendOTPNotification = async (fcmToken, otp) => {
  // Check if Firebase is configured and available
  if (!isFirebaseAvailable || !messaging) {
    logger.warn('Firebase Messaging not available - notification skipped', {
      hasMessaging: !!messaging,
      isAvailable: isFirebaseAvailable
    });
    
    return {
      success: false,
      reason: 'Firebase Messaging not configured',
      message: 'Push notifications are currently unavailable'
    };
  }

  // Validate FCM token
  if (!fcmToken || typeof fcmToken !== 'string') {
    logger.warn('Invalid FCM token provided', {
      tokenType: typeof fcmToken,
      hasToken: !!fcmToken
    });
    
    throw new Error('Invalid FCM token provided');
  }

  // Trim and validate token format
  const cleanToken = fcmToken.trim();
  
  if (cleanToken.length === 0) {
    throw new Error('Empty FCM token provided');
  }

  // Validate OTP
  if (!otp || !/^\d{6}$/.test(otp)) {
    logger.error('Invalid OTP format', {
      otp: otp ? 'present' : 'missing',
      format: typeof otp
    });
    throw new Error('Invalid OTP format - must be 6 digits');
  }

  try {
    // Construct notification message
    const message = {
      notification: {
        title: 'Your OTP Code',
        body: `Your verification code is ${otp}. Valid for 10 minutes. Do not share this code.`
      },
      data: {
        type: 'otp_verification',
        otp: otp,
        timestamp: new Date().toISOString()
      },
      android: {
        priority: 'high',
        notification: {
          channelId: 'otp_notifications',
          priority: 'high',
          sound: 'default'
        }
      },
      apns: {
        payload: {
          aps: {
            sound: 'default',
            badge: 1
          }
        }
      },
      token: cleanToken
    };

    // Send notification
    const response = await messaging.send(message);

    logger.info('OTP notification sent successfully', {
      messageId: response,
      tokenPrefix: cleanToken.substring(0, 20) + '...'
    });

    return {
      success: true,
      messageId: response,
      message: 'Notification sent successfully'
    };

  } catch (error) {
    // Log detailed error information
    logger.error('Failed to send OTP notification', {
      errorCode: error.errorInfo?.code,
      errorMessage: error.errorInfo?.message || error.message,
      tokenPrefix: cleanToken.substring(0, 20) + '...',
      stack: error.stack
    });

    // Handle specific Firebase error codes
    if (error.errorInfo?.code === 'messaging/mismatched-credential') {
      throw new Error(
        'Firebase SenderId mismatch. The FCM token was generated with a different ' +
        'Firebase project. Please regenerate the token from your client app with ' +
        'the correct Firebase configuration.'
      );
    }

    if (error.errorInfo?.code === 'messaging/invalid-registration-token') {
      throw new Error(
        'Invalid FCM token. The token format is incorrect or malformed. ' +
        'Please request a new token from your client app.'
      );
    }

    if (error.errorInfo?.code === 'messaging/registration-token-not-registered') {
      throw new Error(
        'FCM token not registered. The token has been deleted or the app has been ' +
        'uninstalled. Please request a new token.'
      );
    }

    if (error.errorInfo?.code === 'messaging/invalid-argument') {
      throw new Error(
        'Invalid notification payload. Please check the message format.'
      );
    }

    if (error.errorInfo?.code === 'messaging/server-unavailable') {
      throw new Error(
        'Firebase messaging service temporarily unavailable. Please try again later.'
      );
    }

    // Generic error for other cases
    throw new Error(
      `Failed to send notification: ${error.errorInfo?.message || error.message}`
    );
  }
};

/**
 * Send bulk OTP notifications to multiple devices
 * @param {Array<{token: string, otp: string}>} notifications - Array of notification objects
 * @returns {Promise<Object>} Response with success and failure counts
 */
export const sendBulkOTPNotifications = async (notifications) => {
  if (!isFirebaseAvailable || !messaging) {
    logger.warn('Firebase Messaging not available for bulk send');
    return {
      success: false,
      reason: 'Firebase Messaging not configured'
    };
  }

  const results = {
    successCount: 0,
    failureCount: 0,
    errors: []
  };

  // Process notifications concurrently
  const promises = notifications.map(async ({ token, otp }) => {
    try {
      await sendOTPNotification(token, otp);
      results.successCount++;
    } catch (error) {
      results.failureCount++;
      results.errors.push({
        token: token.substring(0, 20) + '...',
        error: error.message
      });
    }
  });

  await Promise.allSettled(promises);

  logger.info('Bulk OTP notifications processed', {
    total: notifications.length,
    success: results.successCount,
    failed: results.failureCount
  });

  return results;
};

export default {
  sendOTPNotification,
  sendBulkOTPNotifications
};