// src/models/Vehicle.js - Complete Vehicle Model
import mongoose from 'mongoose';
import { VEHICLE_TYPES } from '../config/constants.js';

const vehicleSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: Object.values(VEHICLE_TYPES),
    required: [true, 'Vehicle type is required']
  },
  modelName: {
    type: String,
    required: [true, 'Model name is required'],
    trim: true
  },
  licensePlate: {
    type: String,
    required: [true, 'License plate is required'],
    unique: true,
    uppercase: true,
    trim: true
  },
  capacity: {
    type: Number,
    required: true,
    min: [2, 'Capacity must be at least 2'],
    max: [7, 'Capacity cannot exceed 7']
  },
  isAvailable: {
    type: Boolean,
    default: true,
    index: true
  },
  features: [String],
  year: {
    type: Number,
    min: [2010, 'Vehicle year must be 2010 or later'],
    max: [new Date().getFullYear() + 1, 'Invalid vehicle year']
  },
  color: String,
  fuelType: {
    type: String,
    enum: ['PETROL', 'DIESEL', 'CNG', 'ELECTRIC', 'HYBRID'],
    default: 'DIESEL'
  },
  insurance: {
    policyNumber: String,
    expiryDate: Date,
    provider: String
  },
  documents: {
    rcCopy: String,
    insuranceCopy: String,
    pollutionCertificate: String,
    fitnessExpiry: Date
  },
  maintenance: {
    lastService: Date,
    nextServiceDue: Date,
    totalKm: { type: Number, default: 0 }
  }
}, {
  timestamps: true
});

vehicleSchema.index({ type: 1, isAvailable: 1 });
vehicleSchema.index({ licensePlate: 1 });

vehicleSchema.methods.checkAvailability = function(startDate, endDate) {
  // Logic to check if vehicle is available between dates
  // This would query Booking model to check for conflicts
  return this.isAvailable;
};

const Vehicle = mongoose.model('Vehicle', vehicleSchema);

export default Vehicle;