// src/utils/seedData.js - Updated for new Vehicle Types and Pricing
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import Vehicle from '../models/Vehicle.js';
import Driver from '../models/Driver.js';
import User from '../models/User.js';
import Booking from '../models/Booking.js';
import Payment from '../models/Payment.js';
import {
  VEHICLE_TYPES,
  BOOKING_TYPES,
  BOOKING_STATUS,
  PAYMENT_STATUS,
  PAYMENT_METHODS
} from '../config/constants.js';
import logger from '../config/logger.js';

dotenv.config();

// ============================================
// DATABASE CONNECTION
// ============================================

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    logger.info('✅ MongoDB Connected for seeding');
  } catch (error) {
    logger.error('❌ MongoDB connection failed:', error);
    process.exit(1);
  }
};

// ============================================
// SAMPLE VEHICLE DATA (NEW)
// ============================================

const vehicles = [
  // ========== HATCHBACK ==========
  {
    type: VEHICLE_TYPES.HATCHBACK,
    modelName: 'Maruti Swift',
    licensePlate: 'DL01CA1234',
    capacity: 4,
    isAvailable: true,
    features: ['AC', 'Music System'],
    year: 2023,
    color: 'White',
    fuelType: 'PETROL'
  },
  {
    type: VEHICLE_TYPES.HATCHBACK,
    modelName: 'Hyundai i20',
    licensePlate: 'DL02CB5678',
    capacity: 4,
    isAvailable: true,
    features: ['AC', 'Music System', 'GPS'],
    year: 2022,
    color: 'Red',
    fuelType: 'PETROL'
  },
  
  // ========== SEDAN ==========
  {
    type: VEHICLE_TYPES.SEDAN,
    modelName: 'Maruti Ciaz',
    licensePlate: 'DL03SA9012',
    capacity: 4,
    isAvailable: true,
    features: ['AC', 'Music System', 'GPS Navigation'],
    year: 2023,
    color: 'Silver',
    fuelType: 'PETROL'
  },
  {
    type: VEHICLE_TYPES.SEDAN,
    modelName: 'Honda City',
    licensePlate: 'DL04SD3456',
    capacity: 4,
    isAvailable: true,
    features: ['AC', 'Music System', 'GPS Navigation', 'Sunroof'],
    year: 2024,
    color: 'Black',
    fuelType: 'PETROL'
  },

  // ========== SUV (ERTIGA) ==========
  {
    type: VEHICLE_TYPES.SUV_ERTIGA,
    modelName: 'Maruti Ertiga',
    licensePlate: 'DL05SE1111',
    capacity: 6,
    isAvailable: true,
    features: ['AC', 'Music System', '6+1 Seating'],
    year: 2023,
    color: 'Blue',
    fuelType: 'DIESEL'
  },

  // ========== SUV (CARENS) ==========
  {
    type: VEHICLE_TYPES.SUV_CARENS,
    modelName: 'Kia Carens',
    licensePlate: 'DL06SC2222',
    capacity: 6,
    isAvailable: true,
    features: ['AC', 'Music System', 'Sunroof', '6+1 Seating'],
    year: 2024,
    color: 'White',
    fuelType: 'DIESEL'
  },

  // ========== SUV (INOVA) ==========
  {
    type: VEHICLE_TYPES.SUV_INOVA,
    modelName: 'Toyota Innova Crysta',
    licensePlate: 'DL07SI3333',
    capacity: 6,
    isAvailable: true,
    features: ['AC', 'Music System', 'Captain Seats', '6+1 Seating'],
    year: 2023,
    color: 'Grey',
    fuelType: 'DIESEL'
  },
  {
    type: VEHICLE_TYPES.SUV_INOVA_6_1,
    modelName: 'Toyota Innova (6+1)',
    licensePlate: 'DL08SI4444',
    capacity: 6,
    isAvailable: true,
    features: ['AC', 'Music System', '6+1 Seating'],
    year: 2022,
    color: 'Silver',
    fuelType: 'DIESEL'
  },
  {
    type: VEHICLE_TYPES.SUV_INOVA_7_1,
    modelName: 'Toyota Innova (7+1)',
    licensePlate: 'DL09SI5555',
    capacity: 7,
    isAvailable: true,
    features: ['AC', 'Music System', '7+1 Seating'],
    year: 2023,
    color: 'White',
    fuelType: 'DIESEL'
  },

  // ========== SUV (INOVA PREMIUM) ==========
  {
    type: VEHICLE_TYPES.SUV_INOVA_PREMIUM,
    modelName: 'Toyota Innova Hycross',
    licensePlate: 'DL10SP6666',
    capacity: 6,
    isAvailable: true,
    features: ['AC', 'Music System', 'Sunroof', 'Leather Seats', 'Premium'],
    year: 2024,
    color: 'Black',
    fuelType: 'HYBRID'
  },

  // ========== TRAVELLER ==========
  {
    type: VEHICLE_TYPES.TRAVELLER_12_1,
    modelName: 'Force Traveller (12+1)',
    licensePlate: 'DL11T7777',
    capacity: 12,
    isAvailable: true,
    features: ['AC', 'Music System', '12+1 Seating'],
    year: 2023,
    color: 'White',
    fuelType: 'DIESEL'
  },
  {
    type: VEHICLE_TYPES.TRAVELLER_17_1,
    modelName: 'Force Traveller (17+1)',
    licensePlate: 'DL12T8888',
    capacity: 17,
    isAvailable: true,
    features: ['AC', 'Music System', '17+1 Seating'],
    year: 2023,
    color: 'White',
    fuelType: 'DIESEL'
  },
  
  // ========== TRAVELLER MAHARAJA ==========
  {
    type: VEHICLE_TYPES.TRAVELLER_MAHARAJA_12_1,
    modelName: 'Maharaja Traveller (12+1)',
    licensePlate: 'DL13M9999',
    capacity: 12,
    isAvailable: true,
    features: ['AC', 'Music System', 'Reclining Seats', 'Premium Interior'],
    year: 2024,
    color: 'Silver',
    fuelType: 'DIESEL'
  },
];

// ============================================
// SAMPLE DRIVER DATA (Shortened for brevity)
// ============================================

const drivers = [
  // Drivers for new vehicles
  { name: 'Rajesh Kumar', phoneNumber: '9876543210', licenseNumber: 'DL1234567890', licenseExpiry: new Date('2028-12-31'), rating: 4.8, isAvailable: true, isVerified: true },
  { name: 'Amit Singh', phoneNumber: '9876543211', licenseNumber: 'DL1234567891', licenseExpiry: new Date('2027-06-30'), rating: 4.9, isAvailable: true, isVerified: true },
  { name: 'Suresh Sharma', phoneNumber: '9876543212', licenseNumber: 'DL1234567892', licenseExpiry: new Date('2029-03-15'), rating: 4.7, isAvailable: true, isVerified: true },
  { name: 'Manoj Tiwari', phoneNumber: '9876543213', licenseNumber: 'DL1234567893', licenseExpiry: new Date('2028-02-14'), rating: 4.9, isAvailable: true, isVerified: true },
  { name: 'Vijay Verma', phoneNumber: '9876543214', licenseNumber: 'DL1234567894', licenseExpiry: new Date('2028-09-20'), rating: 5.0, isAvailable: true, isVerified: true },
  { name: 'Anil Gupta', phoneNumber: '9876543215', licenseNumber: 'DL1234567895', licenseExpiry: new Date('2029-05-25'), rating: 4.9, isAvailable: true, isVerified: true },
  { name: 'Rakesh Malhotra', phoneNumber: '9876543216', licenseNumber: 'DL1234567896', licenseExpiry: new Date('2028-11-10'), rating: 4.8, isAvailable: true, isVerified: true },
  { name: 'Ramesh Yadav', phoneNumber: '9876543217', licenseNumber: 'DL1234567897', licenseExpiry: new Date('2027-11-10'), rating: 4.6, isAvailable: true, isVerified: true },
  { name: 'Deepak Chauhan', phoneNumber: '9876543218', licenseNumber: 'DL1234567898', licenseExpiry: new Date('2027-08-30'), rating: 4.7, isAvailable: true, isVerified: true },
  { name: 'Sanjay Mishra', phoneNumber: '9876543219', licenseNumber: 'DL1234567899', licenseExpiry: new Date('2028-04-15'), rating: 4.8, isAvailable: true, isVerified: true },
  { name: 'Prakash Joshi', phoneNumber: '9876543220', licenseNumber: 'DL1234567900', licenseExpiry: new Date('2029-01-20'), rating: 4.9, isAvailable: true, isVerified: true },
  { name: 'Ashok Pandey', phoneNumber: '9876543221', licenseNumber: 'DL1234567901', licenseExpiry: new Date('2027-07-10'), rating: 4.5, isAvailable: true, isVerified: true },
  { name: 'Mukesh Sharma', phoneNumber: '9876543222', licenseNumber: 'DL1234567902', licenseExpiry: new Date('2028-03-25'), rating: 4.6, isAvailable: true, isVerified: true }
];

// ============================================
// SAMPLE USER DATA (Unchanged)
// ============================================

const sampleUsers = [
  { phoneNumber: '9999999991', name: 'Test User 1', email: 'testuser1@example.com', isVerified: true, isActive: true, role: 'CUSTOMER', address: { street: 'Connaught Place', city: 'Delhi', state: 'Delhi', pincode: '110001' } },
  { phoneNumber: '9999999992', name: 'Test User 2', email: 'testuser2@example.com', isVerified: true, isActive: true, role: 'CUSTOMER', address: { street: 'Nehru Place', city: 'Delhi', state: 'Delhi', pincode: '110019' } },
  { phoneNumber: '9999999993', name: 'Test User 3', email: 'testuser3@example.com', isVerified: true, isActive: true, role: 'CUSTOMER' }
];

// ============================================
// SEEDER FUNCTIONS
// ============================================

/**
 * Clear all data from collections
 */
const clearData = async () => {
  try {
    await Payment.deleteMany({});
    await Vehicle.deleteMany({});
    await Driver.deleteMany({});
    await User.deleteMany({});
    await Booking.deleteMany({});
    logger.info('🗑️  All data cleared successfully (including Payments)');
  } catch (error) {
    logger.error('Error clearing data:', error);
    throw error;
  }
};

/**
 * Seed vehicles
 */
const seedVehicles = async () => {
  try {
    const createdVehicles = await Vehicle.insertMany(vehicles);
    logger.info(`✅ ${createdVehicles.length} vehicles seeded`);
    const summary = createdVehicles.reduce((acc, v) => {
      acc[v.type] = (acc[v.type] || 0) + 1;
      return acc;
    }, {});
    logger.info('Vehicle summary by type:', summary);
    return createdVehicles;
  } catch (error) {
    logger.error('Error seeding vehicles:', error);
    throw error;
  }
};

/**
 * Seed drivers and assign vehicles
 */
const seedDrivers = async (vehicles) => {
  try {
    const driversWithVehicles = drivers.map((driver, index) => ({
      ...driver,
      // Assign vehicles sequentially
      vehicleId: vehicles[index % vehicles.length]._id 
    }));

    const createdDrivers = await Driver.insertMany(driversWithVehicles);
    logger.info(`✅ ${createdDrivers.length} drivers seeded`);
    return createdDrivers;
  } catch (error) {
    logger.error('Error seeding drivers:', error);
    throw error;
  }
};

/**
 * Seed sample users
 */
const seedUsers = async () => {
  try {
    const createdUsers = await User.insertMany(sampleUsers);
    logger.info(`✅ ${createdUsers.length} sample users seeded`);
    return createdUsers;
  } catch (error) {
    logger.error('Error seeding users:', error);
    throw error;
  }
};

/**
 * Seed sample bookings and payments
 */
const seedBookings = async (users, vehicles, drivers) => {
  try {
    if (users.length === 0 || vehicles.length === 0 || drivers.length === 0) {
      logger.warn('Cannot seed bookings: missing users, vehicles, or drivers.');
      return [];
    }

    const now = new Date();
    const bookingsToCreate = [];
    const paymentsToCreate = [];

    // Helper to find a vehicle and its driver
    const getVehicleAndDriver = (type) => {
      const vehicle = vehicles.find(v => v.type === type);
      if (!vehicle) return { vehicleId: null, driverId: null };
      const driver = drivers.find(d => d.vehicleId.equals(vehicle._id));
      return { vehicleId: vehicle._id, driverId: driver ? driver._id : null };
    };
    
    // --- 1. Upcoming Sedan Booking (Paid Online) ---
    // Delhi to Agra, 230km, ONE_WAY, SEDAN. Rate: 15/km.
    // Fare = 230 * 15 = 3450. GST = 173. Final = 3623.
    const { vehicleId: sedanVid, driverId: sedanDid } = getVehicleAndDriver(VEHICLE_TYPES.SEDAN);
    const booking1 = new Booking({
      userId: users[0]._id,
      bookingType: BOOKING_TYPES.ONE_WAY,
      pickupLocation: { city: 'Delhi', address: 'Connaught Place, New Delhi', lat: 28.6330, lng: 77.2197 },
      dropLocation: { city: 'Agra', address: 'Taj Mahal, Agra', lat: 27.1751, lng: 78.0421 },
      startDateTime: new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000), // 2 days from now
      vehicleType: VEHICLE_TYPES.SEDAN,
      vehicleId: sedanVid,
      driverId: sedanDid,
      passengerDetails: { name: users[0].name, phone: users[0].phoneNumber, email: users[0].email },
      fareDetails: { baseFare: 3450, distance: 230, gst: 173, totalFare: 3450, finalAmount: 3623, perKmRate: 15 },
      status: BOOKING_STATUS.CONFIRMED,
    });
    const payment1 = new Payment({
      userId: users[0]._id,
      bookingId: booking1._id,
      amount: 3623,
      status: PAYMENT_STATUS.COMPLETED,
      method: PAYMENT_METHODS.CARD,
      razorpayPaymentId: 'pay_seed_1a2b3c'
    });
    booking1.paymentId = payment1._id;
    bookingsToCreate.push(booking1);
    paymentsToCreate.push(payment1);

    // --- 2. Completed Premium SUV Booking (Paid Online) ---
    // Airport Drop, 20km, SUV_INOVA_PREMIUM. Base: 1199. Free: 10km. Extra: 10km @ 32/km = 320.
    // Fare = 1199 + 320 = 1519. GST = 76. Final = 1595.
    const { vehicleId: pSedanVid, driverId: pSedanDid } = getVehicleAndDriver(VEHICLE_TYPES.SUV_INOVA_PREMIUM);
    const booking2 = new Booking({
      userId: users[0]._id,
      bookingType: BOOKING_TYPES.AIRPORT_DROP,
      pickupLocation: { city: 'Delhi', address: 'Vasant Vihar, New Delhi', lat: 28.5602, lng: 77.1648 },
      dropLocation: { city: 'Delhi', address: 'Indira Gandhi International Airport, Terminal 3', lat: 28.5562, lng: 77.1000 },
      startDateTime: new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000), // 5 days ago
      vehicleType: VEHICLE_TYPES.SUV_INOVA_PREMIUM,
      vehicleId: pSedanVid,
      driverId: pSedanDid,
      passengerDetails: { name: users[0].name, phone: users[0].phoneNumber },
      fareDetails: { baseFare: 1519, distance: 20, gst: 76, totalFare: 1519, finalAmount: 1595, perKmRate: 32 },
      status: BOOKING_STATUS.COMPLETED,
      trip: {
        actualStartTime: new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000),
        actualEndTime: new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000 + 45 * 60 * 1000),
        actualDistance: 22, startOdometer: 5000, endOdometer: 5022
      }
    });
    const payment2 = new Payment({
      userId: users[0]._id,
      bookingId: booking2._id,
      amount: 1595,
      status: PAYMENT_STATUS.COMPLETED,
      method: PAYMENT_METHODS.UPI,
      razorpayPaymentId: 'pay_seed_4d5e6f'
    });
    booking2.paymentId = payment2._id;
    bookingsToCreate.push(booking2);
    paymentsToCreate.push(payment2);

    // --- 3. Upcoming SUV Ertiga Local Rental (Cash) ---
    // LOCAL_8_80, SUV_ERTIGA. Base: 1899. GST = 95. Final = 1994.
    const { vehicleId: suvVid, driverId: suvDid } = getVehicleAndDriver(VEHICLE_TYPES.SUV_ERTIGA);
    const booking3 = new Booking({
      userId: users[1]._id,
      bookingType: BOOKING_TYPES.LOCAL_8_80,
      pickupLocation: { city: 'Delhi', address: 'India Gate, New Delhi', lat: 28.6129, lng: 77.2295 },
      dropLocation: { city: 'Delhi', address: 'India Gate, New Delhi', lat: 28.6129, lng: 77.2295 },
      startDateTime: new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000), // 3 days from now
      vehicleType: VEHICLE_TYPES.SUV_ERTIGA,
      vehicleId: suvVid,
      driverId: suvDid,
      passengerDetails: { name: users[1].name, phone: users[1].phoneNumber, email: users[1].email },
      fareDetails: { baseFare: 1899, distance: 80, duration: 8, gst: 95, totalFare: 1899, finalAmount: 1994 },
      status: BOOKING_STATUS.CONFIRMED,
      specialRequests: ['Child seat required', 'AC must be working'],
    });
    const payment3 = new Payment({
      userId: users[1]._id,
      bookingId: booking3._id,
      amount: 1994,
      status: PAYMENT_STATUS.PENDING,
      method: PAYMENT_METHODS.CASH,
    });
    booking3.paymentId = payment3._id;
    bookingsToCreate.push(booking3);
    paymentsToCreate.push(payment3);

    // --- 4. Completed Sedan Round Trip (Paid Online) ---
    // Delhi to Jaipur, 280km one-way -> 560km round-trip. SEDAN. Rate: 11/km.
    // Fare = 560 * 11 = 6160. GST = 308. Final = 6468.
    const { vehicleId: sedan2Vid, driverId: sedan2Did } = getVehicleAndDriver(VEHICLE_TYPES.SEDAN);
    const booking4 = new Booking({
      userId: users[1]._id,
      bookingType: BOOKING_TYPES.ROUND_TRIP,
      pickupLocation: { city: 'Delhi', address: 'Nehru Place, New Delhi', lat: 28.5484, lng: 77.2513 },
      dropLocation: { city: 'Jaipur', address: 'Hawa Mahal, Jaipur', lat: 26.9239, lng: 75.8267 },
      startDateTime: new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000), // 10 days ago
      endDateTime: new Date(now.getTime() - 9 * 24 * 60 * 60 * 1000),
      vehicleType: VEHICLE_TYPES.SEDAN,
      vehicleId: sedan2Vid,
      driverId: sedan2Did,
      passengerDetails: { name: users[1].name, phone: users[1].phoneNumber },
      fareDetails: { baseFare: 6160, distance: 560, gst: 308, totalFare: 6160, finalAmount: 6468, perKmRate: 11 },
      status: BOOKING_STATUS.COMPLETED,
      trip: {
        actualStartTime: new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000),
        actualEndTime: new Date(now.getTime() - 9 * 24 * 60 * 60 * 1000),
        actualDistance: 565, startOdometer: 18000, endOdometer: 18565
      },
      rating: { value: 5, comment: 'Excellent service, new pricing is great' }
    });
    const payment4 = new Payment({
      userId: users[1]._id,
      bookingId: booking4._id,
      amount: 6468,
      status: PAYMENT_STATUS.COMPLETED,
      method: PAYMENT_METHODS.NET_BANKING,
      razorpayPaymentId: 'pay_seed_7g8h9i'
    });
    booking4.paymentId = payment4._id;
    bookingsToCreate.push(booking4);
    paymentsToCreate.push(payment4);

    // --- 5. Cancelled Hatchback Booking (Was Pending Payment) ---
    // Delhi to Gurgaon, 35km, ONE_WAY, HATCHBACK. Rate: 14/km.
    // Fare = 35 * 14 = 490. GST = 25. Final = 515.
    const { vehicleId: hatchVid, driverId: hatchDid } = getVehicleAndDriver(VEHICLE_TYPES.HATCHBACK);
    const booking5 = new Booking({
      userId: users[2]._id,
      bookingType: BOOKING_TYPES.ONE_WAY,
      pickupLocation: { city: 'Delhi', address: 'Karol Bagh, New Delhi', lat: 28.647, lng: 77.195 },
      dropLocation: { city: 'Gurgaon', address: 'Cyber City, Gurgaon', lat: 28.494, lng: 77.088 },
      startDateTime: new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000),
      vehicleType: VEHICLE_TYPES.HATCHBACK,
      vehicleId: hatchVid,
      passengerDetails: { name: users[2].name, phone: users[2].phoneNumber },
      fareDetails: { baseFare: 490, distance: 35, gst: 25, totalFare: 490, finalAmount: 515, perKmRate: 14 },
      status: BOOKING_STATUS.CANCELLED,
      cancellation: {
        cancelledBy: 'USER',
        cancelledAt: new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000 + 30 * 60 * 1000),
        reason: 'Plans changed',
        charge: 0
      }
    });
    const payment5 = new Payment({
      userId: users[2]._id,
      bookingId: booking5._id,
      amount: 515,
      status: PAYMENT_STATUS.FAILED,
      method: PAYMENT_METHODS.UPI,
      failureReason: 'Booking cancelled by user before payment'
    });
    booking5.paymentId = payment5._id;
    bookingsToCreate.push(booking5);
    paymentsToCreate.push(payment5);

    // --- Bulk insert all created documents ---
    await Payment.insertMany(paymentsToCreate);
    await Booking.insertMany(bookingsToCreate);
    
    logger.info(`✅ ${bookingsToCreate.length} sample bookings and payments seeded`);

    const statusSummary = bookingsToCreate.reduce((acc, b) => {
      acc[b.status] = (acc[b.status] || 0) + 1;
      return acc;
    }, {});
    logger.info('Booking summary by status:', statusSummary);

    return bookingsToCreate;
  } catch (error) {
    logger.error('Error seeding bookings:', error);
    throw error;
  }
};


// ============================================
// MAIN SEED FUNCTION
// ============================================

const seedDatabase = async () => {
  try {
    logger.info('🌱 Starting database seeding with NEW pricing...\n');

    await connectDB();

    // Clear existing data
    await clearData();

    // Seed in order (with dependencies)
    logger.info('\n📦 Seeding new vehicles...');
    const vehicles = await seedVehicles();

    logger.info('\n👨‍✈️ Seeding drivers...');
    const drivers = await seedDrivers(vehicles);

    logger.info('\n👤 Seeding users...');
    const users = await seedUsers();

    logger.info('\n📋 Seeding sample bookings & payments (with new fares)...');
    const bookings = await seedBookings(users, vehicles, drivers);

    // ========================================
    // SUMMARY
    // ========================================

    logger.info('\n' + '='.repeat(60));
    logger.info('✅ DATABASE SEEDED SUCCESSFULLY!');
    logger.info('='.repeat(60));

    logger.info('\n📊 SUMMARY:');
    logger.info(`   ├─ Vehicles: ${vehicles.length}`);
    logger.info(`   ├─ Drivers: ${drivers.length}`);
    logger.info(`   ├─ Users: ${users.length}`);
    logger.info(`   ├─ Bookings: ${bookings.length}`);
    logger.info(`   └─ Payments: ${bookings.length}\n`);

    logger.info('🔐 TEST USER CREDENTIALS:');
    logger.info('━'.repeat(60));
    users.forEach((user, index) => {
      logger.info(`   User ${index + 1}:`);
      logger.info(`      Phone: ${user.phoneNumber}`);
      logger.info(`      Name: ${user.name}`);
      logger.info(`      Email: ${user.email || 'N/A'}`);
    });
    logger.info('   OTP: Check console logs when running in dev mode\n');

    logger.info('🚗 AVAILABLE VEHICLES BY TYPE:');
    logger.info('━'.repeat(60));

    const vehiclesByType = vehicles.reduce((acc, v) => {
      if (!acc[v.type]) acc[v.type] = [];
      acc[v.type].push(v);
      return acc;
    }, {});

    Object.entries(vehiclesByType).forEach(([type, vehs]) => {
      logger.info(`\n   ${type} (${vehs.length} vehicles):`);
      vehs.forEach(v => {
        logger.info(`      • ${v.modelName} - ${v.licensePlate} (${v.color}, ${v.year})`);
      });
    });

    logger.info('\n' + '='.repeat(60));
    logger.info('🎉 Ready to use! Start the server with: npm run dev');
    logger.info('='.repeat(60) + '\n');

    process.exit(0);
  } catch (error) {
    logger.error('❌ Error seeding database:', error);
    process.exit(1);
  }
};

// ============================================
// SEED BY SPECIFIC TYPE (Optional Commands)
// ============================================

const seedByType = async (type) => {
  try {
    await connectDB();

    switch (type) {
      case 'vehicles':
        await Vehicle.deleteMany({});
        await seedVehicles();
        break;
      case 'drivers':
        await Driver.deleteMany({});
        const veh = await Vehicle.find({});
        await seedDrivers(veh);
        break;
      case 'users':
        await User.deleteMany({});
        await seedUsers();
        break;
      case 'bookings':
        await Booking.deleteMany({});
        await Payment.deleteMany({});
        const u = await User.find({});
        const v = await Vehicle.find({});
        const d = await Driver.find({});
        await seedBookings(u, v, d);
        break;
      default:
        logger.error('Invalid type. Use: vehicles, drivers, users, or bookings');
    }

    logger.info(`✅ ${type} seeded successfully`);
    process.exit(0);
  } catch (error) {
    logger.error(`Error seeding ${type}:`, error);
    process.exit(1);
  }
};

// ============================================
// RUN SEEDER
// ============================================

// Check if running directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const type = process.argv[2];

  if (type) {
    seedByType(type);
  } else {
    seedDatabase();
  }
}

// ============================================
// EXPORTS
// ============================================

export default seedDatabase;
export {
  clearData,
  seedVehicles,
  seedDrivers,
  seedUsers,
  seedBookings,
  seedByType
};