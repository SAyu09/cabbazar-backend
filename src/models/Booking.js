import mongoose from 'mongoose';

const locationSchema = new mongoose.Schema({
  city: {
    type: String,
    required: [true, 'City is required'],
    trim: true
  },
  address: {
    type: String,
    required: [true, 'Address is required'],
    trim: true
  },
  coordinates: {
    type: {
      type: String,
      enum: ['Point'],
      default: 'Point'
    },
    coordinates: {
      type: [Number],
      default: undefined
    }
  }
}, { _id: false });

const passengerSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Passenger name is required'],
    trim: true
  },
  phone: {
    type: String,
    required: [true, 'Passenger phone is required'],
    match: [/^[0-9]{10}$/, 'Please provide valid phone number']
  },
  email: {
    type: String,
    match: [/^\S+@\S+\.\S+$/, 'Please provide valid email'],
    lowercase: true
  }
}, { _id: false });

const fareSchema = new mongoose.Schema({
  baseFare: {
    type: Number,
    required: [true, 'Base fare is required']
  },
  distance: {
    type: Number,
    required: [true, 'Distance is required']
  },
  gst: {
    type: Number,
    required: [true, 'GST is required']
  },
  tollCharges: {
    type: Number,
    default: 0
  },
  finalAmount: {
    type: Number,
    required: [true, 'Final amount is required']
  }
}, { _id: false });

const bookingSchema = new mongoose.Schema({
  bookingId: {
    type: String,
    unique: true
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'User is required']
  },
  bookingType: {
    type: String,
    enum: ['ONE_WAY', 'ROUND_TRIP', 'RENTAL'],
    required: [true, 'Booking type is required']
  },
  status: {
    type: String,
    enum: ['PENDING', 'CONFIRMED', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'],
    default: 'PENDING'
  },
  pickupLocation: {
    type: locationSchema,
    required: [true, 'Pickup location is required']
  },
  dropLocation: {
    type: locationSchema,
    required: [true, 'Drop location is required']
  },
  startDateTime: {
    type: Date,
    required: [true, 'Start date & time is required']
  },
  endDateTime: {
    type: Date
  },
  vehicleType: {
    type: String,
    enum: ['HATCHBACK', 'SEDAN', 'SUV', 'LUXURY'],
    required: [true, 'Vehicle type is required']
  },
  driver: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Driver'
  },
  vehicle: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Vehicle'
  },
  passengerDetails: {
    type: passengerSchema,
    required: [true, 'Passenger details are required']
  },
  fareDetails: {
    type: fareSchema,
    required: [true, 'Fare details are required']
  },
  paymentStatus: {
    type: String,
    enum: ['PENDING', 'COMPLETED', 'FAILED', 'REFUNDED'],
    default: 'PENDING'
  },
  paymentMethod: {
    type: String,
    enum: ['CASH', 'ONLINE'],
    default: 'CASH'
  },
  cancelledBy: {
    type: String,
    enum: ['USER', 'DRIVER', 'ADMIN'],
  },
  cancellationReason: String,
  rating: {
    type: Number,
    min: 1,
    max: 5
  },
  feedback: String
}, {
  timestamps: true
});

// Generate unique booking ID before saving
bookingSchema.pre('save', async function(next) {
  if (!this.bookingId) {
    const count = await mongoose.model('Booking').countDocuments();
    this.bookingId = `CB${Date.now().toString().slice(-6)}${count}`;
  }
  next();
});

// Index for geospatial queries
bookingSchema.index({ 'pickupLocation.coordinates': '2dsphere' });
bookingSchema.index({ 'dropLocation.coordinates': '2dsphere' });

// Index for common queries
bookingSchema.index({ user: 1, status: 1 });
bookingSchema.index({ bookingId: 1 });
bookingSchema.index({ startDateTime: 1 });

const Booking = mongoose.model('Booking', bookingSchema);

export default Booking;