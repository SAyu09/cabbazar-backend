// src/app.js - Express application configuration
import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import logger from './config/logger.js';
import globalErrorHandler from './middleware/error.middleware.js';

// Initialize Express app
const app = express();

// Environment-based configuration
const isProduction = process.env.NODE_ENV === 'production';

// CORS configuration
const corsOptions = {
  origin: isProduction
    ? ['https://your-production-domain.com'] // Update with production domains
    : ['http://localhost:3000', 'http://localhost:3001', 'http://127.0.0.1:3000'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-tenant-id'],
  exposedHeaders: ['set-cookie'],
  optionsSuccessStatus: 200,
};

// Middleware stack
app.use(
  helmet({
    contentSecurityPolicy: isProduction
      ? {
          directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"], // For GraphQL Playground
            scriptSrc: ["'self'"],
          },
        }
      : false,
  })
);
app.use(cors(corsOptions));
app.use(morgan(isProduction ? 'combined' : 'dev'));
app.use(express.json({ limit: '50mb', verify: (req, res, buf) => { req.rawBody = buf; } }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(cookieParser());

// Health check endpoints
app.get('/health', (req, res) => {
  res.status(200).json({
    success: true,
    data: {
      status: 'OK',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      environment: process.env.NODE_ENV || 'development',
    },
  });
});



// Catch-all for undefined REST API routes
app.all('/api/*', (req, res) => {
  res.status(404).json({
    success: false,
    message: `Route ${req.originalUrl} not found`,
    suggestion: 'Use GraphQL endpoint at /graphql',
  });
});

// Global error handler
app.use(globalErrorHandler);

// Fallback for non-API routes (excluding GraphQL)
app.use('*', (req, res, next) => {
  if (req.originalUrl.startsWith('/graphql')) {
    return next();
  }
  res.status(404).json({
    success: false,
    message: 'Page not found',
    availableEndpoints: {
      graphql: '/graphql',
      health: '/health',
      graphqlHealth: '/graphql/health',
    },
  });
});

// Log application setup completion
logger.info('Express application configured successfully');

export default app;