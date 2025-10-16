import { API_URL, US_SPEED_LIMITS, HIGHWAY_TYPE_SPEED_LIMITS } from 'config';

export class OsmService {
    async getSpeedLimit(lat, lon) {
        console.log(`🔍 Fetching speed limit for coordinates: ${lat}, ${lon}`);
        
        // Try progressively larger search radii
        const radii = [50, 100, 200, 500];
        
        for (const radius of radii) {
            console.log(`Attempting radius: ${radius}m`);
            const query = `
            [out:json][timeout:10];
            way(around:${radius}, ${lat}, ${lon})[highway][highway!~"^(footway|cycleway|path|steps|pedestrian|track|construction)$"];
            out tags;
            `;

            const url = `${API_URL}?data=${encodeURIComponent(query)}`;

            try {
                const response = await fetch(url);
                const data = await response.json();

                console.log(`Found ${data.elements.length} roads within ${radius}m`);

                if (data.elements.length > 0) {
                    // Try each road until we find one with a speed limit
                    for (const road of data.elements) {
                        const speedLimit = this.parseSpeedLimit(road.tags);
                        if (speedLimit) {
                            console.log(`✅ Speed limit found: ${speedLimit.limit} ${speedLimit.isKph ? 'KPH' : 'MPH'}`);
                            console.log(`Road type: ${road.tags.highway}, Road name: ${road.tags.name || 'Unnamed'}`);
                            return speedLimit;
                        }
                    }
                    console.log(`No explicit speed limits found, checking fallbacks...`);
                    
                    // If no explicit speed limit, use the first road's implied limit
                    const fallbackLimit = this.parseSpeedLimit(data.elements[0].tags);
                    if (fallbackLimit) {
                        console.log(`✅ Using fallback speed limit: ${fallbackLimit.limit} ${fallbackLimit.isKph ? 'KPH' : 'MPH'}`);
                        return fallbackLimit;
                    }
                }
            } catch (error) {
                console.error(`Error at radius ${radius}m:`, error);
            }
        }
        
        console.warn('⚠️ No roads found within 500m - using default 35 MPH');
        return { limit: 35, isKph: false }; // Default urban speed limit
    }

    parseSpeedLimit(tags) {
        console.log(`Parsing tags:`, tags);
        
        if (tags.maxspeed) {
            const speedStr = tags.maxspeed.toLowerCase();
            const limit = parseInt(speedStr, 10);
            if (isNaN(limit)) {
                console.log(`Invalid maxspeed value: ${speedStr}`);
                return this.getImpliedSpeedLimit(tags);
            }

            const isKph = !speedStr.includes('mph');
            console.log(`Found explicit maxspeed: ${limit} ${isKph ? 'KPH' : 'MPH'}`);
            return { limit, isKph };
        }

        if (tags['maxspeed:type']) {
            const speedType = tags['maxspeed:type'];
            if (speedType.startsWith('US:') && US_SPEED_LIMITS[speedType]) {
                console.log(`Found maxspeed:type: ${speedType} = ${US_SPEED_LIMITS[speedType]} MPH`);
                return { limit: US_SPEED_LIMITS[speedType], isKph: false };
            }
        }
        
        return this.getImpliedSpeedLimit(tags);
    }

    getImpliedSpeedLimit(tags) {
        if (tags.highway && HIGHWAY_TYPE_SPEED_LIMITS[tags.highway]) {
            console.log(`Using implied speed limit for ${tags.highway}: ${HIGHWAY_TYPE_SPEED_LIMITS[tags.highway]} MPH`);
            return { limit: HIGHWAY_TYPE_SPEED_LIMITS[tags.highway], isKph: false };
        }
        console.log(`No speed limit found for highway type: ${tags.highway}`);
        return null;
    }
}