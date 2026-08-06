import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const AIRPORTS_URL = 'https://raw.githubusercontent.com/davidmegginson/ourairports-data/main/airports.csv';
const COUNTRIES_URL = 'https://raw.githubusercontent.com/davidmegginson/ourairports-data/main/countries.csv';

function parseCsv(csvText) {
  const lines = csvText.split('\n');
  const headers = parseCsvLine(lines[0]);
  const rows = [];
  
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const values = parseCsvLine(line);
    const row = {};
    headers.forEach((header, idx) => {
      row[header] = values[idx] || '';
    });
    rows.push(row);
  }
  return rows;
}

function parseCsvLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

const CITY_OVERRIDES = {
  ATH: 'Athens',
  EDI: 'Edinburgh',
  MXP: 'Milan',
  NRT: 'Tokyo',
  HND: 'Tokyo',
  FCO: 'Rome',
  CDG: 'Paris',
  LHR: 'London',
  KRK: 'Krakow',
  DXB: 'Dubai',
  LAX: 'Los Angeles',
  SIN: 'Singapore',
  AMS: 'Amsterdam',
  SYD: 'Sydney',
  BCN: 'Barcelona',
  HKG: 'Hong Kong',
  MAD: 'Madrid',
  BER: 'Berlin',
  MUC: 'Munich',
  VIE: 'Vienna',
  PRG: 'Prague',
  BUD: 'Budapest',
  LIS: 'Lisbon',
  DUB: 'Dublin',
  ZRH: 'Zurich',
  MIA: 'Miami',
  ICN: 'Seoul',
  BKK: 'Bangkok',
  CPH: 'Copenhagen',
  GIG: 'Rio de Janeiro',
  TLV: 'Tel Aviv',
  JFK: 'New York'
};

async function buildCatalog() {
  try {
    console.log('[buildCatalog] Fetching countries data...');
    const countriesResp = await fetch(COUNTRIES_URL);
    if (!countriesResp.ok) {
      throw new Error(`Failed to fetch countries: HTTP ${countriesResp.status}`);
    }
    const countriesCsv = await countriesResp.text();
    const countries = parseCsv(countriesCsv);
    const countryMap = {};
    countries.forEach(c => {
      countryMap[c.code] = c.name;
    });
    console.log(`[buildCatalog] Loaded ${Object.keys(countryMap).length} countries.`);

    console.log('[buildCatalog] Fetching airports data...');
    const airportsResp = await fetch(AIRPORTS_URL);
    if (!airportsResp.ok) {
      throw new Error(`Failed to fetch airports: HTTP ${airportsResp.status}`);
    }
    const airportsCsv = await airportsResp.text();
    const airports = parseCsv(airportsCsv);
    console.log(`[buildCatalog] Loaded ${airports.length} raw airports.`);

    const generated = {};
    const keepTypes = new Set(['large_airport', 'medium_airport']);
    
    airports.forEach(a => {
      if (!keepTypes.has(a.type)) return;
      if (a.scheduled_service !== 'yes') return;
      const iata = (a.iata_code || '').trim().toUpperCase();
      if (!iata || iata.length !== 3) return;
      
      const city = CITY_OVERRIDES[iata] || a.municipality || '';
      
      generated[iata] = {
        code: iata,
        name: a.name,
        city,
        country: countryMap[a.iso_country] || a.iso_country,
        countryCode: a.iso_country,
        coords: [parseFloat(a.latitude_deg), parseFloat(a.longitude_deg)]
      };
    });

    const outputFilePath = path.join(__dirname, '../shared/catalog.generated.js');
    const content = `/**
 * GENERATED FILE - DO NOT EDIT MANUALLY
 * Generated at: ${new Date().toISOString()}
 * Source: OurAirports (ourairports-data)
 */

export const GENERATED_AIRPORTS = ${JSON.stringify(generated, null, 2)};
`;

    fs.writeFileSync(outputFilePath, content, 'utf-8');
    console.log(`[buildCatalog] Success! Generated ${Object.keys(generated).length} airports in shared/catalog.generated.js`);
  } catch (err) {
    console.error('[buildCatalog] Build failed:', err.message);
    process.exit(1);
  }
}

buildCatalog();
