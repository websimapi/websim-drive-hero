// Rate at which points are awarded per second for good driving
export const POINT_RATE = 1;

// The speed buffer below the speed limit for earning points
// e.g. if limit is 60 MPH, good driving is between 45 and 60.
export const SPEED_BUFFER = {
    MPH: 15,
    KPH: 25 // Roughly 15 mph in kph
};

// Conversion factors
export const CONVERSION_FACTORS = {
    MPH: 2.23694, // m/s to mph
    KPH: 3.6, // m/s to kph
    MPH_TO_KPH: 1.60934
};

// OpenStreetMap Overpass API URL
export const API_URL = 'https://overpass-api.de/api/interpreter';

// Default speed limits for 'maxspeed:type' tags in the US (in MPH)
// This is not exhaustive and is a simplified heuristic.
// Source: https://wiki.openstreetmap.org/wiki/Key:maxspeed:type
export const US_SPEED_LIMITS = {
    'US:motorway': 65,
    'US:rural': 55,
    'US:urban': 35,
    'US:residential': 25,
    'US:school_zone': 20,
    'US:alley': 15,
};