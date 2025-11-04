// src/models/index.js
import mongoose from 'mongoose';
import logger from '../config/logger.js';

// Import all models
import User from './User.js';
import Vehicle from './Vehicle.js';
import Booking from './Booking.js';
import { Otp } from './Otp.js';
// Import any other models you have

// Log registered models
const registeredModels = mongoose.modelNames();
logger.info('Mongoose models registered:', { models: registeredModels });

// Export all models
export { User, Vehicle, Booking, Otp };

export default {
    User,
    Vehicle,
    Booking,
    Otp,
};