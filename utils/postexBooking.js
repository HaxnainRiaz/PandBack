const postexService = require('../services/postex.service');

const CITY_ALIASES = {
    'lahore': 'Lahore',
    'karachi': 'Karachi',
    'islamabad': 'Islamabad',
    'rawalpindi': 'Rawalpindi',
    'faisalabad': 'Faisalabad',
    'multan': 'Multan',
    'peshawar': 'Peshawar',
    'quetta': 'Quetta',
    'sialkot': 'Sialkot',
    'gujranwala': 'Gujranwala',
    'hyderabad': 'Hyderabad',
    'sargodha': 'Sargodha',
    'bahawalpur': 'Bahawalpur',
    'sukkur': 'Sukkur',
    'larkana': 'Larkana',
    'abbottabad': 'Abbottabad',
    'mardan': 'Mardan',
    'gujrat': 'Gujrat',
    'sahiwal': 'Sahiwal',
    'wah cantonment': 'Wah Cantt',
    'wah cantt': 'Wah Cantt'
};

/**
 * Fuzzy-match a customer city to a PostEx operational city name.
 */
function matchOperationalCity(inputCity, cities = []) {
    if (!inputCity || !cities.length) return null;

    const normalized = String(inputCity).trim().toLowerCase();
    if (!normalized) return null;

    const alias = CITY_ALIASES[normalized];
    if (alias) {
        const aliasMatch = cities.find(c => c.name?.toLowerCase() === alias.toLowerCase());
        if (aliasMatch) return aliasMatch.name;
    }

    const exact = cities.find(c => c.name?.toLowerCase() === normalized);
    if (exact) return exact.name;

    const partial = cities.find(c => {
        const cityLower = c.name?.toLowerCase() || '';
        return cityLower.includes(normalized) || normalized.includes(cityLower);
    });
    if (partial) return partial.name;

    const token = normalized.split(/[\s,/]+/)[0];
    if (token && token.length > 2) {
        const tokenMatch = cities.find(c => c.name?.toLowerCase().startsWith(token));
        if (tokenMatch) return tokenMatch.name;
    }

    return null;
}

function pickFirstAddressCode(addresses, preferredType) {
    if (!Array.isArray(addresses) || !addresses.length) return null;

    const byType = addresses.find(a =>
        String(a.addressType || '').toLowerCase().includes(preferredType.toLowerCase()) && a.addressCode
    );
    if (byType?.addressCode) return byType.addressCode;

    const any = addresses.find(a => a.addressCode);
    return any?.addressCode || null;
}

/**
 * PostEx requires at least one of pickupAddressCode or storeAddressCode.
 */
function resolveAddressCodes({ pickupAddressCode, storeAddressCode, integration, addresses = [] }) {
    let pickup = (pickupAddressCode || integration?.defaultPickupAddressCode || '').trim();
    let store = (storeAddressCode || integration?.defaultStoreAddressCode || '').trim();

    if (!pickup) {
        pickup = pickFirstAddressCode(addresses, 'pickup') || '';
    }
    if (!store) {
        store = pickFirstAddressCode(addresses, 'store') || '';
    }

    if (!pickup && !store) {
        return {
            pickupAddressCode: null,
            storeAddressCode: null,
            error: 'No pickup or store address configured. Set defaults in PostEx → Settings or add a merchant address in your PostEx account.'
        };
    }

    const result = {};
    if (pickup) result.pickupAddressCode = pickup;
    if (store) result.storeAddressCode = store;
    return result;
}

/**
 * Load cities + addresses and enrich a booking payload before PostEx API call.
 */
async function prepareBookingPayload(ownerId, payload, integration) {
    const [cities, addresses] = await Promise.all([
        postexService.getOperationalCities(ownerId).catch(() => []),
        postexService.getPickupAddresses(ownerId).catch(() => [])
    ]);

    const matchedCity = matchOperationalCity(payload.cityName, cities);
    if (!matchedCity) {
        const available = cities.slice(0, 8).map(c => c.name).join(', ');
        return {
            error: `City "${payload.cityName || ''}" is not a PostEx operational city. Select a valid city${available ? ` (e.g. ${available})` : ''}.`,
            cities,
            addresses
        };
    }

    const codes = resolveAddressCodes({
        pickupAddressCode: payload.pickupAddressCode,
        storeAddressCode: payload.storeAddressCode,
        integration,
        addresses
    });

    if (codes.error) {
        return { error: codes.error, cities, addresses };
    }

    return {
        payload: {
            ...payload,
            cityName: matchedCity,
            ...codes
        },
        cities,
        addresses,
        matchedCity
    };
}

/**
 * Process items with limited concurrency to avoid MongoDB pool exhaustion.
 */
async function mapWithConcurrency(items, fn, limit = 3) {
    const results = [];
    for (let i = 0; i < items.length; i += limit) {
        const batch = items.slice(i, i + limit);
        const batchResults = await Promise.allSettled(batch.map(fn));
        results.push(...batchResults);
    }
    return results;
}

module.exports = {
    matchOperationalCity,
    resolveAddressCodes,
    prepareBookingPayload,
    mapWithConcurrency,
    pickFirstAddressCode
};
