import { getUnit } from 'ui';
import { CONVERSION_FACTORS } from 'config';
import { OsmService } from 'osm-service';

export class GpsService {
    constructor() {
        this.watchId = null;
        this.lastApiCallTime = 0;
        this.apiCooldown = 5000; // Reduced to 5 seconds for faster updates
        this.onSpeedLimitFound = () => {};
        this.osmService = new OsmService();
        this.hasFoundInitialSpeedLimit = false;
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
            // Fetch speed limit immediately on first position
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
        try {
            const limitData = await this.osmService.getSpeedLimit(lat, lon);
            console.log('Speed limit data received:', limitData);
            this.onSpeedLimitFound(limitData);
        } catch (error) {
            console.error('❌ Error fetching speed limit:', error);
            // Use default instead of null
            this.onSpeedLimitFound({ limit: 35, isKph: false });
        }
    }
}