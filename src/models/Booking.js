// src/models/Booking.js - FIXED VERSION with Payment Ref
import mongoose from 'mongoose';
import {
  BOOKING_TYPES,
  BOOKING_STATUS,
  VEHICLE_TYPES,
  USER_ROLES,
  // PAYMENT_STATUS, // <-- REMOVED
  // PAYMENT_METHODS, // <-- REMOVED
  TAX_CONFIG
} from '../config/constants.js';
import { generateBookingReference } from '../utils/helpers.js';

// ------------------ Sub-schemas ------------------

// Kept your new simplified location schema
const locationSchema = new mongoose.Schema({
  city: {
    type: String,
    required: [true, 'City is required'],
    trim: true,
  },
  address: {
    type: String,
    trim: true,
  },
  lat: {
    type: Number,
    min: -90,
    max: 90
  },
  lng: {
    type: Number,
    min: -180,
    max: 180
  }
}, { _id: false });

const passengerSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Passenger name is required'],
    trim: true,
    minlength: 2,
    maxlength: 100
  },
  phone: {
    type: String,
    required: [true, 'Passenger phone is required'],
    match: [/^[6-9]\d{9}$/, 'Please provide a valid 10-digit Indian phone number'],
  },
  email: {
    type: String,
    trim: true,
    lowercase: true,
    match: [/\S+@\S+\.\S+/, 'Please provide a valid email address'],
  },
}, { _id: false });

const fareSchema = new mongoose.Schema({
  vehicleType: { type: String, enum: Object.values(VEHICLE_TYPES) },
  bookingType: { type: String, enum: Object.values(BOOKING_TYPES) },
  baseFare: { type: Number, required: true, min: 0 },
  distance: { type: Number, min: 0 },
  duration: { type: Number, min: 0 },
  nightCharges: { type: Number, default: 0, min: 0 },
  isNightTime: { type: Boolean },
  subtotal: { type: Number, required: true, min: 0 },
  gst: { type: Number, required: true, min: 0 },
  gstRate: { type: String },
  totalFare: { type: Number, required: true, min: 0 },
  finalAmount: { type: Number, required: true, min: 0 },
  perKmRate: { type: Number, min: 0 },
  minFareApplied: { type: Boolean },
  estimatedTravelTime: { type: String },
  packageType: { type: String },
  includedDistance: { type: Number },
  includedDuration: { type: Number },
  extraKm: { type: Number },
  extraHours: { type: Number },
  extraKmCharge: { type: Number },
  extraHourCharge: { type: Number },
  extraKmRate: { type: Number },
  extraHourRate: { type: Number },
  tollCharges: { type: Number, default: 0, min: 0 },
  parkingCharges: { type: Number, default: 0, min: 0 },
  driverAllowance: { type: Number, default: 0, min: 0 },
  discountCode: { type: String, trim: true, uppercase: true },
  discountAmount: { type: Number, default: 0, min: 0 },
  discountType: { type: String, enum: ['PERCENTAGE', 'FIXED', null] },
}, { _id: false });

const cancellationSchema = new mongoose.Schema({
  cancelledBy: {
    type: String,
    enum: Object.values(USER_ROLES).concat('USER'),
  },
  cancelledAt: {
    type: Date,
    default: Date.now
  },
  reason: { type: String, maxlength: 200 },
  charge: {
    type: Number,
    default: 0,
    min: 0
  }
}, { _id: false });

const ratingSchema = new mongoose.Schema({
  value: {
    type: Number,
    required: true,
    min: 1,
    max: 5,
  },
  comment: { type: String, maxlength: 500 },
  createdAt: {
    type: Date,
    default: Date.now
  }
}, { _id: false });

const tripSchema = new mongoose.Schema({
  actualStartTime: Date,
  actualEndTime: Date,
  actualDistance: { type: Number, min: 0 },
  startOdometer: { type: Number, min: 0 },
  endOdometer: { type: Number, min: 0 },
  startLocation: {
    lat: Number,
    lng: Number
  },
  endLocation: {
    lat: Number,
    lng: Number
  },
  waitingTimeMinutes: { type: Number, default: 0, min: 0 }
}, { _id: false });

const metadataSchema = new mongoose.Schema({
  source: { type: String, default: 'API' },
  ipAddress: String,
  userAgent: String,
  searchId: String
}, { _id: false });

// ------------------ Main Booking Schema ------------------

const bookingSchema = new mongoose.Schema({
  bookingId: {
    type: String,
    unique: true,
    index: true,
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'User ID is required'],
    index: true,
  },
  bookingType: {
    type: String,
    enum: {
      values: Object.values(BOOKING_TYPES),
      message: 'Invalid booking type: {VALUE}'
    },
    required: [true, 'Booking type is required'],
  },
  status: {
    type: String,
    enum: {
      values: Object.values(BOOKING_STATUS),
      message: 'Invalid status: {VALUE}'
    },
    default: BOOKING_STATUS.PENDING,
    index: true,
  },
  pickupLocation: {
    type: locationSchema,
    required: [true, 'Pickup location is required'],
  },
  dropLocation: {
    type: locationSchema,
    required: function () {
      const localTypes = [
        BOOKING_TYPES.LOCAL_2_20,
        BOOKING_TYPES.LOCAL_4_40,
        BOOKING_TYPES.LOCAL_8_80,
        BOOKING_TYPES.LOCAL_12_120
      ];
      return !localTypes.includes(this.bookingType);
    },
  },
  startDateTime: {
    type: Date,
    required: [true, 'Start date & time is required'],
    index: true,
  },
  endDateTime: {
    type: Date,
    validate: [
      function (value) {
        return !value || !this.startDateTime || value > this.startDateTime;
      },
      'End date/time must be after start date/time'
    ]
  },
  vehicleType: {
    type: String,
    enum: {
      values: Object.values(VEHICLE_TYPES),
      message: 'Invalid vehicle type: {VALUE}'
    },
    required: [true, 'Vehicle type is required'],
  },
  driverId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Driver', // This correctly refs 'Driver'
    index: true,
    default: null
  },
  vehicleId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Vehicle',
    default: null
  },
  passengerDetails: {
    type: passengerSchema,
    required: [true, 'Passenger details are required'],
  },
  fareDetails: {
    type: fareSchema,
    required: [true, 'Fare details are required'],
  },
  
  // --- PAYMENT FIELDS MODIFIED ---
  paymentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Payment',
    default: null,
  },
  // --- OLD FIELDS REMOVED ---
  // paymentStatus: { ... },
  // paymentMethod: { ... },
  // paymentTransactionId: { ... },

  cancellation: { type: cancellationSchema, default: null },
  rating: { type: ratingSchema, default: null },
  trip: { type: tripSchema, default: null },
  metadata: { type: metadataSchema },
  specialRequests: { type: [String], default: [] },
  notes: { type: String, trim: true, maxlength: 500 },
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// ------------------ Hooks ------------------
// (Your existing hooks are perfect)
bookingSchema.pre('save', async function (next) {
  if (this.isNew && !this.bookingId) {
    this.bookingId = generateBookingReference();
  }
  if ([
    BOOKING_TYPES.LOCAL_2_20,
    BOOKING_TYPES.LOCAL_4_40,
    BOOKING_TYPES.LOCAL_8_80,
    BOOKING_TYPES.LOCAL_12_120
  ].includes(this.bookingType) && !this.endDateTime && this.startDateTime) {
    let durationHours;
    switch (this.bookingType) {
      case BOOKING_TYPES.LOCAL_2_20: durationHours = 2; break;
      case BOOKING_TYPES.LOCAL_4_40: durationHours = 4; break;
      case BOOKING_TYPES.LOCAL_8_80: durationHours = 8; break;
      case BOOKING_TYPES.LOCAL_12_120: durationHours = 12; break;
    }
    this.endDateTime = new Date(this.startDateTime.getTime() + durationHours * 60 * 60 * 1000);
  }
  next();
});

// ------------------ Indexes ------------------
// (Kept your indexes)
bookingSchema.index({ 'pickupLocation.lat': 1, 'pickupLocation.lng': 1 });
bookingSchema.index({ 'dropLocation.lat': 1, 'dropLocation.lng': 1 });
bookingSchema.index({ userId: 1, status: 1, startDateTime: -1 });
bookingSchema.index({ driverId: 1, status: 1, startDateTime: -1 });
bookingSchema.index({ startDateTime: 1, status: 1 });

// ------------------ Virtuals ------------------
// (Kept your virtuals)
bookingSchema.virtual('tripDurationMinutes').get(function () {
  if (this.trip?.actualStartTime && this.trip?.actualEndTime) {
    return Math.round((this.trip.actualEndTime - this.trip.actualStartTime) / (1000 * 60));
  }
  if (this.startDateTime && this.endDateTime) {
    return Math.round((this.endDateTime - this.startDateTime) / (1000 * 60));
  }
  return null;
});

// ------------------ Model Export ------------------
const Booking = mongoose.model('Booking', bookingSchema);
export default Booking;

