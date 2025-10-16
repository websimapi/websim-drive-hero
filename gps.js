import { getUnit } from 'ui';
import { API_URL, CONVERSION_FACTORS } from 'config';

export class GpsService {
    constructor(unit) {
        this.watchId = null;
        this.currentSpeedLimit = null;
        this.lastApiCallTime = 0;
        this.apiCooldown = 10000; // 10 seconds
        this.onSpeedLimitFound = () => {};
        this.unit = unit;
    }

    setSpeedLimit(limit) {
        this.currentSpeedLimit = limit;
    }

    async start(successCallback, errorCallback) {
        if (!navigator.geolocation) {
            throw new Error("Geolocation is not supported by your browser.");
        }

        return new Promise((resolve, reject) => {
            const options = {
                enableHighAccuracy: true,
                timeout: 10000,
                maximumAge: 0
            };

            // Wrap callbacks to include speed limit fetching
            const handleSuccess = async (pos) => {
                await this.fetchSpeedLimit(pos.coords.latitude, pos.coords.longitude);
                successCallback(pos);
            };

            const handleError = (err) => {
                errorCallback(err);
                reject(err); // reject promise on first error
            };

            // Get an initial position to make sure permissions are granted before starting the watch
            navigator.geolocation.getCurrentPosition(
                (pos) => {
                    this.watchId = navigator.geolocation.watchPosition(handleSuccess, handleError, options);
                    handleSuccess(pos); // Process initial position
                    resolve();
                },
                (err) => {
                    let message = "Could not get location. Please enable location services.";
                    if (err.code === 1) { // PERMISSION_DENIED
                        message = "Location permission denied. Please enable it in your browser settings.";
                    }
                    errorCallback({ ...err, message });
                    reject(new Error(message));
                },
                options
            );
        });
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

        const query = `[out:json];way(around:25,${lat},${lon})[maxspeed];out tags;`;
        const url = `${API_URL}?data=${encodeURIComponent(query)}`;

        try {
            const response = await fetch(url);
            const data = await response.json();

            if (data.elements.length > 0) {
                const road = data.elements[0];
                let speedLimitStr = road.tags.maxspeed;
                
                if (speedLimitStr) {
                    let limit = parseInt(speedLimitStr, 10);
                    
                    if (speedLimitStr.includes('mph')) {
                        // It's in MPH. Convert to KPH if needed.
                        if (getUnit() === 'KPH') {
                           limit = Math.round(limit * CONVERSION_FACTORS.MPH_TO_KPH);
                        }
                    } else {
                        // Assume KPH. Convert to MPH if needed.
                         if (getUnit() === 'MPH') {
                           limit = Math.round(limit / CONVERSION_FACTORS.MPH_TO_KPH);
                        }
                    }

                    if (!isNaN(limit) && limit !== this.currentSpeedLimit) {
                       this.onSpeedLimitFound(limit);
                    }
                }
            } else {
                 // No speed limit found, maybe reset it?
                 // this.onSpeedLimitFound(null);
            }
        } catch (error) {
            console.error('Error fetching speed limit:', error);
        }
    }
}

