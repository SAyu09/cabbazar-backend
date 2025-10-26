import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import morgan from 'morgan';
import logger from './config/logger.js';
import {loggerMiddleware, responseCaptureMiddelware} from './middleware/logger.js';
import globalErrorHandler from './middleware/error.middleware.js';

// Import routes
import authRoutes from './routes/auth.routes.js';
import bookingRoutes from './routes/booking.routes.js';
import userRoutes from './routes/user.routes.js';

// Add other route imports here as needed

// Initialize Express app
const app = express();

// Environment variables
const isProduction = process.env.NODE_ENV === 'production';

// Basic middleware setup
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(cookieParser());
app.use(cors({
  origin: isProduction 
    ? ['https://your-production-domain.com']
    : ['http://localhost:3000'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// Security middleware
app.use(helmet());
app.use(morgan(isProduction ? 'combined' : 'dev'));

// Custom middleware
app.use(loggerMiddleware);
app.use(responseCaptureMiddelware);

// Health check route
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// API Routes - Version 1
app.use('/api/auth', authRoutes);
app.use('/api/bookings', bookingRoutes);
app.use('/api/users', userRoutes);
// Add other v1 routes here

// API Routes - Version 2 (if needed)
// app.use('/api/v2/...', ...);

// Catch undefined API routes
app.all('/api/*', (req, res) => {
  res.status(404).json({
    success: false,
    message: `Route ${req.originalUrl} not found`
  });
});

// Global error handler
app.use(globalErrorHandler);

// Default route
app.get('/', (req, res) => {
  res.send(`<h1>Server is running. Environment: ${process.env.NODE_ENV}</h1>`);
});

// Catch all other routes
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: 'Page not found'
  });
});

logger.info('Express application configured successfully');

export default app;