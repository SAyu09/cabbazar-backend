// ===============================================

// src/models/Driver.js - Complete Driver Model
const driverSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Driver name is required'],
    trim: true
  },
  phoneNumber: {
    type: String,
    required: [true, 'Phone number is required'],
    unique: true,
    match: [/^[6-9]\d{9}$/, 'Invalid phone number']
  },
  email: {
    type: String,
    trim: true,
    lowercase: true
  },
  licenseNumber: {
    type: String,
    required: [true, 'License number is required'],
    unique: true,
    uppercase: true
  },
  licenseExpiry: {
    type: Date,
    required: [true, 'License expiry date is required']
  },
  rating: {
    type: Number,
    default: 5.0,
    min: 0,
    max: 5
  },
  totalRides: {
    type: Number,
    default: 0
  },
  completedRides: {
    type: Number,
    default: 0
  },
  cancelledRides: {
    type: Number,
    default: 0
  },
  isAvailable: {
    type: Boolean,
    default: true,
    index: true
  },
  isVerified: {
    type: Boolean,
    default: false
  },
  vehicleId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Vehicle'
  },
  address: {
    street: String,
    city: String,
    state: String,
    pincode: String
  },
  documents: {
    license: String,
    aadhar: String,
    photo: String,
    bankDetails: {
      accountNumber: String,
      ifscCode: String,
      accountHolderName: String
    }
  },
  emergencyContact: {
    name: String,
    phone: String,
    relation: String
  },
  earnings: {
    today: { type: Number, default: 0 },
    thisWeek: { type: Number, default: 0 },
    thisMonth: { type: Number, default: 0 },
    total: { type: Number, default: 0 }
  },
  currentLocation: {
    coordinates: {
      lat: Number,
      lng: Number
    },
    updatedAt: Date
  }
}, {
  timestamps: true
});

driverSchema.index({ isAvailable: 1 });
driverSchema.index({ licenseNumber: 1 });
driverSchema.index({ phoneNumber: 1 });
driverSchema.index({ rating: -1 });

driverSchema.methods.updateRating = async function(newRating) {
  const totalRatings = this.completedRides;
  this.rating = ((this.rating * totalRatings) + newRating) / (totalRatings + 1);
  return this.save();
};

driverSchema.methods.updateLocation = async function(lat, lng) {
  this.currentLocation = {
    coordinates: { lat, lng },
    updatedAt: new Date()
  };
  return this.save({ validateBeforeSave: false });
};

const Driver = mongoose.model('Driver', driverSchema);

export default { Driver };