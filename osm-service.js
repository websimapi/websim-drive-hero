import { API_URL, US_SPEED_LIMITS, HIGHWAY_TYPE_SPEED_LIMITS } from 'config';

export class OsmService {
    async getSpeedLimit(lat, lon) {
        // This simplified query finds the single nearest way (road) within a 50m radius
        // that has a 'highway' tag and isn't a minor path. It's more direct and robust.
        const query = `
        [out:json][timeout:10];
        way(around:50, ${lat}, ${lon})[highway][highway!~"^(footway|cycleway|path|steps|pedestrian|track|service|rest_area|escape|construction)$"];
        out tags;
        `;

        const url = `${API_URL}?data=${encodeURIComponent(query)}`;

        try {
            const response = await fetch(url);
            const data = await response.json();

            if (data.elements.length > 0) {
                // With multiple results, we assume the first one is close enough for this use case.
                // A more complex implementation might calculate the closest, but Overpass
                // tends to return relevant results first.
                const road = data.elements[0];
                return this.parseSpeedLimit(road.tags);
            }
            return null; // No roads found
        } catch (error) {
            console.error('Overpass API error:', error);
            throw error; // Re-throw to be handled by GpsService
        }
    }

    parseSpeedLimit(tags) {
        if (tags.maxspeed) {
            const speedStr = tags.maxspeed.toLowerCase();
            const limit = parseInt(speedStr, 10);
            if (isNaN(limit)) return this.getImpliedSpeedLimit(tags);

            const isKph = !speedStr.includes('mph');
            return { limit, isKph };
        }

        if (tags['maxspeed:type']) {
            const speedType = tags['maxspeed:type'];
            if (speedType.startsWith('US:') && US_SPEED_LIMITS[speedType]) {
                return { limit: US_SPEED_LIMITS[speedType], isKph: false }; // US limits are in MPH
            }
        }
        
        // Fallback to implied speed limit based on highway type
        return this.getImpliedSpeedLimit(tags);
    }

    getImpliedSpeedLimit(tags) {
        if (tags.highway && HIGHWAY_TYPE_SPEED_LIMITS[tags.highway]) {
            // Implied speed limits from config are in MPH
            return { limit: HIGHWAY_TYPE_SPEED_LIMITS[tags.highway], isKph: false };
        }
        return null; // No parsable or implied speed limit found
    }
}