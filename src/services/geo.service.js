// src/services/geo.service.js
import { Client, Status } from '@googlemaps/google-maps-services-js';
import logger from '../config/logger.js';
import { BadRequestError, ServiceUnavailableError } from '../utils/customError.js';

// In-memory cache (use Redis in production)
const GEO_CACHE = new Map();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

class GeoService {
  constructor() {
    if (!process.env.GOOGLE_MAPS_API_KEY) {
      logger.warn('GOOGLE_MAPS_API_KEY is not set. GeoService will be disabled.');
      this.client = null;
    } else {
      this.client = new Client({});
    }
  }

  /**
   * Check if the service is available
   */
  isAvailable() {
    return this.client !== null;
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

    const cacheKey = `geocode:${address.toLowerCase().trim()}`;
    if (GEO_CACHE.has(cacheKey) && GEO_CACHE.get(cacheKey).expiry > Date.now()) {
      logger.info('Geocode cache HIT', { address });
      return GEO_CACHE.get(cacheKey).data;
    }

    try {
      const response = await this.client.geocode({
        params: {
          address: address,
          key: process.env.GOOGLE_MAPS_API_KEY,
          region: 'IN', // Bias results to India
        },
        timeout: 5000,
      });

      if (response.data.status === Status.OK && response.data.results.length > 0) {
        const location = response.data.results[0].geometry.location;
        GEO_CACHE.set(cacheKey, { data: location, expiry: Date.now() + CACHE_TTL_MS });
        logger.info('Google Geocode SUCCESS', { address, location });
        return location; // { lat: 27.123, lng: 78.456 }
      } else {
        logger.warn('Google Geocode failed', { address, status: response.data.status });
        throw new NotFoundError(`Could not find coordinates for address: ${address}`);
      }
    } catch (error) {
      logger.error('Google Geocode API Error', {
        error: error.message,
        response: error.response?.data
      });
      throw new ServiceUnavailableError('Geocoding service failed');
    }
  }

  /**
   * Get driving distance and duration between two points
   * @param {Object} origin - {lat, lng} or address string
   * @param {Object} destination - {lat, lng} or address string
   * @returns {Promise<{distance: number, duration: number}>}
   */
  async getDistanceMatrix(origin, destination) {
    if (!this.isAvailable()) {
      throw new ServiceUnavailableError('Distance service is not configured');
    }

    const cacheKey = `dist:${JSON.stringify(origin)}|${JSON.stringify(destination)}`;
    if (GEO_CACHE.has(cacheKey) && GEO_CACHE.get(cacheKey).expiry > Date.now()) {
      logger.info('Distance Matrix cache HIT');
      return GEO_CACHE.get(cacheKey).data;
    }

    try {
      const response = await this.client.distancematrix({
        params: {
          origins: [origin],
          destinations: [destination],
          key: process.env.GOOGLE_MAPS_API_KEY,
          units: 'metric', // Returns distance in meters
          departure_time: 'now',
          region: 'IN',
        },
        timeout: 5000,
      });

      if (response.data.status === Status.OK) {
        const element = response.data.rows[0].elements[0];
        
        if (element.status === Status.OK) {
          const distanceInKm = Math.round((element.distance.value / 1000) * 10) / 10;
          const durationInMinutes = Math.round(element.duration.value / 60);
          
          const result = {
            distance: distanceInKm,
            duration: durationInMinutes,
            originAddress: response.data.origin_addresses[0],
            destinationAddress: response.data.destination_addresses[0],
          };

          GEO_CACHE.set(cacheKey, { data: result, expiry: Date.now() + CACHE_TTL_MS });
          logger.info('Google Distance Matrix SUCCESS', result);
          return result;
        } else {
          logger.warn('Google Distance Matrix element failed', { origin, destination, status: element.status });
          throw new NotFoundError(`Could not calculate route between locations. Status: ${element.status}`);
        }
      } else {
        logger.warn('Google Distance Matrix request failed', { status: response.data.status });
        throw new ServiceUnavailableError('Distance service request failed');
      }
    } catch (error) {
      logger.error('Google Distance Matrix API Error', {
        error: error.message,
        response: error.response?.data
      });
      throw new ServiceUnavailableError('Distance service failed');
    }
  }
}

export default new GeoService();