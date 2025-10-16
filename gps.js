import { getUnit } from 'ui';
import { CONVERSION_FACTORS } from 'config';
import { OsmService } from 'osm-service';

export class GpsService {
    constructor() {
        this.watchId = null;
        this.currentSpeedLimit = null;
        this.lastApiCallTime = 0;
        this.apiCooldown = 10000; // 10 seconds
        this.onSpeedLimitFound = () => {};
        this.osmService = new OsmService();
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
                    if (err.code === 1) { // PERMISSION_DENIED
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
            await this.fetchSpeedLimit(pos.coords.latitude, pos.coords.longitude);
            successCallback(pos);
        };

        this.watchId = navigator.geolocation.watchPosition(handleSuccess, errorCallback, options);
    }

    stop() {
        if (this.watchId !== null) {
            navigator.geolocation.clearWatch(this.watchId);
            this.watchId = null;
        }
    }
    
    async fetchSpeedLimit(lat, lon) {
        const now = Date.now();
        if (now - this.lastApiCallTime < this.apiCooldown) {
            return;
        }
        this.lastApiCallTime = now;

        try {
            const limitData = await this.osmService.getSpeedLimit(lat, lon);
            
            if (limitData) {
                let { limit, isKph } = limitData;

                const currentUnit = getUnit();

                // Perform unit conversions if necessary
                if (isKph && currentUnit === 'MPH') {
                    limit = Math.round(limit / CONVERSION_FACTORS.MPH_TO_KPH);
                } else if (!isKph && currentUnit === 'KPH') {
                    limit = Math.round(limit * CONVERSION_FACTORS.MPH_TO_KPH);
                }
                
                if (limit !== this.currentSpeedLimit) {
                    this.onSpeedLimitFound(limit);
                }
            } else {
                // No speed limit found for the nearest road
                this.onSpeedLimitFound(null);
            }

        } catch (error) {
            console.error('Error fetching speed limit:', error);
            // In case of API error, maybe don't reset, as it could be temporary.
            // Or we could call onSpeedLimitFound(null) here if we want to be strict.
        }
    }
}