// server.js - Application entry point
import dotenv from 'dotenv';
import logger from './src/config/logger.js'; // Import logger
import connectDB from './src/config/database.js';

// --- 1. LOAD ENV VARS ---
// MUST BE THE FIRST THING to run
dotenv.config();
logger.info('Environment variables loaded.');

// --- 2. VALIDATE ENV VARS ---
// Now we can safely check process.env.
// Added all required keys from your .env and firebase.js
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

// Configuration
const PORT = parseInt(process.env.PORT, 10) || 3000;

// --- 3. MAIN SERVER STARTUP ---
// We use an async function to allow for dynamic import
const startServer = async () => {
  try {
    // --- DYNAMICALLY IMPORT APP ---
    // This is the fix: We import 'app.js' *after* dotenv.config() and validation.
    // This ensures all env vars are loaded BEFORE app.js (and thus firebase.js) are imported.
    const { default: app } = await import('./src/app.js');
    logger.info('App modules imported successfully.');

    // Connect to MongoDB
    logger.info('Connecting to MongoDB...');
    await connectDB();

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
  // Add check for null/undefined error
  const error = err || new Error('Unknown unhandled rejection');
  logger.error('❌ UNHANDLED REJECTION! Shutting down...', { error: error.message, stack: error.stack });
  // Don't exit immediately, let the server handle shutdown if possible
});

process.on('uncaughtException', (err) => {
  logger.error('❌ UNCAUGHT EXCEPTION! Shutting down...', { error: err.message, stack: err.stack });
  process.exit(1); // Uncaught exceptions are critical
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

