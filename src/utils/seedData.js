// src/utils/seedData.js - Updated for Payment Model
import dotenv from 'dotenv';
import mongoose from 'mongoose';
// CORRECTED IMPORTS
import Vehicle from '../models/Vehicle.js';
import Driver from '../models/Driver.js';
import User from '../models/User.js';
import Booking from '../models/Booking.js';
import Payment from '../models/Payment.js'; // --- ADDED PAYMENT MODEL ---
// END CORRECTED IMPORTS
import {
  VEHICLE_TYPES,
  BOOKING_TYPES,
  BOOKING_STATUS,
  PAYMENT_STATUS, // --- ADDED ---
  PAYMENT_METHODS // --- ADDED ---
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
// SAMPLE VEHICLE DATA (Unchanged)
// ============================================

const vehicles = [
  // ========== SEDAN VEHICLES (Economy/Standard) ==========
  {
    type: VEHICLE_TYPES.SEDAN,
    modelName: 'Honda City',
    licensePlate: 'DL01CD5678',
    capacity: 4,
    isAvailable: true,
    features: ['AC', 'Music System', 'GPS Navigation'],
    year: 2023,
    color: 'Silver',
    fuelType: 'PETROL',
    insurance: {
      policyNumber: 'POL12345',
      expiryDate: new Date('2025-12-31'),
      provider: 'HDFC Ergo'
    },
    maintenance: {
      lastService: new Date('2024-09-01'),
      nextServiceDue: new Date('2025-03-01'),
      totalKm: 18000
    }
  },
  {
    type: VEHICLE_TYPES.SEDAN,
    modelName: 'Hyundai Verna',
    licensePlate: 'DL03PQ9012',
    capacity: 4,
    isAvailable: true,
    features: ['AC', 'Music System', 'GPS Navigation'],
    year: 2022,
    color: 'Black',
    fuelType: 'DIESEL',
    insurance: {
      policyNumber: 'POL12346',
      expiryDate: new Date('2025-08-15'),
      provider: 'ICICI Lombard'
    },
    maintenance: {
      lastService: new Date('2024-08-15'),
      nextServiceDue: new Date('2025-02-15'),
      totalKm: 30000
    }
  },
  {
    type: VEHICLE_TYPES.SEDAN,
    modelName: 'Maruti Ciaz',
    licensePlate: 'DL05ST3456',
    capacity: 4,
    isAvailable: true,
    features: ['AC', 'Music System', 'GPS Navigation'],
    year: 2023,
    color: 'White',
    fuelType: 'PETROL',
    insurance: {
      policyNumber: 'POL12347',
      expiryDate: new Date('2025-10-20'),
      provider: 'Bajaj Allianz'
    },
    maintenance: {
      lastService: new Date('2024-10-01'),
      nextServiceDue: new Date('2025-04-01'),
      totalKm: 15000
    }
  },
  {
    type: VEHICLE_TYPES.SEDAN,
    modelName: 'Honda Amaze',
    licensePlate: 'DL07UV7890',
    capacity: 4,
    isAvailable: true,
    features: ['AC', 'Music System', 'GPS Navigation'],
    year: 2024,
    color: 'Blue',
    fuelType: 'DIESEL',
    insurance: {
      policyNumber: 'POL12348',
      expiryDate: new Date('2025-11-30'),
      provider: 'Tata AIG'
    },
    maintenance: {
      lastService: new Date('2024-09-10'),
      nextServiceDue: new Date('2025-03-10'),
      totalKm: 8000
    }
  },

  // ========== PREMIUM SEDAN (Prime/Luxury) ==========
  {
    type: VEHICLE_TYPES.PREMIUM_SEDAN,
    modelName: 'Honda Accord',
    licensePlate: 'DL01GH3456',
    capacity: 4,
    isAvailable: true,
    features: ['AC', 'Music System', 'GPS Navigation', 'Premium Interior', 'Leather Seats', 'WiFi', 'Sunroof'],
    year: 2024,
    color: 'Pearl White',
    fuelType: 'PETROL',
    insurance: {
      policyNumber: 'POL12349',
      expiryDate: new Date('2026-01-15'),
      provider: 'HDFC Ergo'
    },
    maintenance: {
      lastService: new Date('2024-10-15'),
      nextServiceDue: new Date('2025-04-15'),
      totalKm: 5000
    }
  },
  {
    type: VEHICLE_TYPES.PREMIUM_SEDAN,
    modelName: 'Toyota Camry',
    licensePlate: 'DL05TU7890',
    capacity: 4,
    isAvailable: true,
    features: ['AC', 'Music System', 'GPS Navigation', 'Premium Interior', 'Leather Seats', 'WiFi', 'Sunroof', 'Ambient Lighting'],
    year: 2024,
    color: 'Black',
    fuelType: 'HYBRID',
    insurance: {
      policyNumber: 'POL12350',
      expiryDate: new Date('2026-02-28'),
      provider: 'ICICI Lombard'
    },
    maintenance: {
      lastService: new Date('2024-10-20'),
      nextServiceDue: new Date('2025-04-20'),
      totalKm: 3000
    }
  },
  {
    type: VEHICLE_TYPES.PREMIUM_SEDAN,
    modelName: 'Skoda Superb',
    licensePlate: 'DL02WX1234',
    capacity: 4,
    isAvailable: true,
    features: ['AC', 'Music System', 'GPS Navigation', 'Premium Interior', 'Leather Seats', 'WiFi', 'Sunroof', 'Massage Seats'],
    year: 2023,
    color: 'Silver',
    fuelType: 'DIESEL',
    insurance: {
      policyNumber: 'POL12351',
      expiryDate: new Date('2025-12-10'),
      provider: 'Bajaj Allianz'
    },
    maintenance: {
      lastService: new Date('2024-09-05'),
      nextServiceDue: new Date('2025-03-05'),
      totalKm: 12000
    }
  },

  // ========== SUV/MUV VEHICLES ==========
  {
    type: VEHICLE_TYPES.SUV,
    modelName: 'Toyota Innova Crysta',
    licensePlate: 'DL01EF9012',
    capacity: 6,
    isAvailable: true,
    features: ['AC', 'Music System', 'GPS Navigation', 'Premium Interior', 'Extra Legroom', 'Spacious Luggage', 'Captain Seats'],
    year: 2023,
    color: 'White',
    fuelType: 'DIESEL',
    insurance: {
      policyNumber: 'POL12352',
      expiryDate: new Date('2025-11-20'),
      provider: 'HDFC Ergo'
    },
    maintenance: {
      lastService: new Date('2024-08-20'),
      nextServiceDue: new Date('2025-02-20'),
      totalKm: 22000
    }
  },
  {
    type: VEHICLE_TYPES.SUV,
    modelName: 'Maruti Ertiga',
    licensePlate: 'DL04RS3456',
    capacity: 6,
    isAvailable: true,
    features: ['AC', 'Music System', 'GPS Navigation', 'Premium Interior', 'Extra Legroom'],
    year: 2022,
    color: 'Grey',
    fuelType: 'PETROL',
    insurance: {
      policyNumber: 'POL12353',
      expiryDate: new Date('2025-09-15'),
      provider: 'ICICI Lombard'
    },
    maintenance: {
      lastService: new Date('2024-07-15'),
      nextServiceDue: new Date('2025-01-15'),
      totalKm: 28000
    }
  },
  {
    type: VEHICLE_TYPES.SUV,
    modelName: 'Kia Carens',
    licensePlate: 'DL06YZ5678',
    capacity: 6,
    isAvailable: true,
    features: ['AC', 'Music System', 'GPS Navigation', 'Premium Interior', 'Extra Legroom', 'Spacious Luggage', 'Sunroof'],
    year: 2023,
    color: 'Red',
    fuelType: 'DIESEL',
    insurance: {
      policyNumber: 'POL12354',
      expiryDate: new Date('2025-10-30'),
      provider: 'Tata AIG'
    },
    maintenance: {
      lastService: new Date('2024-09-20'),
      nextServiceDue: new Date('2025-03-20'),
      totalKm: 16000
    }
  },
  {
    type: VEHICLE_TYPES.SUV,
    modelName: 'Mahindra XUV700',
    licensePlate: 'DL08AB9012',
    capacity: 6,
    isAvailable: true,
    features: ['AC', 'Music System', 'GPS Navigation', 'Premium Interior', 'Extra Legroom', 'Spacious Luggage', 'Panoramic Sunroof', 'ADAS'],
    year: 2024,
    color: 'Blue',
    fuelType: 'DIESEL',
    insurance: {
      policyNumber: 'POL12355',
      expiryDate: new Date('2026-01-10'),
      provider: 'Bajaj Allianz'
    },
    maintenance: {
      lastService: new Date('2024-10-05'),
      nextServiceDue: new Date('2025-04-05'),
      totalKm: 7000
    }
  },

  // ========== HATCHBACK (Budget Option) ==========
  {
    type: VEHICLE_TYPES.HATCHBACK,
    modelName: 'Maruti Swift',
    licensePlate: 'DL01AB1234',
    capacity: 4,
    isAvailable: true,
    features: ['AC', 'Music System'],
    year: 2022,
    color: 'White',
    fuelType: 'PETROL',
    insurance: {
      policyNumber: 'POL12356',
      expiryDate: new Date('2025-08-20'),
      provider: 'HDFC Ergo'
    },
    maintenance: {
      lastService: new Date('2024-08-01'),
      nextServiceDue: new Date('2025-02-01'),
      totalKm: 25000
    }
  },
  {
    type: VEHICLE_TYPES.HATCHBACK,
    modelName: 'Hyundai i20',
    licensePlate: 'DL02XY5678',
    capacity: 4,
    isAvailable: true,
    features: ['AC', 'Music System'],
    year: 2023,
    color: 'Red',
    fuelType: 'DIESEL',
    insurance: {
      policyNumber: 'POL12357',
      expiryDate: new Date('2025-09-30'),
      provider: 'ICICI Lombard'
    },
    maintenance: {
      lastService: new Date('2024-09-01'),
      nextServiceDue: new Date('2025-03-01'),
      totalKm: 15000
    }
  }
];

// ============================================
// SAMPLE DRIVER DATA (Unchanged)
// ============================================

const drivers = [
  // Sedan Drivers
  {
    name: 'Rajesh Kumar',
    phoneNumber: '9876543210',
    email: 'rajesh.kumar@example.com',
    licenseNumber: 'DL1234567890',
    licenseExpiry: new Date('2028-12-31'),
    rating: 4.8,
    totalRides: 250,
    completedRides: 245,
    cancelledRides: 5,
    isAvailable: true,
    isVerified: true,
    address: {
      street: 'Sector 15, Rohini',
      city: 'Delhi',
      state: 'Delhi',
      pincode: '110085'
    },
    emergencyContact: {
      name: 'Sunita Kumar',
      phone: '9876543211',
      relation: 'Wife'
    }
  },
  {
    name: 'Amit Singh',
    phoneNumber: '9876543211',
    email: 'amit.singh@example.com',
    licenseNumber: 'DL1234567891',
    licenseExpiry: new Date('2027-06-30'),
    rating: 4.9,
    totalRides: 320,
    completedRides: 315,
    cancelledRides: 5,
    isAvailable: true,
    isVerified: true,
    address: {
      street: 'Lajpat Nagar',
      city: 'Delhi',
      state: 'Delhi',
      pincode: '110024'
    },
    emergencyContact: {
      name: 'Priya Singh',
      phone: '9876543212',
      relation: 'Sister'
    }
  },
  {
    name: 'Suresh Sharma',
    phoneNumber: '9876543212',
    email: 'suresh.sharma@example.com',
    licenseNumber: 'DL1234567892',
    licenseExpiry: new Date('2029-03-15'),
    rating: 4.7,
    totalRides: 180,
    completedRides: 175,
    cancelledRides: 5,
    isAvailable: true,
    isVerified: true,
    address: {
      street: 'Karol Bagh',
      city: 'Delhi',
      state: 'Delhi',
      pincode: '110005'
    },
    emergencyContact: {
      name: 'Rakesh Sharma',
      phone: '9876543213',
      relation: 'Brother'
    }
  },
  {
    name: 'Manoj Tiwari',
    phoneNumber: '9876543213',
    email: 'manoj.tiwari@example.com',
    licenseNumber: 'DL1234567893',
    licenseExpiry: new Date('2028-02-14'),
    rating: 4.9,
    totalRides: 350,
    completedRides: 345,
    cancelledRides: 5,
    isAvailable: true,
    isVerified: true,
    address: {
      street: 'Janakpuri',
      city: 'Delhi',
      state: 'Delhi',
      pincode: '110058'
    },
    emergencyContact: {
      name: 'Pooja Tiwari',
      phone: '9876543214',
      relation: 'Wife'
    }
  },

  // Premium Sedan Drivers (Higher ratings)
  {
    name: 'Vijay Verma',
    phoneNumber: '9876543214',
    email: 'vijay.verma@example.com',
    licenseNumber: 'DL1234567894',
    licenseExpiry: new Date('2028-09-20'),
    rating: 5.0,
    totalRides: 400,
    completedRides: 398,
    cancelledRides: 2,
    isAvailable: true,
    isVerified: true,
    address: {
      street: 'Vasant Vihar',
      city: 'Delhi',
      state: 'Delhi',
      pincode: '110057'
    },
    emergencyContact: {
      name: 'Anjali Verma',
      phone: '9876543215',
      relation: 'Wife'
    }
  },
  {
    name: 'Anil Gupta',
    phoneNumber: '9876543215',
    email: 'anil.gupta@example.com',
    licenseNumber: 'DL1234567895',
    licenseExpiry: new Date('2029-05-25'),
    rating: 4.9,
    totalRides: 380,
    completedRides: 375,
    cancelledRides: 5,
    isAvailable: true,
    isVerified: true,
    address: {
      street: 'Defence Colony',
      city: 'Delhi',
      state: 'Delhi',
      pincode: '110024'
    },
    emergencyContact: {
      name: 'Neha Gupta',
      phone: '9876543216',
      relation: 'Sister'
    }
  },
  {
    name: 'Rakesh Malhotra',
    phoneNumber: '9876543216',
    email: 'rakesh.malhotra@example.com',
    licenseNumber: 'DL1234567896',
    licenseExpiry: new Date('2028-11-10'),
    rating: 4.8,
    totalRides: 290,
    completedRides: 285,
    cancelledRides: 5,
    isAvailable: true,
    isVerified: true,
    address: {
      street: 'Greater Kailash',
      city: 'Delhi',
      state: 'Delhi',
      pincode: '110048'
    },
    emergencyContact: {
      name: 'Meera Malhotra',
      phone: '9876543217',
      relation: 'Wife'
    }
  },

  // SUV Drivers
  {
    name: 'Ramesh Yadav',
    phoneNumber: '9876543217',
    email: 'ramesh.yadav@example.com',
    licenseNumber: 'DL1234567897',
    licenseExpiry: new Date('2027-11-10'),
    rating: 4.6,
    totalRides: 150,
    completedRides: 145,
    cancelledRides: 5,
    isAvailable: true,
    isVerified: true,
    address: {
      street: 'Dwarka Sector 10',
      city: 'Delhi',
      state: 'Delhi',
      pincode: '110075'
    },
    emergencyContact: {
      name: 'Seema Yadav',
      phone: '9876543218',
      relation: 'Wife'
    }
  },
  {
    name: 'Deepak Chauhan',
    phoneNumber: '9876543218',
    email: 'deepak.chauhan@example.com',
    licenseNumber: 'DL1234567898',
    licenseExpiry: new Date('2027-08-30'),
    rating: 4.7,
    totalRides: 200,
    completedRides: 195,
    cancelledRides: 5,
    isAvailable: true,
    isVerified: true,
    address: {
      street: 'Pitampura',
      city: 'Delhi',
      state: 'Delhi',
      pincode: '110034'
    },
    emergencyContact: {
      name: 'Ravi Chauhan',
      phone: '9876543219',
      relation: 'Brother'
    }
  },
  {
    name: 'Sanjay Mishra',
    phoneNumber: '9876543219',
    email: 'sanjay.mishra@example.com',
    licenseNumber: 'DL1234567899',
    licenseExpiry: new Date('2028-04-15'),
    rating: 4.8,
    totalRides: 220,
    completedRides: 215,
    cancelledRides: 5,
    isAvailable: true,
    isVerified: true,
    address: {
      street: 'Uttam Nagar',
      city: 'Delhi',
      state: 'Delhi',
      pincode: '110059'
    },
    emergencyContact: {
      name: 'Kavita Mishra',
      phone: '9876543220',
      relation: 'Wife'
    }
  },
  {
    name: 'Prakash Joshi',
    phoneNumber: '9876543220',
    email: 'prakash.joshi@example.com',
    licenseNumber: 'DL1234567900',
    licenseExpiry: new Date('2029-01-20'),
    rating: 4.9,
    totalRides: 260,
    completedRides: 255,
    cancelledRides: 5,
    isAvailable: true,
    isVerified: true,
    address: {
      street: 'Mayur Vihar',
      city: 'Delhi',
      state: 'Delhi',
      pincode: '110091'
    },
    emergencyContact: {
      name: 'Asha Joshi',
      phone: '9876543221',
      relation: 'Wife'
    }
  },

  // Hatchback Drivers
  {
    name: 'Ashok Pandey',
    phoneNumber: '9876543221',
    email: 'ashok.pandey@example.com',
    licenseNumber: 'DL1234567901',
    licenseExpiry: new Date('2027-07-10'),
    rating: 4.5,
    totalRides: 180,
    completedRides: 175,
    cancelledRides: 5,
    isAvailable: true,
    isVerified: true,
    address: {
      street: 'Shahdara',
      city: 'Delhi',
      state: 'Delhi',
      pincode: '110032'
    },
    emergencyContact: {
      name: 'Radha Pandey',
      phone: '9876543222',
      relation: 'Wife'
    }
  },
  {
    name: 'Mukesh Sharma',
    phoneNumber: '9876543222',
    email: 'mukesh.sharma@example.com',
    licenseNumber: 'DL1234567902',
    licenseExpiry: new Date('2028-03-25'),
    rating: 4.6,
    totalRides: 210,
    completedRides: 205,
    cancelledRides: 5,
    isAvailable: true,
    isVerified: true,
    address: {
      street: 'Tilak Nagar',
      city: 'Delhi',
      state: 'Delhi',
      pincode: '110018'
    },
    emergencyContact: {
      name: 'Shalini Sharma',
      phone: '9876543223',
      relation: 'Wife'
    }
  }
];

// ============================================
// SAMPLE USER DATA (Unchanged)
// ============================================

const sampleUsers = [
  {
    phoneNumber: '9999999991',
    name: 'Test User 1',
    email: 'testuser1@example.com',
    isVerified: true,
    isActive: true,
    role: 'CUSTOMER',
    address: {
      street: 'Connaught Place',
      city: 'Delhi',
      state: 'Delhi',
      pincode: '110001'
    }
  },
  {
    phoneNumber: '9999999992',
    name: 'Test User 2',
    email: 'testuser2@example.com',
    isVerified: true,
    isActive: true,
    role: 'CUSTOMER',
    address: {
      street: 'Nehru Place',
      city: 'Delhi',
      state: 'Delhi',
      pincode: '110019'
    }
  },
  {
    phoneNumber: '9999999993',
    name: 'Test User 3',
    email: 'testuser3@example.com',
    isVerified: true,
    isActive: true,
    role: 'CUSTOMER'
  }
];

// ============================================
// SEEDER FUNCTIONS
// ============================================

/**
 * Clear all data from collections
 */
const clearData = async () => {
  try {
    await Payment.deleteMany({}); // --- ADDED ---
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
    const { vehicleId: sedanVid, driverId: sedanDid } = getVehicleAndDriver('SEDAN');
    const booking1 = new Booking({
      userId: users[0]._id,
      bookingType: BOOKING_TYPES.ONE_WAY,
      pickupLocation: { city: 'Delhi', address: 'Connaught Place, New Delhi', lat: 28.6330, lng: 77.2197 },
      dropLocation: { city: 'Agra', address: 'Taj Mahal, Agra', lat: 27.1751, lng: 78.0421 },
      startDateTime: new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000), // 2 days from now
      vehicleType: 'SEDAN',
      vehicleId: sedanVid,
      driverId: sedanDid,
      passengerDetails: { name: users[0].name, phone: users[0].phoneNumber, email: users[0].email },
      fareDetails: { baseFare: 2530, distance: 230, gst: 127, totalFare: 2530, finalAmount: 2657, perKmRate: 11 },
      status: BOOKING_STATUS.CONFIRMED,
    });
    const payment1 = new Payment({
      userId: users[0]._id,
      bookingId: booking1._id,
      amount: 2657,
      status: PAYMENT_STATUS.COMPLETED,
      method: PAYMENT_METHODS.CARD,
      razorpayPaymentId: 'pay_seed_1a2b3c'
    });
    booking1.paymentId = payment1._id;
    bookingsToCreate.push(booking1);
    paymentsToCreate.push(payment1);

    // --- 2. Completed Premium Sedan Booking (Paid Online) ---
    const { vehicleId: pSedanVid, driverId: pSedanDid } = getVehicleAndDriver('PREMIUM_SEDAN');
    const booking2 = new Booking({
      userId: users[0]._id,
      bookingType: BOOKING_TYPES.AIRPORT_DROP,
      pickupLocation: { city: 'Delhi', address: 'Vasant Vihar, New Delhi', lat: 28.5602, lng: 77.1648 },
      dropLocation: { city: 'Delhi', address: 'Indira Gandhi International Airport, Terminal 3', lat: 28.5562, lng: 77.1000 },
      startDateTime: new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000), // 5 days ago
      vehicleType: 'PREMIUM_SEDAN',
      vehicleId: pSedanVid,
      driverId: pSedanDid,
      passengerDetails: { name: users[0].name, phone: users[0].phoneNumber },
      fareDetails: { baseFare: 1600, distance: 20, gst: 80, totalFare: 1600, finalAmount: 1680, perKmRate: 22 },
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
      amount: 1680,
      status: PAYMENT_STATUS.COMPLETED,
      method: PAYMENT_METHODS.UPI,
      razorpayPaymentId: 'pay_seed_4d5e6f'
    });
    booking2.paymentId = payment2._id;
    bookingsToCreate.push(booking2);
    paymentsToCreate.push(payment2);

    // --- 3. Upcoming SUV Local Rental (Cash) ---
    const { vehicleId: suvVid, driverId: suvDid } = getVehicleAndDriver('SUV');
    const booking3 = new Booking({
      userId: users[1]._id,
      bookingType: BOOKING_TYPES.LOCAL_8_80,
      pickupLocation: { city: 'Delhi', address: 'India Gate, New Delhi', lat: 28.6129, lng: 77.2295 },
      dropLocation: { city: 'Delhi', address: 'India Gate, New Delhi', lat: 28.6129, lng: 77.2295 },
      startDateTime: new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000), // 3 days from now
      vehicleType: 'SUV',
      vehicleId: suvVid,
      driverId: suvDid,
      passengerDetails: { name: users[1].name, phone: users[1].phoneNumber, email: users[1].email },
      fareDetails: { baseFare: 2800, distance: 80, duration: 8, gst: 140, totalFare: 2800, finalAmount: 2940 },
      status: BOOKING_STATUS.CONFIRMED,
      specialRequests: ['Child seat required', 'AC must be working'],
    });
    const payment3 = new Payment({
      userId: users[1]._id,
      bookingId: booking3._id,
      amount: 2940,
      status: PAYMENT_STATUS.PENDING,
      method: PAYMENT_METHODS.CASH,
    });
    booking3.paymentId = payment3._id;
    bookingsToCreate.push(booking3);
    paymentsToCreate.push(payment3);

    // --- 4. Completed Sedan Round Trip (Paid Online) ---
    const { vehicleId: sedan2Vid, driverId: sedan2Did } = getVehicleAndDriver('SEDAN');
    const booking4 = new Booking({
      userId: users[1]._id,
      bookingType: BOOKING_TYPES.ROUND_TRIP,
      pickupLocation: { city: 'Delhi', address: 'Nehru Place, New Delhi', lat: 28.5484, lng: 77.2513 },
      dropLocation: { city: 'Jaipur', address: 'Hawa Mahal, Jaipur', lat: 26.9239, lng: 75.8267 },
      startDateTime: new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000), // 10 days ago
      endDateTime: new Date(now.getTime() - 9 * 24 * 60 * 60 * 1000),
      vehicleType: 'SEDAN',
      vehicleId: sedan2Vid,
      driverId: sedan2Did,
      passengerDetails: { name: users[1].name, phone: users[1].phoneNumber },
      fareDetails: { baseFare: 5520, distance: 560, gst: 276, totalFare: 5520, finalAmount: 5796, perKmRate: 9.85 },
      status: BOOKING_STATUS.COMPLETED,
      trip: {
        actualStartTime: new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000),
        actualEndTime: new Date(now.getTime() - 9 * 24 * 60 * 60 * 1000),
        actualDistance: 565, startOdometer: 18000, endOdometer: 18565
      },
      rating: { value: 5, comment: 'Excellent service, very professional driver' }
    });
    const payment4 = new Payment({
      userId: users[1]._id,
      bookingId: booking4._id,
      amount: 5796,
      status: PAYMENT_STATUS.COMPLETED,
      method: PAYMENT_METHODS.NET_BANKING,
      razorpayPaymentId: 'pay_seed_7g8h9i'
    });
    booking4.paymentId = payment4._id;
    bookingsToCreate.push(booking4);
    paymentsToCreate.push(payment4);

    // --- 5. Cancelled Hatchback Booking (Was Pending Payment) ---
    const { vehicleId: hatchVid, driverId: hatchDid } = getVehicleAndDriver('HATCHBACK');
    const booking5 = new Booking({
      userId: users[2]._id,
      bookingType: BOOKING_TYPES.ONE_WAY,
      pickupLocation: { city: 'Delhi', address: 'Karol Bagh, New Delhi', lat: 28.647, lng: 77.195 },
      dropLocation: { city: 'Gurgaon', address: 'Cyber City, Gurgaon', lat: 28.494, lng: 77.088 },
      startDateTime: new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000),
      vehicleType: 'HATCHBACK',
      vehicleId: hatchVid,
      passengerDetails: { name: users[2].name, phone: users[2].phoneNumber },
      fareDetails: { baseFare: 350, distance: 35, gst: 18, totalFare: 350, finalAmount: 368, perKmRate: 10 },
      status: BOOKING_STATUS.CANCELLED, // Booking is cancelled
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
      amount: 368,
      status: PAYMENT_STATUS.FAILED, // Payment failed as it was never completed
      method: PAYMENT_METHODS.UPI,
      failureReason: 'Booking cancelled by user before payment'
    });
    booking5.paymentId = payment5._id;
    bookingsToCreate.push(booking5);
    paymentsToCreate.push(payment5);

    // --- 6. In-Progress Premium Sedan Booking (Cash) ---
    const { vehicleId: pSedan2Vid, driverId: pSedan2Did } = getVehicleAndDriver('PREMIUM_SEDAN');
    const booking6 = new Booking({
      userId: users[0]._id,
      bookingType: BOOKING_TYPES.AIRPORT_PICKUP,
      pickupLocation: { city: 'Delhi', address: 'Indira Gandhi International Airport, T3', lat: 28.5562, lng: 77.1000 },
      dropLocation: { city: 'Delhi', address: 'The Leela Palace, Chanakyapuri', lat: 28.5968, lng: 77.1895 },
      startDateTime: new Date(now.getTime() - 30 * 60 * 1000), // 30 minutes ago
      vehicleType: 'PREMIUM_SEDAN',
      vehicleId: pSedan2Vid,
      driverId: pSedan2Did,
      passengerDetails: { name: users[0].name, phone: users[0].phoneNumber, email: users[0].email },
      fareDetails: { baseFare: 1650, distance: 18, gst: 83, totalFare: 1650, finalAmount: 1733, perKmRate: 22 },
      status: BOOKING_STATUS.IN_PROGRESS,
      trip: {
        actualStartTime: new Date(now.getTime() - 25 * 60 * 1000),
        startOdometer: 3000
      }
    });
    const payment6 = new Payment({
      userId: users[0]._id,
      bookingId: booking6._id,
      amount: 1733,
      status: PAYMENT_STATUS.PENDING,
      method: PAYMENT_METHODS.CASH,
    });
    booking6.paymentId = payment6._id;
    bookingsToCreate.push(booking6);
    paymentsToCreate.push(payment6);


    // --- Bulk insert all created documents ---
    await Payment.insertMany(paymentsToCreate);
    await Booking.insertMany(bookingsToCreate);
    
    logger.info(`✅ ${bookingsToCreate.length} sample bookings and payments seeded`);

    // Log booking summary
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
    logger.info('🌱 Starting database seeding...\n');

    await connectDB();

    // Clear existing data
    await clearData();

    // Seed in order (with dependencies)
    logger.info('\n📦 Seeding vehicles...');
    const vehicles = await seedVehicles();

    logger.info('\n👨‍✈️ Seeding drivers...');
    const drivers = await seedDrivers(vehicles);

    logger.info('\n👤 Seeding users...');
    const users = await seedUsers();

    logger.info('\n📋 Seeding sample bookings & payments...');
    const bookings = await seedBookings(users, vehicles, drivers);

    // ========================================
    // SUMMARY
    // ========================================

    logger.info('\n' + '='.repeat(60));
    logger.info('✅ DATABASE SEEDED SUCCESSFULLY!');
    logger.info('='.repeat(60));

    logger.info('\n📊 SUMMARY:');
    logger.info(`   ├─ Vehicles: ${vehicles.length}`);
    logger.info(`   │  ├─ Hatchback: ${vehicles.filter(v => v.type === 'HATCHBACK').length}`);
    logger.info(`   │  ├─ Sedan: ${vehicles.filter(v => v.type === 'SEDAN').length}`);
    logger.info(`   │  ├─ Premium Sedan: ${vehicles.filter(v => v.type === 'PREMIUM_SEDAN').length}`);
    logger.info(`   │  └─ SUV: ${vehicles.filter(v => v.type === 'SUV').length}`);
    logger.info(`   ├─ Drivers: ${drivers.length}`);
    logger.info(`   ├─ Users: ${users.length}`);
    logger.info(`   ├─ Bookings: ${bookings.length}`);
    logger.info(`   └─ Payments: ${bookings.length}\n`); // Added Payments count

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
        await Payment.deleteMany({}); // --- ADDED ---
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
