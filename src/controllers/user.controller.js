// src/controllers/user.controller.js - Complete User Controller
import Booking from '../models/Booking.js';
import User from '../models/User.js';
import { sendSuccess, sendPaginatedResponse } from '../utils/response.js';
import {catchAsync} from '../utils/catchAsync.js';
import { BOOKING_STATUS } from '../config/constants.js';
import { parsePagination } from '../utils/helpers.js';
import logger from '../config/logger.js';

/**
 * @desc    Get user's booking history with filters
 * @route   GET /api/users/me/bookings
 * @access  Private
 */
export const getMyBookings = catchAsync(async (req, res) => {
  const { status, bookingType, sortBy = '-createdAt' } = req.query;
  const { page, limit, skip } = parsePagination(req.query);

  // Build query
  const query = { userId: req.user._id };

  if (status) {
    // Support multiple statuses: ?status=COMPLETED,CANCELLED
    const statuses = status.split(',').map(s => s.toUpperCase());
    query.status = { $in: statuses };
  }

  if (bookingType) {
    query.bookingType = bookingType.toUpperCase();
  }

  // Get bookings with pagination
  const bookings = await Booking.find(query)
    .sort(sortBy)
    .skip(skip)
    .limit(limit)
    .populate('vehicleId', 'type modelName licensePlate color')
    .populate('driverId', 'name phoneNumber rating totalRides')
    .select('-metadata'); // Exclude metadata for cleaner response

  // Get total count
  const total = await Booking.countDocuments(query);

  logger.info('User bookings retrieved', { 
    userId: req.user._id,
    count: bookings.length,
    total,
    filters: { status, bookingType }
  });

  return sendPaginatedResponse(
    res,
    bookings,
    page,
    limit,
    total,
    'Bookings retrieved successfully'
  );
});

/**
 * @desc    Get upcoming bookings
 * @route   GET /api/users/me/bookings/upcoming
 * @access  Private
 */
export const getUpcomingBookings = catchAsync(async (req, res) => {
  const bookings = await Booking.find({
    userId: req.user._id,
    startDateTime: { $gte: new Date() },
    status: { 
      $in: [
        BOOKING_STATUS.PENDING, 
        BOOKING_STATUS.CONFIRMED, 
        BOOKING_STATUS.ASSIGNED
      ] 
    }
  })
    .sort({ startDateTime: 1 }) // Ascending order (nearest first)
    .populate('vehicleId', 'type modelName licensePlate')
    .populate('driverId', 'name phoneNumber rating')
    .limit(10); // Limit to next 10 bookings

  logger.info('Upcoming bookings retrieved', { 
    userId: req.user._id,
    count: bookings.length 
  });

  return sendSuccess(res, bookings, 'Upcoming bookings retrieved successfully', 200);
});

/**
 * @desc    Get past/completed bookings
 * @route   GET /api/users/me/bookings/past
 * @access  Private
 */
export const getPastBookings = catchAsync(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);

  const query = {
    userId: req.user._id,
    status: { $in: [BOOKING_STATUS.COMPLETED, BOOKING_STATUS.CANCELLED] }
  };

  // Option to filter by date range
  if (req.query.fromDate) {
    query.startDateTime = { $gte: new Date(req.query.fromDate) };
  }
  if (req.query.toDate) {
    query.startDateTime = { 
      ...query.startDateTime, 
      $lte: new Date(req.query.toDate) 
    };
  }

  const bookings = await Booking.find(query)
    .sort({ startDateTime: -1 }) // Descending order (most recent first)
    .skip(skip)
    .limit(limit)
    .populate('vehicleId', 'type modelName')
    .populate('driverId', 'name rating');

  const total = await Booking.countDocuments(query);

  logger.info('Past bookings retrieved', { 
    userId: req.user._id,
    count: bookings.length,
    total 
  });

  return sendPaginatedResponse(
    res,
    bookings,
    page,
    limit,
    total,
    'Past bookings retrieved successfully'
  );
});

/**
 * @desc    Get active/ongoing booking
 * @route   GET /api/users/me/bookings/active
 * @access  Private
 */
export const getActiveBooking = catchAsync(async (req, res) => {
  const booking = await Booking.findOne({
    userId: req.user._id,
    status: BOOKING_STATUS.IN_PROGRESS
  })
    .populate('vehicleId')
    .populate('driverId', 'name phoneNumber rating currentLocation')
    .sort({ startDateTime: -1 });

  if (!booking) {
    return sendSuccess(res, null, 'No active booking found', 200);
  }

  logger.info('Active booking retrieved', { 
    userId: req.user._id,
    bookingId: booking.bookingId 
  });

  return sendSuccess(res, booking, 'Active booking retrieved successfully', 200);
});

/**
 * @desc    Get booking statistics and insights
 * @route   GET /api/users/me/stats
 * @access  Private
 */
export const getUserStats = catchAsync(async (req, res) => {
  const userId = req.user._id;

  // Aggregate statistics
  const stats = await Booking.aggregate([
    { $match: { userId } },
    {
      $group: {
        _id: null,
        totalBookings: { $sum: 1 },
        completedBookings: {
          $sum: { $cond: [{ $eq: ['$status', BOOKING_STATUS.COMPLETED] }, 1, 0] }
        },
        cancelledBookings: {
          $sum: { $cond: [{ $eq: ['$status', BOOKING_STATUS.CANCELLED] }, 1, 0] }
        },
        totalSpent: {
          $sum: {
            $cond: [
              { $eq: ['$status', BOOKING_STATUS.COMPLETED] },
              '$fareDetails.finalAmount',
              0
            ]
          }
        },
        avgBookingValue: {
          $avg: '$fareDetails.finalAmount'
        },
        totalDistance: {
          $sum: '$fareDetails.distance'
        }
      }
    }
  ]);

  // Get favorite vehicle type
  const favoriteVehicle = await Booking.aggregate([
    { $match: { userId } },
    { $group: { _id: '$vehicleType', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: 1 }
  ]);

  // Get most booked routes
  const topRoutes = await Booking.aggregate([
    { $match: { userId } },
    {
      $group: {
        _id: {
          from: '$pickupLocation.city',
          to: '$dropLocation.city'
        },
        count: { $sum: 1 }
      }
    },
    { $sort: { count: -1 } },
    { $limit: 5 }
  ]);

  // Get booking trend (last 6 months)
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

  const bookingTrend = await Booking.aggregate([
    { 
      $match: { 
        userId,
        createdAt: { $gte: sixMonthsAgo }
      } 
    },
    {
      $group: {
        _id: {
          year: { $year: '$createdAt' },
          month: { $month: '$createdAt' }
        },
        count: { $sum: 1 },
        totalAmount: { $sum: '$fareDetails.finalAmount' }
      }
    },
    { $sort: { '_id.year': 1, '_id.month': 1 } }
  ]);

  const result = {
    overview: {
      totalBookings: stats[0]?.totalBookings || 0,
      completedBookings: stats[0]?.completedBookings || 0,
      cancelledBookings: stats[0]?.cancelledBookings || 0,
      totalSpent: Math.round(stats[0]?.totalSpent || 0),
      avgBookingValue: Math.round(stats[0]?.avgBookingValue || 0),
      totalDistance: Math.round(stats[0]?.totalDistance || 0),
      completionRate: stats[0]?.totalBookings > 0
        ? Math.round((stats[0].completedBookings / stats[0].totalBookings) * 100)
        : 0
    },
    favorites: {
      vehicleType: favoriteVehicle[0]?._id || null,
      vehicleBookings: favoriteVehicle[0]?.count || 0
    },
    topRoutes: topRoutes.map(r => ({
      route: `${r._id.from} → ${r._id.to}`,
      bookings: r.count
    })),
    bookingTrend: bookingTrend.map(t => ({
      month: `${t._id.year}-${String(t._id.month).padStart(2, '0')}`,
      bookings: t.count,
      totalAmount: Math.round(t.totalAmount)
    }))
  };

  logger.info('User statistics retrieved', { 
    userId,
    totalBookings: result.overview.totalBookings
  });

  return sendSuccess(res, result, 'Statistics retrieved successfully', 200);
});

/**
 * @desc    Search user's booking history
 * @route   GET /api/users/me/bookings/search
 * @access  Private
 */
export const searchBookings = catchAsync(async (req, res) => {
  const { query, fromDate, toDate } = req.query;
  const { page, limit, skip } = parsePagination(req.query);

  const searchQuery = {
    userId: req.user._id
  };

  // Text search in cities and booking ID
  if (query) {
    searchQuery.$or = [
      { bookingId: { $regex: query, $options: 'i' } },
      { 'pickupLocation.city': { $regex: query, $options: 'i' } },
      { 'dropLocation.city': { $regex: query, $options: 'i' } },
      { 'passengerDetails.name': { $regex: query, $options: 'i' } }
    ];
  }

  // Date range filter
  if (fromDate || toDate) {
    searchQuery.startDateTime = {};
    if (fromDate) searchQuery.startDateTime.$gte = new Date(fromDate);
    if (toDate) searchQuery.startDateTime.$lte = new Date(toDate);
  }

  const bookings = await Booking.find(searchQuery)
    .sort({ startDateTime: -1 })
    .skip(skip)
    .limit(limit)
    .populate('vehicleId', 'type modelName')
    .populate('driverId', 'name rating');

  const total = await Booking.countDocuments(searchQuery);

  logger.info('Bookings search executed', {
    userId: req.user._id,
    query,
    resultsCount: bookings.length
  });

  return sendPaginatedResponse(
    res,
    bookings,
    page,
    limit,
    total,
    'Search results retrieved successfully'
  );
});

/**
 * @desc    Get user's saved addresses
 * @route   GET /api/users/me/addresses
 * @access  Private
 */
export const getSavedAddresses = catchAsync(async (req, res) => {
  // Get unique pickup locations from user's past bookings
  const addresses = await Booking.aggregate([
    { $match: { userId: req.user._id } },
    {
      $group: {
        _id: {
          city: '$pickupLocation.city',
          address: '$pickupLocation.address'
        },
        count: { $sum: 1 },
        lastUsed: { $max: '$createdAt' }
      }
    },
    { $sort: { count: -1 } },
    { $limit: 10 }
  ]);

  const savedAddresses = addresses.map(addr => ({
    city: addr._id.city,
    address: addr._id.address,
    usageCount: addr.count,
    lastUsed: addr.lastUsed
  }));

  logger.info('Saved addresses retrieved', {
    userId: req.user._id,
    count: savedAddresses.length
  });

  return sendSuccess(res, savedAddresses, 'Saved addresses retrieved successfully', 200);
});

/**
 * @desc    Get user's notifications/alerts
 * @route   GET /api/users/me/notifications
 * @access  Private
 */
export const getNotifications = catchAsync(async (req, res) => {
  // Get upcoming trip reminders
  const upcomingTrips = await Booking.find({
    userId: req.user._id,
    startDateTime: {
      $gte: new Date(),
      $lte: new Date(Date.now() + 24 * 60 * 60 * 1000) // Next 24 hours
    },
    status: { $in: [BOOKING_STATUS.CONFIRMED, BOOKING_STATUS.ASSIGNED] }
  }).select('bookingId startDateTime pickupLocation dropLocation status');

  // Get pending ratings
  const pendingRatings = await Booking.find({
    userId: req.user._id,
    status: BOOKING_STATUS.COMPLETED,
    'rating.value': { $exists: false },
    createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } // Last 7 days
  }).select('bookingId startDateTime driverId').limit(5);

  const notifications = {
    upcomingTrips: upcomingTrips.map(trip => ({
      type: 'UPCOMING_TRIP',
      bookingId: trip.bookingId,
      message: `Trip from ${trip.pickupLocation.city} to ${trip.dropLocation.city} scheduled`,
      startTime: trip.startDateTime,
      priority: 'high'
    })),
    pendingRatings: pendingRatings.map(booking => ({
      type: 'PENDING_RATING',
      bookingId: booking.bookingId,
      message: 'Please rate your recent trip',
      priority: 'medium'
    }))
  };

  logger.info('Notifications retrieved', {
    userId: req.user._id,
    upcomingTrips: notifications.upcomingTrips.length,
    pendingRatings: notifications.pendingRatings.length
  });

  return sendSuccess(res, notifications, 'Notifications retrieved successfully', 200);
});

/**
 * @desc    Export user's booking data
 * @route   GET /api/users/me/export
 * @access  Private
 */
export const exportBookingData = catchAsync(async (req, res) => {
  const bookings = await Booking.find({ userId: req.user._id })
    .sort({ createdAt: -1 })
    .populate('vehicleId', 'type modelName')
    .populate('driverId', 'name')
    .select('-metadata -__v')
    .lean();

  // Format data for export
  const exportData = {
    exportedAt: new Date(),
    userInfo: {
      phoneNumber: req.user.phoneNumber,
      name: req.user.name,
      email: req.user.email
    },
    totalBookings: bookings.length,
    bookings: bookings.map(booking => ({
      bookingId: booking.bookingId,
      bookingType: booking.bookingType,
      from: booking.pickupLocation.city,
      to: booking.dropLocation.city,
      date: booking.startDateTime,
      vehicle: booking.vehicleId?.type || 'N/A',
      driver: booking.driverId?.name || 'Not Assigned',
      fare: booking.fareDetails.finalAmount,
      status: booking.status,
      rating: booking.rating?.value || 'Not Rated'
    }))
  };

  logger.info('User data exported', {
    userId: req.user._id,
    bookingsCount: bookings.length
  });

  // Set headers for file download
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="bookings_${req.user.phoneNumber}_${Date.now()}.json"`);

  return res.status(200).json(exportData);
});

export default {
  getMyBookings,
  getUpcomingBookings,
  getPastBookings,
  getActiveBooking,
  getUserStats,
  searchBookings,
  getSavedAddresses,
  getNotifications,
  exportBookingData
};