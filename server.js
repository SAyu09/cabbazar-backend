// server.js - Application entry point
import dotenv from 'dotenv';
import logger from './src/config/logger.js';
import connectDB from './src/config/database.js';

// --- 1. LOAD ENV VARS ---
dotenv.config();
logger.info('Environment variables loaded.');

// --- 2. VALIDATE ENV VARS ---
const requiredEnvVars = [
  'MONGO_URI',
  'PORT',
  'FIREBASE_PROJECT_ID',
  'FIREBASE_PRIVATE_KEY',
  'FIREBASE_CLIENT_EMAIL',
  'JWT_SECRET',
  'FIREBASE_PRIVATE_KEY_ID',
  'FIREBASE_CLIENT_ID',
  'FIREBASE_CLIENT_X509_CERT_URL'
];

const missingVars = [];
requiredEnvVars.forEach((varName) => {
  if (!process.env[varName]) {
    missingVars.push(varName);
  }
});

if (missingVars.length > 0) {
  const errorMsg = `❌ Missing required environment variables: ${missingVars.join(', ')}`;
  logger.error(errorMsg);
  process.exit(1);
}

logger.info('All required environment variables are present and validated.');

const PORT = parseInt(process.env.PORT, 10) || 3000;

// --- 3. MAIN SERVER STARTUP ---
const startServer = async () => {
  try {
    // Connect to MongoDB FIRST
    logger.info('Connecting to MongoDB...');
    await connectDB();

    // THEN load all models (this registers them with Mongoose)
    logger.info('Loading database models...');
    await import('./src/models/index.js');
    logger.info('All models loaded and registered.');

    // THEN import app (which imports routes)
    const { default: app } = await import('./src/app.js');
    logger.info('App modules imported successfully.');

    // Start Express server
    const server = app.listen(PORT, () => {
      logger.info(`✅ Server running on port ${PORT}`);
      logger.info(`📍 Environment: ${process.env.NODE_ENV || 'development'}`);
      logger.info(`🔗 Health check: http://localhost:${PORT}/health`);
    });

    // Handle server startup errors
    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        logger.error(`❌ Port ${PORT} is already in use. Try a different port or free the port.`);
      } else {
        logger.error(`❌ Server startup error: ${err.message}`);
      }
      process.exit(1);
    });

    // Graceful shutdown on SIGTERM
    process.on('SIGTERM', () => {
      logger.info('👋 SIGTERM received. Shutting down gracefully...');
      server.close(() => {
        logger.info('✅ Process terminated');
        process.exit(0);
      });
    });

    return server;
  } catch (error) {
    logger.error(`❌ Failed to start server: ${error.message}`, { stack: error.stack });
    process.exit(1);
  }
};

// Global error handlers
process.on('unhandledRejection', (err) => {
  const error = err || new Error('Unknown unhandled rejection');
  logger.error('❌ UNHANDLED REJECTION! Shutting down...', { error: error.message, stack: error.stack });
});

process.on('uncaughtException', (err) => {
  logger.error('❌ UNCAUGHT EXCEPTION! Shutting down...', { error: err.message, stack: err.stack });
  process.exit(1);
});

// Start the application
startServer()
  .then(() => {
    logger.info('Server initialization process completed.');
  })
  .catch((err) => {
    logger.error('❌ Server initialization failed:', err);
    process.exit(1);
  });