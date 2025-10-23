// server.js - Application entry point
import dotenv from 'dotenv';
import logger from './src/config/logger.js';
import connectDB from './src/config/database.js';
import app from './src/app.js';

// Load environment variables with error handling
const envConfig = dotenv.config();
if (envConfig.error) {
  console.error('❌ Failed to load .env file:', envConfig.error.message);
  process.exit(1);
}

// Validate required environment variables
const requiredEnvVars = [
    'MONGO_URI',
    'PORT',
    'FIREBASE_PROJECT_ID',
    'FIREBASE_PRIVATE_KEY',
    'FIREBASE_CLIENT_EMAIL'
];
requiredEnvVars.forEach((varName) => {
  if (!process.env[varName]) {
    console.error(`❌ Missing environment variable: ${varName}`);
    process.exit(1);
  }
});
logger.info('Environment variables loaded successfully');
logger.info(`MONGO_URI: ${process.env.MONGO_URI}`);

// Configuration
const PORT = parseInt(process.env.PORT, 10) || 3000;

// Main server startup function
const startServer = async () => {
  try {
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
  logger.error('❌ UNHANDLED REJECTION! Shutting down...', { error: err.message, stack: err.stack });
  process.exit(1);
});

process.on('uncaughtException', (err) => {
  logger.error('❌ UNCAUGHT EXCEPTION! Shutting down...', { error: err.message, stack: err.stack });
  process.exit(1);
});

// Start the application
startServer()
  .then(() => {
    logger.info('Server initialized successfully');
  })
  .catch((err) => {
    logger.error('❌ Server initialization failed:', err);
    process.exit(1);
  });

// Export the app for testing or external use
export default app;