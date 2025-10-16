import { API_URL, US_SPEED_LIMITS } from 'config';

export class OsmService {
    async getSpeedLimit(lat, lon) {
        // Query for the nearest road with a highway tag, and get its tags.
        const query = `
        [out:json][timeout:10];
        // find nearest way to point
        way(around:50, ${lat}, ${lon})[highway][highway!~"^(footway|cycleway|path|steps|pedestrian|track|service|rest_area|escape)$"]->.ways;
        // get tags of the nearest way
        (
          way.ways(filter:select(0, min(geodist(center(geom), ${lat}, ${lon}))));
        );
        out tags;
        `;

        const url = `${API_URL}?data=${encodeURIComponent(query)}`;

        try {
            const response = await fetch(url);
            const data = await response.json();

            if (data.elements.length > 0) {
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
            if (isNaN(limit)) return null;

            const isKph = !speedStr.includes('mph');
            return { limit, isKph };
        }

        if (tags['maxspeed:type']) {
            const speedType = tags['maxspeed:type'];
            if (speedType.startsWith('US:') && US_SPEED_LIMITS[speedType]) {
                return { limit: US_SPEED_LIMITS[speedType], isKph: false }; // US limits are in MPH
            }
            // Could add more parsers for other countries here, e.g. DE, UK etc.
        }

        return null; // No parsable speed limit tag found
    }
}