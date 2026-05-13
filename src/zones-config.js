// ============================================================
// SMARTPARK ZONE DEFINITIONS — Single Source of Truth
// ============================================================
// All zone geometry, capacity, and metadata lives here.
// Used by: dummy-data.js, firebase-seed.js, data-generator.js
// Works in both Browser (window.ZONE_DEFINITIONS) and Node (module.exports).
// ============================================================

(function (root) {
    const ZONE_DEFINITIONS = [
        {
            id: 'zone_ss15_4',
            name: 'Jalan SS15/4',
            center: { lat: 3.0765, lng: 101.5890 },
            radius: 150,
            totalLots: 50,
            targetOccupancy: 0.70,
            isActive: true,
        },
        {
            id: 'zone_ss15_8',
            name: 'Jalan SS15/8',
            center: { lat: 3.0750, lng: 101.5895 },
            radius: 120,
            totalLots: 40,
            targetOccupancy: 0.95,
            isActive: true,
        },
        {
            id: 'zone_usj10_taipan',
            name: 'USJ 10 Taipan',
            center: { lat: 3.0485, lng: 101.5850 },
            radius: 200,
            totalLots: 120,
            targetOccupancy: 0.375,
            isActive: true,
        },
        {
            id: 'zone_ss16_1',
            name: 'Jalan SS16/1',
            center: { lat: 3.0820, lng: 101.5865 },
            radius: 180,
            totalLots: 75,
            targetOccupancy: 0.80,
            isActive: true,
        },
        {
            id: 'zone_ss17_1e',
            name: 'Jalan SS17/1E',
            center: { lat: 3.07597, lng: 101.58010 },
            radius: 200,
            bufferMeters: 35,
            totalLots: 40,
            targetOccupancy: 0.60,
            isActive: true,
            line: [
                { lat: 3.077359121599855,  lng: 101.58049118471104 },
                { lat: 3.0770779840562454, lng: 101.58043347219171 },
                { lat: 3.077049169401164,  lng: 101.58042957269771 },
                { lat: 3.076699191195715,  lng: 101.58032093230793 },
                { lat: 3.0764660411565927, lng: 101.5802499517277  },
                { lat: 3.0761054317447503, lng: 101.58015388301482 },
                { lat: 3.075641876459102,  lng: 101.58001257976917 },
                { lat: 3.0745650069976165, lng: 101.57970801776668 },
            ],
        },
        {
            id: 'zone_ss17_1b',
            name: 'Jalan SS17/1B',
            center: { lat: 3.07856, lng: 101.58066 },
            radius: 70,
            bufferMeters: 35,
            totalLots: 30,
            targetOccupancy: 0.17,
            isActive: true,
            line: [
                { lat: 3.0784821661062836, lng: 101.57993950376465 },
                { lat: 3.0786421942890456, lng: 101.58137902736576 },
            ],
        },
    ];

    // Outside-zone payer specs (paid, GPS outside any geofence)
    const OUTSIDE_ZONE_SPECS = [
        { vehicleId: 'VEH_OUT_001', lat: 3.07800, lng: 101.59050, start: -25, duration: 60 },
        { vehicleId: 'VEH_OUT_002', lat: 3.07300, lng: 101.58800, start: -10, duration: 45 },
        { vehicleId: 'VEH_OUT_003', lat: 3.04600, lng: 101.57800, start: -40, duration: 90 },
        { vehicleId: 'VEH_OUT_004', lat: 3.08350, lng: 101.58800, start: -15, duration: 30 },
        { vehicleId: 'VEH_OUT_005', lat: 3.07500, lng: 101.59200, start: -50, duration: 120 },
    ];

    // Browser
    if (typeof window !== 'undefined') {
        root.ZONE_DEFINITIONS = ZONE_DEFINITIONS;
        root.OUTSIDE_ZONE_SPECS = OUTSIDE_ZONE_SPECS;
    }
    // Node
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { ZONE_DEFINITIONS, OUTSIDE_ZONE_SPECS };
    }
})(typeof self !== 'undefined' ? self : this);
