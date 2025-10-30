// src/models/Booking.js - Corrected Schema
import mongoose from 'mongoose';
import {
  BOOKING_TYPES,
  BOOKING_STATUS,
  VEHICLE_TYPES,
  USER_ROLES,
  PAYMENT_STATUS,
  PAYMENT_METHODS,
  TAX_CONFIG // Added for use in discount calculation logic if needed later
} from '../config/constants.js'; // Import constants
import { generateBookingReference, calculateGST } from '../utils/helpers.js'; // Import helpers

// ------------------ Sub-schemas ------------------

const locationSchema = new mongoose.Schema({
  city: {
    type: String,
    required: [true, 'City is required'],
    trim: true,
  },
  address: { // Address is optional now, but city is required
    type: String,
    trim: true,
  },
  coordinates: { // Coordinates object is optional
    type: {
      type: String,
      enum: ['Point'],
      // default: 'Point' // Default might cause issues if coordinates array is missing
    },
    coordinates: { // Array is required ONLY IF coordinates object exists
      type: [Number], // [longitude, latitude]
       // index: '2dsphere' // Index should be on the main schema field
    },
  },
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
    // Use a stricter regex or validator library if needed
    match: [/^[6-9]\d{9}$/, 'Please provide a valid 10-digit Indian phone number'],
  },
  email: {
    type: String,
    trim: true,
    lowercase: true,
    match: [/\S+@\S+\.\S+/, 'Please provide a valid email address'], // Basic email format
    // Consider adding unique: true if emails must be unique across passengers (unlikely needed here)
  },
}, { _id: false });

const fareSchema = new mongoose.Schema({
  // Fields coming from Pricing Service
  vehicleType: { type: String, enum: Object.values(VEHICLE_TYPES) }, // Store vehicle type pricing was based on
  bookingType: { type: String, enum: Object.values(BOOKING_TYPES) }, // Store booking type pricing was based on
  baseFare: { type: Number, required: true, min: 0 },
  distance: { type: Number, min: 0 }, // Optional for packages, required for others in context
  duration: { type: Number, min: 0 }, // For local packages
  nightCharges: { type: Number, default: 0, min: 0 },
  isNightTime: { type: Boolean },
  subtotal: { type: Number, required: true, min: 0 }, // baseFare + nightCharges (+ extras for local) BEFORE GST & Discount
  gst: { type: Number, required: true, min: 0 },
  gstRate: { type: String }, // e.g., "5%"
  totalFare: { type: Number, required: true, min: 0 }, // Often subtotal + gst (BEFORE discount)
  finalAmount: { type: Number, required: true, min: 0 }, // The final payable amount after GST and discounts

  // Optional fields from Pricing Service or added later
  perKmRate: { type: Number, min: 0 },
  minFareApplied: { type: Boolean },
  estimatedTravelTime: { type: String },
  packageType: { type: String }, // e.g., '8_80'
  includedDistance: { type: Number },
  includedDuration: { type: Number },
  extraKm: { type: Number },
  extraHours: { type: Number },
  extraKmCharge: { type: Number },
  extraHourCharge: { type: Number },
  extraKmRate: { type: Number },
  extraHourRate: { type: Number },
  tollCharges: { type: Number, default: 0, min: 0 }, // Can be added later
  parkingCharges: { type: Number, default: 0, min: 0 }, // Can be added later
  driverAllowance: { type: Number, default: 0, min: 0 }, // Sometimes included in base, sometimes separate

  // Discount fields
  discountCode: { type: String, trim: true, uppercase: true },
  discountAmount: { type: Number, default: 0, min: 0 },
  discountType: { type: String, enum: ['PERCENTAGE', 'FIXED', null] },

}, { _id: false });

// Schema for cancellation details
const cancellationSchema = new mongoose.Schema({
  cancelledBy: {
    type: String,
    enum: Object.values(USER_ROLES).concat('USER'), // Ensure 'USER' is valid
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

// Schema for rating
const ratingSchema = new mongoose.Schema({
  value: {
    type: Number,
    required: true,
    min: 1,
    max: 5,
  },
  comment: { type: String, maxlength: 500 },
  createdAt: { // Renamed from ratedAt to match controller logic
    type: Date,
    default: Date.now
  }
}, { _id: false });

// Schema for trip details (populated during/after trip)
const tripSchema = new mongoose.Schema({
  actualStartTime: Date,
  actualEndTime: Date,
  actualDistance: { type: Number, min: 0 },
  startOdometer: { type: Number, min: 0 },
  endOdometer: { type: Number, min: 0 },
  startLocation: { // GeoJSON Point for actual start
      type: { type: String, enum: ['Point'] },
      coordinates: { type: [Number] } // [lng, lat]
  },
  endLocation: { // GeoJSON Point for actual end
      type: { type: String, enum: ['Point'] },
      coordinates: { type: [Number] } // [lng, lat]
  },
  routePoints: { // Optional: Store route polyline or key points
      type: { type: String, enum: ['LineString'] },
      coordinates: [[Number]] // Array of [lng, lat] pairs
  },
  waitingTimeMinutes: { type: Number, default: 0, min: 0 }
}, { _id: false });

// Schema for metadata
const metadataSchema = new mongoose.Schema({
  source: { type: String, default: 'API' }, // e.g., 'WEB', 'APP', 'API'
  ipAddress: String,
  userAgent: String,
  searchId: String // Link back to the search result used
}, { _id: false });


// ------------------ Main Booking Schema ------------------
const bookingSchema = new mongoose.Schema({
  bookingId: { // User-facing readable ID
    type: String,
    unique: true,
    //required: true, // Generated by hook, so required
    index: true,
  },
  userId: { // Link to the User who booked
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
    default: BOOKING_STATUS.PENDING, // Start as PENDING until confirmed/paid? Or CONFIRMED if payment is immediate?
    index: true,
  },
  pickupLocation: {
    type: locationSchema,
    required: [true, 'Pickup location is required'],
  },
  dropLocation: {
    type: locationSchema,
    // Drop location might not be required for local rentals initially
    required: function() { return this.bookingType !== BOOKING_TYPES.LOCAL_8_80 && this.bookingType !== BOOKING_TYPES.LOCAL_12_120; },
  },
  startDateTime: { // Scheduled start time
    type: Date,
    required: [true, 'Start date & time is required'],
    index: true,
  },
  endDateTime: { // Scheduled end time (mainly for round trips/rentals)
    type: Date,
    // Validate endDateTime > startDateTime if both provided
    validate: [
        function(value) {
            // End date is optional, but if provided, must be after start date
            return !value || !this.startDateTime || value > this.startDateTime;
        },
        'End date/time must be after start date/time'
    ]
  },
  vehicleType: { // Requested/Assigned vehicle category
    type: String,
    enum: {
        values: Object.values(VEHICLE_TYPES),
        message: 'Invalid vehicle type: {VALUE}'
    },
    required: [true, 'Vehicle type is required'],
  },
  driverId: { // Assigned Driver
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Driver',
    index: true, // Index for finding driver's bookings
    default: null
  },
  vehicleId: { // Assigned Vehicle
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
  paymentStatus: {
    type: String,
    enum: Object.values(PAYMENT_STATUS),
    default: PAYMENT_STATUS.PENDING,
  },
  paymentMethod: {
    type: String,
    enum: Object.values(PAYMENT_METHODS),
    default: PAYMENT_METHODS.CASH, // Or maybe null until specified?
  },
  paymentTransactionId: { type: String, index: true }, // Store ID from payment gateway

  // Subdocuments added based on controller/seeder
  cancellation: { type: cancellationSchema, default: null },
  rating: { type: ratingSchema, default: null },
  trip: { type: tripSchema, default: null },
  metadata: { type: metadataSchema },

  // Other optional fields
  specialRequests: { type: [String], default: [] },
  notes: { type: String, trim: true, maxlength: 500 },
  promoCodeApplied: { type: String }, // Maybe move promo details into fareDetails?


}, {
  timestamps: true, // Adds createdAt and updatedAt
  toJSON: { virtuals: true }, // Include virtuals when converting to JSON
  toObject: { virtuals: true } // Include virtuals when converting to Object
});

// ------------------ Hooks ------------------

// Generate unique booking ID before saving
bookingSchema.pre('save', async function (next) {
  if (this.isNew && !this.bookingId) { // Only generate if new and not already set
    // Use the helper function for consistency
    this.bookingId = generateBookingReference();
  }
  // Ensure endDateTime logic if needed for certain types
  if ((this.bookingType === BOOKING_TYPES.LOCAL_8_80 || this.bookingType === BOOKING_TYPES.LOCAL_12_120) && !this.endDateTime && this.startDateTime) {
       const durationHours = this.bookingType === BOOKING_TYPES.LOCAL_8_80 ? 8 : 12;
       this.endDateTime = new Date(this.startDateTime.getTime() + durationHours * 60 * 60 * 1000);
   }

  next();
});

// ------------------ Indexes ------------------
// Add GeoSpatial indexes on the main schema fields
bookingSchema.index({ 'pickupLocation.coordinates': '2dsphere' });
bookingSchema.index({ 'dropLocation.coordinates': '2dsphere' });
// Compound index for common user queries
bookingSchema.index({ userId: 1, status: 1, startDateTime: -1 });
// Index for driver queries
bookingSchema.index({ driverId: 1, status: 1, startDateTime: -1 });
// Index for finding bookings by date range
bookingSchema.index({ startDateTime: 1, status: 1 });


// ------------------ Virtuals ------------------
bookingSchema.virtual('tripDurationMinutes').get(function() {
    if (this.trip?.actualStartTime && this.trip?.actualEndTime) {
        return Math.round((this.trip.actualEndTime - this.trip.actualStartTime) / (1000 * 60));
    }
    // Estimate based on scheduled times if trip not completed
    if(this.startDateTime && this.endDateTime) {
         return Math.round((this.endDateTime - this.startDateTime) / (1000 * 60));
    }
    return null;
});


// ------------------ Model Export ------------------
const Booking = mongoose.model('Booking', bookingSchema);
export default Booking;
