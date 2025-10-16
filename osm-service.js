import { API_URL, US_SPEED_LIMITS, HIGHWAY_TYPE_SPEED_LIMITS } from 'config';

export class OsmService {
    constructor() {
        this.roadCache = new Map(); // Cache road segments
        this.cacheTimeout = 30000; // 30 seconds
    }

    async getSpeedLimit(lat, lon, heading = null, speed = null) {
        console.log(`🔍 Fetching speed limit for coordinates: ${lat.toFixed(6)}, ${lon.toFixed(6)}, heading: ${heading?.toFixed(1)}°, speed: ${speed?.toFixed(1)}mph`);
        
        // Determine search radius based on speed and accuracy needs
        const baseRadius = speed > 50 ? 100 : 50; // Larger radius at highway speeds
        const radii = [baseRadius, baseRadius * 2, baseRadius * 4];
        
        for (const radius of radii) {
            console.log(`Attempting radius: ${radius}m`);
            
            // Build smarter query - exclude non-drivable roads
            const query = `
            [out:json][timeout:10];
            way(around:${radius}, ${lat}, ${lon})
              [highway]
              [highway!~"^(footway|cycleway|path|steps|pedestrian|track|construction|bridleway|corridor|platform|proposed|raceway)$"]
              [access!~"^(private|no)$"];
            out geom;
            `;

            const url = `${API_URL}?data=${encodeURIComponent(query)}`;

            try {
                const response = await fetch(url);
                const data = await response.json();

                console.log(`Found ${data.elements.length} roads within ${radius}m`);

                if (data.elements.length > 0) {
                    // Advanced scoring with map-matching
                    const scoredRoads = data.elements.map(road => {
                        const match = this.mapMatchRoad(road, lat, lon, heading, speed);
                        return { road, ...match };
                    });
                    
                    // Sort by confidence score (highest first)
                    scoredRoads.sort((a, b) => b.confidence - a.confidence);
                    
                    console.log(`Top 3 roads by confidence:`, scoredRoads.slice(0, 3).map(r => ({
                        name: r.road.tags.name || 'Unnamed',
                        highway: r.road.tags.highway,
                        confidence: r.confidence.toFixed(3),
                        distance: r.distance.toFixed(1) + 'm',
                        headingMatch: r.headingScore.toFixed(2)
                    })));
                    
                    // Use the best match if confidence is reasonable
                    const bestMatch = scoredRoads[0];
                    if (bestMatch.confidence > 0.3) {
                        const speedLimit = this.parseSpeedLimit(bestMatch.road.tags);
                        if (speedLimit) {
                            console.log(`✅ Speed limit found: ${speedLimit.limit} ${speedLimit.isKph ? 'KPH' : 'MPH'} (confidence: ${bestMatch.confidence.toFixed(2)})`);
                            console.log(`Road: ${bestMatch.road.tags.name || 'Unnamed'} (${bestMatch.road.tags.highway})`);
                            return {
                                ...speedLimit,
                                confidence: bestMatch.confidence,
                                roadSegment: bestMatch.road,
                                distance: bestMatch.distance
                            };
                        }
                    }
                }
            } catch (error) {
                console.error(`Error at radius ${radius}m:`, error);
            }
        }
        
        console.warn('⚠️ No confident road match found - using default 35 MPH');
        return { limit: 35, isKph: false, confidence: 0 };
    }
    
    // Advanced map-matching algorithm
    mapMatchRoad(road, userLat, userLon, userHeading, userSpeed) {
        if (!road.geometry || road.geometry.length < 2) {
            return { confidence: 0, distance: Infinity, headingScore: 0 };
        }
        
        // Find closest point on road
        let minDist = Infinity;
        let closestSegmentIndex = 0;
        let closestPoint = null;
        
        for (let i = 0; i < road.geometry.length - 1; i++) {
            const p1 = road.geometry[i];
            const p2 = road.geometry[i + 1];
            const result = this.pointToSegment(userLat, userLon, p1.lat, p1.lon, p2.lat, p2.lon);
            
            if (result.distance < minDist) {
                minDist = result.distance;
                closestSegmentIndex = i;
                closestPoint = result.point;
            }
        }
        
        let confidence = 0;
        let headingScore = 0;
        
        // Distance score (closer = better, exponential decay)
        const distanceScore = Math.exp(-minDist / 20); // 20m half-life
        confidence += distanceScore * 0.4;
        
        // Heading alignment score
        if (userHeading !== null && userSpeed > 5) { // Only use heading when moving
            const p1 = road.geometry[closestSegmentIndex];
            const p2 = road.geometry[closestSegmentIndex + 1];
            
            const roadBearing = this.calculateBearing(p1.lat, p1.lon, p2.lat, p2.lon);
            
            // Calculate smallest angle difference
            let headingDiff = Math.abs(userHeading - roadBearing);
            if (headingDiff > 180) {
                headingDiff = 360 - headingDiff;
            }
            
            // Check reverse direction too (might be on opposite side of divided highway)
            const reverseHeadingDiff = Math.abs((userHeading - ((roadBearing + 180) % 360)));
            const minHeadingDiff = Math.min(headingDiff, reverseHeadingDiff > 180 ? 360 - reverseHeadingDiff : reverseHeadingDiff);
            
            headingScore = 1 - (minHeadingDiff / 90); // 90° = no match, 0° = perfect match
            headingScore = Math.max(0, headingScore);
            
            confidence += headingScore * 0.4;
            
            console.log(`Road ${road.tags.name || 'Unnamed'}: roadBearing=${roadBearing.toFixed(1)}°, userHeading=${userHeading.toFixed(1)}°, diff=${minHeadingDiff.toFixed(1)}°`);
        } else {
            confidence += 0.2; // Neutral when no heading available
        }
        
        // Road type priority (major roads more likely)
        const roadTypePriority = {
            'motorway': 1.0,
            'trunk': 0.95,
            'primary': 0.9,
            'secondary': 0.8,
            'tertiary': 0.7,
            'motorway_link': 0.85,
            'trunk_link': 0.8,
            'primary_link': 0.75,
            'secondary_link': 0.7,
            'residential': 0.6,
            'unclassified': 0.5,
            'living_street': 0.4,
        };
        
        const typePriority = roadTypePriority[road.tags.highway] || 0.5;
        confidence += typePriority * 0.2;
        
        // Bonus for named roads
        if (road.tags.name && road.tags.name.length > 0) {
            confidence += 0.1;
        }
        
        // Penalty for service roads, parking aisles
        if (road.tags.highway === 'service' || road.tags.service === 'parking_aisle') {
            confidence *= 0.3;
        }
        
        return {
            confidence: Math.min(confidence, 1),
            distance: minDist,
            headingScore: headingScore,
            closestPoint: closestPoint
        };
    }
    
    // Point to line segment projection
    pointToSegment(px, py, x1, y1, x2, y2) {
        const A = px - x1;
        const B = py - y1;
        const C = x2 - x1;
        const D = y2 - y1;
        
        const dot = A * C + B * D;
        const lenSq = C * C + D * D;
        let param = -1;
        
        if (lenSq !== 0) {
            param = dot / lenSq;
        }
        
        let xx, yy;
        
        if (param < 0) {
            xx = x1;
            yy = y1;
        } else if (param > 1) {
            xx = x2;
            yy = y2;
        } else {
            xx = x1 + param * C;
            yy = y1 + param * D;
        }
        
        const dx = px - xx;
        const dy = py - yy;
        
        // Convert to meters
        const latMeters = dy * 111000;
        const lonMeters = dx * 111000 * Math.cos(px * Math.PI / 180);
        const distance = Math.sqrt(latMeters * latMeters + lonMeters * lonMeters);
        
        return {
            distance: distance,
            point: { lat: xx, lon: yy }
        };
    }
    
    calculateBearing(lat1, lon1, lat2, lon2) {
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const y = Math.sin(dLon) * Math.cos(lat2 * Math.PI / 180);
        const x = Math.cos(lat1 * Math.PI / 180) * Math.sin(lat2 * Math.PI / 180) -
                  Math.sin(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.cos(dLon);
        const bearing = Math.atan2(y, x) * 180 / Math.PI;
        return (bearing + 360) % 360;
    }

    parseSpeedLimit(tags) {
        console.log(`Parsing tags:`, tags);
        
        // Try explicit maxspeed first
        if (tags.maxspeed) {
            const speedStr = tags.maxspeed.toLowerCase();
            
            // Handle "none", "signals", "variable" etc.
            if (speedStr === 'none' || speedStr === 'signals' || speedStr === 'variable') {
                return this.getImpliedSpeedLimit(tags);
            }
            
            const limit = parseInt(speedStr, 10);
            if (isNaN(limit)) {
                console.log(`Invalid maxspeed value: ${speedStr}`);
                return this.getImpliedSpeedLimit(tags);
            }

            const isKph = !speedStr.includes('mph');
            console.log(`Found explicit maxspeed: ${limit} ${isKph ? 'KPH' : 'MPH'}`);
            return { limit, isKph };
        }

        // Try maxspeed:type
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