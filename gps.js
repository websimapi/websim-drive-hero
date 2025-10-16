import { getUnit } from 'ui';
import { API_URL, CONVERSION_FACTORS } from 'config';

export class GpsService {
    constructor() {
        this.watchId = null;
        this.currentSpeedLimit = null;
        this.lastApiCallTime = 0;
        this.apiCooldown = 10000; // 10 seconds
        this.onSpeedLimitFound = () => {};
        this.unit = 'MPH'; // Will be updated from game
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

        // More robust query:
        // 1. Find the closest way (road) of a suitable type near the user.
        // 2. Then, get the tags (including maxspeed) for that specific way.
        const query = `
        [out:json];
        way(around:25,${lat},${lon})[highway][highway!~"^(footway|cycleway|path|steps|pedestrian)$"]->.all_ways;
        way(id:((way.all_ways.min(abs(sp(lat,lon)-osm_center_lat)+abs(sp(lat,lon)-osm_center_lon)))))->.closest_way;
        .closest_way out tags;
        `;
        const url = `${API_URL}?data=${encodeURIComponent(query)}`;

        try {
            const response = await fetch(url);
            const data = await response.json();

            if (data.elements.length > 0) {
                const road = data.elements[0];
                let speedLimitStr = road.tags.maxspeed;
                
                if (speedLimitStr) {
                    let limit = parseInt(speedLimitStr, 10);
                    
                    // Handle 'mph' suffix and unit conversions
                    if (speedLimitStr.toLowerCase().includes('mph')) {
                        if (getUnit() === 'KPH') {
                           limit = Math.round(limit * CONVERSION_FACTORS.MPH_TO_KPH);
                        }
                    } else { // Assume KPH if no unit is specified
                         if (getUnit() === 'MPH') {
                           limit = Math.round(limit / CONVERSION_FACTORS.MPH_TO_KPH);
                        }
                    }

                    if (!isNaN(limit) && limit !== this.currentSpeedLimit) {
                       this.onSpeedLimitFound(limit);
                    }
                } else {
                    // Closest road found, but it has no maxspeed tag.
                    this.onSpeedLimitFound(null);
                }
            } else {
                 // No roads found nearby, reset speed limit.
                 this.onSpeedLimitFound(null);
            }
        } catch (error) {
            console.error('Error fetching speed limit:', error);
            // In case of API error, maybe don't reset, as it could be temporary
        }
    }
}