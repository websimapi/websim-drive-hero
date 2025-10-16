import { getUnit } from 'ui';
import { CONVERSION_FACTORS } from 'config';
import { OsmService } from 'osm-service';

export class GpsService {
    constructor() {
        this.watchId = null;
        this.lastApiCallTime = 0;
        this.apiCooldown = 3000; // Reduced for more responsive updates
        this.onSpeedLimitFound = () => {};
        this.osmService = new OsmService();
        this.hasFoundInitialSpeedLimit = false;
        
        // Kalman filter state for position smoothing
        this.kalmanLat = null;
        this.kalmanLon = null;
        this.kalmanLatVariance = 1000;
        this.kalmanLonVariance = 1000;
        
        // Movement tracking
        this.positionHistory = [];
        this.maxHistoryLength = 10;
        this.lastValidHeading = null;
        this.lastValidSpeed = null;
        this.consecutiveStationaryCount = 0;
        
        // Road segment caching
        this.currentRoadSegment = null;
        this.roadSegmentConfidence = 0;
    }

    // Kalman filter for GPS smoothing
    kalmanFilter(measurement, variance, processNoise = 0.5) {
        if (this.kalmanLat === null) {
            // Initialize
            return { value: measurement, variance: variance };
        }
        
        // Prediction (assume no movement model, just add process noise)
        const predictedVariance = variance + processNoise;
        
        // Update
        const kalmanGain = predictedVariance / (predictedVariance + variance);
        const newValue = this.kalmanLat + kalmanGain * (measurement - this.kalmanLat);
        const newVariance = (1 - kalmanGain) * predictedVariance;
        
        return { value: newValue, variance: newVariance };
    }

    // Detect and filter GPS outliers
    isOutlier(lat, lon, accuracy) {
        if (this.positionHistory.length < 3) return false;
        
        // Check if accuracy is suspiciously bad
        if (accuracy > 50) return true;
        
        // Check if jump is too large (more than 100m from average recent positions)
        const recentPositions = this.positionHistory.slice(-5);
        const avgLat = recentPositions.reduce((sum, p) => sum + p.lat, 0) / recentPositions.length;
        const avgLon = recentPositions.reduce((sum, p) => sum + p.lon, 0) / recentPositions.length;
        
        const distance = this.calculateDistance(lat, lon, avgLat, avgLon);
        
        // Allow larger jumps at highway speeds
        const maxAllowedDistance = this.lastValidSpeed > 50 ? 100 : 50;
        
        return distance > maxAllowedDistance;
    }

    calculateDistance(lat1, lon1, lat2, lon2) {
        const R = 6371e3; // Earth radius in meters
        const φ1 = lat1 * Math.PI / 180;
        const φ2 = lat2 * Math.PI / 180;
        const Δφ = (lat2 - lat1) * Math.PI / 180;
        const Δλ = (lon2 - lon1) * Math.PI / 180;

        const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
                Math.cos(φ1) * Math.cos(φ2) *
                Math.sin(Δλ/2) * Math.sin(Δλ/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

        return R * c;
    }

    // Calculate heading from position history
    calculateHeading() {
        if (this.positionHistory.length < 2) return this.lastValidHeading;
        
        const recent = this.positionHistory.slice(-3);
        if (recent.length < 2) return this.lastValidHeading;
        
        const start = recent[0];
        const end = recent[recent.length - 1];
        
        const dLon = (end.lon - start.lon) * Math.PI / 180;
        const lat1 = start.lat * Math.PI / 180;
        const lat2 = end.lat * Math.PI / 180;
        
        const y = Math.sin(dLon) * Math.cos(lat2);
        const x = Math.cos(lat1) * Math.sin(lat2) -
                  Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
        const bearing = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
        
        return bearing;
    }

    // Calculate speed from position history
    calculateSpeed() {
        if (this.positionHistory.length < 2) return 0;
        
        const recent = this.positionHistory.slice(-2);
        const distance = this.calculateDistance(
            recent[0].lat, recent[0].lon,
            recent[1].lat, recent[1].lon
        );
        const timeDiff = (recent[1].timestamp - recent[0].timestamp) / 1000; // seconds
        
        if (timeDiff === 0) return this.lastValidSpeed || 0;
        
        const speedMs = distance / timeDiff;
        const speedMph = speedMs * 2.23694;
        
        // Sanity check - cap at reasonable max (150 mph)
        return Math.min(speedMph, 150);
    }

    requestLocation() {
        return new Promise((resolve, reject) => {
            if (!navigator.geolocation) {
                return reject(new Error("Geolocation is not supported by your browser."));
            }
            navigator.geolocation.getCurrentPosition(
                resolve,
                (err) => {
                    let message = "Could not get location. Please enable location services and refresh.";
                    if (err.code === 1) {
                        message = "Location permission denied. Please enable it in your browser settings and refresh.";
                    }
                    reject(new Error(message));
                },
                { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
            );
        });
    }

    async start(successCallback, errorCallback) {
        const options = {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 0
        };

        const handleSuccess = async (pos) => {
            const coords = pos.coords;
            const rawLat = coords.latitude;
            const rawLon = coords.longitude;
            const accuracy = coords.accuracy;
            
            console.log(`📍 Raw GPS: lat=${rawLat.toFixed(6)}, lon=${rawLon.toFixed(6)}, accuracy=${accuracy.toFixed(1)}m`);
            
            // Filter outliers
            if (this.isOutlier(rawLat, rawLon, accuracy)) {
                console.warn('⚠️ GPS outlier detected, skipping this reading');
                return;
            }
            
            // Apply Kalman filter for smooth position
            const filteredLat = this.kalmanFilter(rawLat, accuracy);
            const filteredLon = this.kalmanFilter(rawLon, accuracy);
            
            this.kalmanLat = filteredLat.value;
            this.kalmanLon = filteredLon.value;
            this.kalmanLatVariance = filteredLat.variance;
            this.kalmanLonVariance = filteredLon.variance;
            
            // Add to history
            this.positionHistory.push({
                lat: this.kalmanLat,
                lon: this.kalmanLon,
                timestamp: Date.now(),
                accuracy: accuracy
            });
            
            if (this.positionHistory.length > this.maxHistoryLength) {
                this.positionHistory.shift();
            }
            
            // Calculate heading and speed from history (more accurate than GPS heading/speed)
            let heading = this.calculateHeading();
            let speed = this.calculateSpeed();
            
            // Use GPS heading/speed as fallback or when stationary
            if (coords.heading !== null && speed < 5) {
                heading = coords.heading;
            }
            if (coords.speed !== null && coords.speed > 0) {
                // Blend GPS speed with calculated speed
                const gpsSpeedMph = coords.speed * CONVERSION_FACTORS.MPH;
                speed = (speed + gpsSpeedMph) / 2;
            }
            
            // Track stationary state
            if (speed < 1) {
                this.consecutiveStationaryCount++;
            } else {
                this.consecutiveStationaryCount = 0;
                this.lastValidHeading = heading;
                this.lastValidSpeed = speed;
            }
            
            console.log(`📊 Filtered: lat=${this.kalmanLat.toFixed(6)}, lon=${this.kalmanLon.toFixed(6)}, heading=${heading?.toFixed(1)}°, speed=${speed.toFixed(1)}mph`);
            
            // Fetch speed limit with improved data
            if (!this.hasFoundInitialSpeedLimit) {
                console.log('📍 First position received, fetching speed limit immediately...');
                await this.fetchSpeedLimit(this.kalmanLat, this.kalmanLon, heading, speed);
                this.hasFoundInitialSpeedLimit = true;
            } else {
                await this.fetchSpeedLimit(this.kalmanLat, this.kalmanLon, heading, speed);
            }
            
            // Create modified position object with filtered data
            const filteredPos = {
                coords: {
                    latitude: this.kalmanLat,
                    longitude: this.kalmanLon,
                    accuracy: accuracy,
                    speed: speed / CONVERSION_FACTORS.MPH, // Convert back to m/s
                    heading: heading,
                    altitude: coords.altitude,
                    altitudeAccuracy: coords.altitudeAccuracy
                },
                timestamp: pos.timestamp
            };
            
            successCallback(filteredPos);
        };

        this.watchId = navigator.geolocation.watchPosition(handleSuccess, errorCallback, options);
    }

    stop() {
        if (this.watchId !== null) {
            navigator.geolocation.clearWatch(this.watchId);
            this.watchId = null;
        }
        this.hasFoundInitialSpeedLimit = false;
        this.positionHistory = [];
        this.kalmanLat = null;
        this.kalmanLon = null;
        this.currentRoadSegment = null;
    }
    
    async fetchSpeedLimit(lat, lon, heading, speed) {
        const now = Date.now();
        
        // If we have a confident road segment match and haven't moved much, reuse it
        if (this.currentRoadSegment && this.roadSegmentConfidence > 0.8 && 
            now - this.lastApiCallTime < this.apiCooldown) {
            return;
        }
        
        // Always fetch on initial load or when moving at speed
        if (!this.hasFoundInitialSpeedLimit || speed > 10) {
            // Allow more frequent updates when moving
        } else if (now - this.lastApiCallTime < this.apiCooldown) {
            return;
        }
        
        this.lastApiCallTime = now;

        console.log('🌐 Calling Overpass API...');
        console.log(`Current heading: ${heading?.toFixed(1)}°, speed: ${speed?.toFixed(1)}mph`);
        try {
            const result = await this.osmService.getSpeedLimit(lat, lon, heading, speed);
            
            if (result && result.roadSegment) {
                this.currentRoadSegment = result.roadSegment;
                this.roadSegmentConfidence = result.confidence || 0.5;
            }
            
            const limitData = result ? { limit: result.limit, isKph: result.isKph } : null;
            console.log('Speed limit data received:', limitData);
            this.onSpeedLimitFound(limitData);
        } catch (error) {
            console.error('❌ Error fetching speed limit:', error);
            this.onSpeedLimitFound({ limit: 35, isKph: false });
        }
    }
}