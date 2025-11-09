// src/services/geo.service.js
import { Client, Status } from '@googlemaps/google-maps-services-js';
import logger from '../config/logger.js';
import { BadRequestError, ServiceUnavailableError, NotFoundError } from '../utils/customError.js';

// In-memory cache (use Redis in production for distributed systems)
const GEO_CACHE = new Map();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const MAX_CACHE_SIZE = 5000;

class GeoService {
  constructor() {
    this.initializeClient();
    this.startCacheCleanup();
    this.requestCount = 0;
    this.cacheHits = 0;
    this.cacheMisses = 0;
  }

  /**
   * Initialize Google Maps client
   */
  initializeClient() {
    if (!process.env.GOOGLE_MAPS_API_KEY) {
      logger.warn('GOOGLE_MAPS_API_KEY is not set. GeoService will be disabled.');
      this.client = null;
      return;
    }

    try {
      this.client = new Client({});
      logger.info('Google Maps client initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize Google Maps client', {
        error: error.message,
        stack: error.stack
      });
      this.client = null;
    }
  }

  /**
   * Start periodic cache cleanup
   */
  startCacheCleanup() {
    setInterval(() => {
      const now = Date.now();
      let cleanedCount = 0;
      
      for (const [key, value] of GEO_CACHE.entries()) {
        if (value.expiry < now) {
          GEO_CACHE.delete(key);
          cleanedCount++;
        }
      }
      
      // If cache is too large, remove oldest entries
      if (GEO_CACHE.size > MAX_CACHE_SIZE) {
        const entriesToRemove = GEO_CACHE.size - MAX_CACHE_SIZE;
        const entries = Array.from(GEO_CACHE.entries());
        entries.sort((a, b) => a[1].expiry - b[1].expiry);
        
        for (let i = 0; i < entriesToRemove; i++) {
          GEO_CACHE.delete(entries[i][0]);
          cleanedCount++;
        }
      }
      
      if (cleanedCount > 0) {
        logger.debug('Geo cache cleaned', { 
          cleanedEntries: cleanedCount, 
          remainingEntries: GEO_CACHE.size 
        });
      }
    }, 5 * 60 * 1000); // Run every 5 minutes
  }

  /**
   * Check if the service is available
   */
  isAvailable() {
    return this.client !== null;
  }

  /**
   * Validate address input
   */
  validateAddress(address, context = '') {
    if (!address) {
      throw new BadRequestError(`Address is required${context ? ` (${context})` : ''}`);
    }

    if (typeof address !== 'string') {
      throw new BadRequestError(`Address must be a string${context ? ` (${context})` : ''}`);
    }

    const cleanAddress = address.trim();

    if (cleanAddress.length === 0) {
      throw new BadRequestError(`Address cannot be empty${context ? ` (${context})` : ''}`);
    }

    if (cleanAddress.length > 500) {
      throw new BadRequestError(`Address too long (max 500 characters)${context ? ` (${context})` : ''}`);
    }

    return cleanAddress;
  }

  /**
   * Validate coordinates
   */
  validateCoordinates(coords, context = '') {
    if (!coords || typeof coords !== 'object') {
      throw new BadRequestError(`Valid coordinates object required${context ? ` (${context})` : ''}`);
    }

    const { lat, lng } = coords;

    if (typeof lat !== 'number' || isNaN(lat)) {
      throw new BadRequestError(`Valid latitude required${context ? ` (${context})` : ''}`);
    }

    if (typeof lng !== 'number' || isNaN(lng)) {
      throw new BadRequestError(`Valid longitude required${context ? ` (${context})` : ''}`);
    }

    if (lat < -90 || lat > 90) {
      throw new BadRequestError(`Latitude must be between -90 and 90${context ? ` (${context})` : ''}`);
    }

    if (lng < -180 || lng > 180) {
      throw new BadRequestError(`Longitude must be between -180 and 180${context ? ` (${context})` : ''}`);
    }

    return { lat, lng };
  }

  /**
   * Geocode an address to coordinates
   * @param {string} address - The address string (e.g., "Taj Ganj, Agra")
   * @returns {Promise<{lat: number, lng: number}>}
   */
  async geocode(address) {
    if (!this.isAvailable()) {
      throw new ServiceUnavailableError('Geocoding service is not configured');
    }

    const cleanAddress = this.validateAddress(address, 'geocode');
    const cacheKey = `geocode:${cleanAddress.toLowerCase()}`;

    // Check cache
    if (GEO_CACHE.has(cacheKey)) {
      const cached = GEO_CACHE.get(cacheKey);
      if (cached.expiry > Date.now()) {
        this.cacheHits++;
        logger.debug('Geocode cache HIT', { address: cleanAddress });
        return cached.data;
      } else {
        GEO_CACHE.delete(cacheKey);
      }
    }

    this.cacheMisses++;
    this.requestCount++;

    try {
      const response = await this.client.geocode({
        params: {
          address: cleanAddress,
          key: process.env.GOOGLE_MAPS_API_KEY,
          region: 'IN', // Bias results to India
        },
        timeout: 10000, // 10 seconds timeout
      });

      if (response.data.status === Status.OK && response.data.results.length > 0) {
        const location = response.data.results[0].geometry.location;
        
        // Validate returned coordinates
        this.validateCoordinates(location, 'geocode response');
        
        // Cache the result
        GEO_CACHE.set(cacheKey, { 
          data: location, 
          expiry: Date.now() + CACHE_TTL_MS,
          timestamp: new Date().toISOString()
        });
        
        logger.info('Geocode SUCCESS', { 
          address: cleanAddress, 
          location,
          formattedAddress: response.data.results[0].formatted_address
        });
        
        return location;
      } else if (response.data.status === Status.ZERO_RESULTS) {
        logger.warn('Geocode returned zero results', { address: cleanAddress });
        throw new NotFoundError(`Could not find location for address: ${cleanAddress}`);
      } else if (response.data.status === Status.OVER_QUERY_LIMIT) {
        logger.error('Google Maps API quota exceeded', { address: cleanAddress });
        throw new ServiceUnavailableError('Location service quota exceeded. Please try again later');
      } else if (response.data.status === Status.REQUEST_DENIED) {
        logger.error('Google Maps API request denied', { 
          address: cleanAddress,
          status: response.data.status,
          errorMessage: response.data.error_message
        });
        throw new ServiceUnavailableError('Location service access denied');
      } else {
        logger.warn('Geocode failed with status', { 
          address: cleanAddress, 
          status: response.data.status,
          errorMessage: response.data.error_message
        });
        throw new ServiceUnavailableError(`Geocoding failed: ${response.data.status}`);
      }
    } catch (error) {
      if (error instanceof BadRequestError || 
          error instanceof NotFoundError || 
          error instanceof ServiceUnavailableError) {
        throw error;
      }

      logger.error('Geocode API Error', {
        error: error.message,
        stack: error.stack,
        address: cleanAddress,
        response: error.response?.data
      });

      if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
        throw new ServiceUnavailableError('Geocoding service timeout. Please try again');
      }

      throw new ServiceUnavailableError('Geocoding service failed');
    }
  }

  /**
   * Get driving distance and duration between two points
   * @param {Object|string} origin - {lat, lng} or address string
   * @param {Object|string} destination - {lat, lng} or address string
   * @returns {Promise<{distance: number, duration: number, originAddress: string, destinationAddress: string}>}
   */
  async getDistanceMatrix(origin, destination) {
    if (!this.isAvailable()) {
      throw new ServiceUnavailableError('Distance service is not configured');
    }

    // Validate inputs
    let validOrigin = origin;
    let validDestination = destination;

    if (typeof origin === 'object') {
      validOrigin = this.validateCoordinates(origin, 'origin');
    } else if (typeof origin === 'string') {
      validOrigin = this.validateAddress(origin, 'origin');
    } else {
      throw new BadRequestError('Origin must be coordinates object or address string');
    }

    if (typeof destination === 'object') {
      validDestination = this.validateCoordinates(destination, 'destination');
    } else if (typeof destination === 'string') {
      validDestination = this.validateAddress(destination, 'destination');
    } else {
      throw new BadRequestError('Destination must be coordinates object or address string');
    }

    const cacheKey = `dist:${JSON.stringify(validOrigin)}|${JSON.stringify(validDestination)}`;

    // Check cache
    if (GEO_CACHE.has(cacheKey)) {
      const cached = GEO_CACHE.get(cacheKey);
      if (cached.expiry > Date.now()) {
        this.cacheHits++;
        logger.debug('Distance Matrix cache HIT');
        return cached.data;
      } else {
        GEO_CACHE.delete(cacheKey);
      }
    }

    this.cacheMisses++;
    this.requestCount++;

    try {
      const response = await this.client.distancematrix({
        params: {
          origins: [validOrigin],
          destinations: [validDestination],
          key: process.env.GOOGLE_MAPS_API_KEY,
          units: 'metric',
          mode: 'driving',
          departure_time: 'now',
          region: 'IN',
          traffic_model: 'best_guess'
        },
        timeout: 10000, // 10 seconds timeout
      });

      if (response.data.status === Status.OK) {
        const element = response.data.rows[0]?.elements[0];
        
        if (!element) {
          throw new ServiceUnavailableError('Invalid response from distance service');
        }
        
        if (element.status === Status.OK) {
          if (!element.distance || !element.duration) {
            throw new ServiceUnavailableError('Incomplete distance data received');
          }

          const distanceInKm = Math.round((element.distance.value / 1000) * 10) / 10;
          const durationInMinutes = Math.round(element.duration.value / 60);
          
          // Validate distance is reasonable
          if (distanceInKm <= 0 || distanceInKm > 10000) {
            logger.warn('Unreasonable distance calculated', { distanceInKm });
            throw new ServiceUnavailableError('Invalid distance calculated');
          }
          
          const result = {
            distance: distanceInKm,
            duration: durationInMinutes,
            originAddress: response.data.origin_addresses[0] || 'Unknown',
            destinationAddress: response.data.destination_addresses[0] || 'Unknown',
            distanceText: element.distance.text,
            durationText: element.duration.text
          };

          // Cache the result
          GEO_CACHE.set(cacheKey, { 
            data: result, 
            expiry: Date.now() + CACHE_TTL_MS,
            timestamp: new Date().toISOString()
          });
          
          logger.info('Distance Matrix SUCCESS', {
            distance: distanceInKm,
            duration: durationInMinutes,
            origin: result.originAddress,
            destination: result.destinationAddress
          });
          
          return result;
        } else if (element.status === Status.ZERO_RESULTS) {
          throw new NotFoundError('Could not calculate route between these locations');
        } else if (element.status === Status.NOT_FOUND) {
          throw new NotFoundError('One or both locations could not be found');
        } else {
          logger.warn('Distance Matrix element failed', { 
            origin: validOrigin, 
            destination: validDestination, 
            status: element.status 
          });
          throw new ServiceUnavailableError(`Route calculation failed: ${element.status}`);
        }
      } else if (response.data.status === Status.OVER_QUERY_LIMIT) {
        logger.error('Google Maps API quota exceeded');
        throw new ServiceUnavailableError('Distance service quota exceeded. Please try again later');
      } else if (response.data.status === Status.REQUEST_DENIED) {
        logger.error('Google Maps API request denied', { 
          status: response.data.status,
          errorMessage: response.data.error_message
        });
        throw new ServiceUnavailableError('Distance service access denied');
      } else {
        logger.warn('Distance Matrix request failed', { 
          status: response.data.status,
          errorMessage: response.data.error_message
        });
        throw new ServiceUnavailableError(`Distance service failed: ${response.data.status}`);
      }
    } catch (error) {
      if (error instanceof BadRequestError || 
          error instanceof NotFoundError || 
          error instanceof ServiceUnavailableError) {
        throw error;
      }

      logger.error('Distance Matrix API Error', {
        error: error.message,
        stack: error.stack,
        origin: validOrigin,
        destination: validDestination,
        response: error.response?.data
      });

      if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
        throw new ServiceUnavailableError('Distance service timeout. Please try again');
      }

      throw new ServiceUnavailableError('Distance service failed');
    }
  }

  /**
   * Batch geocode multiple addresses
   */
  async batchGeocode(addresses) {
    if (!Array.isArray(addresses)) {
      throw new BadRequestError('Addresses must be an array');
    }

    if (addresses.length === 0) {
      throw new BadRequestError('At least one address is required');
    }

    if (addresses.length > 100) {
      throw new BadRequestError('Maximum 100 addresses per batch');
    }

    const results = [];
    const errors = [];

    for (let i = 0; i < addresses.length; i++) {
      try {
        const location = await this.geocode(addresses[i]);
        results.push({ address: addresses[i], location, success: true });
      } catch (error) {
        errors.push({ 
          address: addresses[i], 
          error: error.message, 
          success: false 
        });
      }
    }

    logger.info('Batch geocode completed', {
      total: addresses.length,
      successful: results.length,
      failed: errors.length
    });

    return { results, errors };
  }

  /**
   * Clear cache
   */
  clearCache() {
    const size = GEO_CACHE.size;
    GEO_CACHE.clear();
    logger.info('Geo cache cleared', { clearedEntries: size });
  }

  /**
   * Get service statistics
   */
  getStats() {
    return {
      available: this.isAvailable(),
      requestCount: this.requestCount,
      cacheHits: this.cacheHits,
      cacheMisses: this.cacheMisses,
      cacheSize: GEO_CACHE.size,
      hitRate: this.requestCount > 0 
        ? ((this.cacheHits / this.requestCount) * 100).toFixed(2) + '%' 
        : '0%'
    };
  }

  /**
   * Health check
   */
  async healthCheck() {
    if (!this.isAvailable()) {
      return {
        status: 'unavailable',
        message: 'Google Maps API key not configured'
      };
    }

    try {
      // Simple test geocode
      await this.geocode('New Delhi, India');
      return {
        status: 'healthy',
        message: 'Service is operational'
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        message: error.message
      };
    }
  }
}

export default new GeoService();
