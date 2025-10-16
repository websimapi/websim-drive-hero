import { getUnit } from 'ui';
import { CONVERSION_FACTORS } from 'config';
import { OsmService } from 'osm-service';

export class GpsService {
    constructor() {
        this.watchId = null;
        this.lastApiCallTime = 0;
        this.apiCooldown = 5000;
        this.onSpeedLimitFound = () => {};
        this.osmService = new OsmService();
        this.hasFoundInitialSpeedLimit = false;
        this.lastHeading = null;
        this.lastSpeed = null;
    }

    setSpeedLimit(limit) {
        this.currentSpeedLimit = limit;
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
            // Store heading and speed for better road matching
            if (pos.coords.heading !== null) {
                this.lastHeading = pos.coords.heading;
            }
            if (pos.coords.speed !== null) {
                this.lastSpeed = pos.coords.speed * CONVERSION_FACTORS.MPH; // Store in MPH
            }
            
            if (!this.hasFoundInitialSpeedLimit) {
                console.log('📍 First position received, fetching speed limit immediately...');
                await this.fetchSpeedLimit(pos.coords.latitude, pos.coords.longitude);
                this.hasFoundInitialSpeedLimit = true;
            } else {
                await this.fetchSpeedLimit(pos.coords.latitude, pos.coords.longitude);
            }
            successCallback(pos);
        };

        this.watchId = navigator.geolocation.watchPosition(handleSuccess, errorCallback, options);
    }

    stop() {
        if (this.watchId !== null) {
            navigator.geolocation.clearWatch(this.watchId);
            this.watchId = null;
        }
        this.hasFoundInitialSpeedLimit = false;
    }
    
    async fetchSpeedLimit(lat, lon) {
        const now = Date.now();
        if (now - this.lastApiCallTime < this.apiCooldown && this.hasFoundInitialSpeedLimit) {
            return;
        }
        this.lastApiCallTime = now;

        console.log('🌐 Calling Overpass API...');
        console.log(`Current heading: ${this.lastHeading}, speed: ${this.lastSpeed}`);
        try {
            const limitData = await this.osmService.getSpeedLimit(lat, lon, this.lastHeading, this.lastSpeed);
            console.log('Speed limit data received:', limitData);
            this.onSpeedLimitFound(limitData);
        } catch (error) {
            console.error('❌ Error fetching speed limit:', error);
            this.onSpeedLimitFound({ limit: 35, isKph: false });
        }
    }
}