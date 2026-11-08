/** Pure helpers shared by the NYC 311 map and its data checks. */
export const API_URL = 'https://data.cityofnewyork.us/resource/erm2-nwe9.json';

// One shared ordered definition keeps the browser legend and server query aligned.
const rules = [
  { id: 'noise', label: 'Noise', color: '#9471cb', terms: ['noise'] },
  { id: 'sanitation', label: 'Sanitation', color: '#2b9d8f', terms: ['sanitation', 'trash', 'garbage', 'dirty', 'rodent', 'rat sight', 'recycling', 'litter', 'dumping', 'missed collection', 'waste', 'sweeping', 'dead animal', 'overflowing basket'] },
  { id: 'streets', label: 'Streets', color: '#e59a54', terms: ['parking', 'road', 'street', 'traffic', 'sidewalk', 'pothole', 'curb', 'highway', 'blocked driveway', 'derelict vehicle', 'bike lane', 'bus stop', 'bridge'] },
  { id: 'buildings', label: 'Buildings', color: '#658eca', terms: ['heat', 'water', 'plumbing', 'elevator', 'housing', 'building', 'construction', 'electric', 'paint', 'plaster', 'door', 'window', 'floor', 'ceiling', 'mold', 'mould', 'appliance', 'unsanitary condition', 'lead', 'general repair', 'boiler'] },
];

export const CATEGORIES = Object.freeze([
  { id: 'all', label: 'All reports', color: '#28594a' },
  rules.find(rule => rule.id === 'streets'),
  rules.find(rule => rule.id === 'sanitation'),
  rules.find(rule => rule.id === 'noise'),
  rules.find(rule => rule.id === 'buildings'),
  { id: 'other', label: 'Other', color: '#85938d' },
].map(({ id, label, color }) => Object.freeze({ id, label, color })));

const categoryMap = new Map(CATEGORIES.map(category => [category.id, category]));
const boroughs = new Set(['MANHATTAN', 'BROOKLYN', 'QUEENS', 'BRONX', 'STATEN ISLAND']);
// Sort by the indexed timestamp without filtering on the unindexed location
// columns. Coordinate validity is checked locally by normalizeReport().
export function buildLatestReportUrl() {
  const url = new URL(API_URL);
  url.searchParams.set('$select', 'created_date');
  url.searchParams.set('$order', 'created_date DESC, unique_key DESC');
  url.searchParams.set('$limit', '1');
  return url.toString();
}

const clean = (value, fallback = '') => value == null ? fallback : String(value).trim() || fallback;

export function categoryFor(complaintType) {
  const title = clean(complaintType).toLowerCase();
  return rules.find(rule => rule.terms.some(term => title.includes(term)))?.id || 'other';
}

/** Reports without a usable NYC location cannot be represented as map points. */
export function normalizeReport(row) {
  if (!row || typeof row !== 'object') return null;
  const id = clean(row.unique_key);
  if (!id || !clean(row.latitude) || !clean(row.longitude)) return null;
  const latitude = Number(row.latitude);
  const longitude = Number(row.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) ||
      latitude < 40.47 || latitude > 40.94 || longitude < -74.30 || longitude > -73.65) return null;

  const title = clean(row.complaint_type, 'Unspecified issue');
  const category = categoryFor(title);
  const status = clean(row.status, 'Unknown');
  return {
    id,
    title,
    detail: clean(row.descriptor, 'No additional details provided'),
    address: clean(row.incident_address, 'Address unavailable'),
    borough: clean(row.borough, 'UNSPECIFIED').toUpperCase(),
    zip: clean(row.incident_zip),
    status,
    isClosed: status.toLowerCase() === 'closed',
    agency: clean(row.agency, 'Unspecified'),
    agencyName: clean(row.agency_name, clean(row.agency, 'Agency unavailable')),
    created: clean(row.created_date),
    closed: clean(row.closed_date),
    description: clean(row.resolution_description, 'The agency has not published an update for this request.'),
    coordinates: [longitude, latitude],
    category,
    color: categoryMap.get(category).color,
    record: { ...row },
  };
}

const quote = value => `'${String(value).replaceAll("'", "''")}'`;

function floatingDate(value) {
  const text = clean(value);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?$/.test(text)) {
    throw new RangeError('A valid latest NYC report timestamp is required.');
  }
  // Socrata stores wall-clock timestamps, so arithmetic deliberately uses UTC
  // without converting the source's New York time into the browser's time zone.
  const date = new Date(`${text}Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 19) !== text.slice(0, 19)) {
    throw new RangeError('A valid latest NYC report timestamp is required.');
  }
  return date;
}

function ruleSql(rule) {
  return `(${rule.terms.map(term => `lower(complaint_type) like ${quote(`%${term}%`)}`).join(' OR ')})`;
}

function categorySql(category) {
  const index = rules.findIndex(rule => rule.id === category);
  if (index >= 0) {
    const current = ruleSql(rules[index]);
    const earlier = rules.slice(0, index).map(ruleSql);
    return earlier.length ? `(${current} AND NOT (${earlier.join(' OR ')}))` : current;
  }
  if (category === 'other') {
    return `(complaint_type IS NULL OR NOT (${rules.map(ruleSql).join(' OR ')}))`;
  }
  return '';
}

/** Filter on the indexed creation time; validate geographic coordinates locally. */
export function buildReportsUrl(filters = {}, latest, { limit = 5000, offset = 0 } = {}) {
  const latestDate = floatingDate(latest);
  const days = [1, 7, 30].includes(Number(filters.days)) ? Number(filters.days) : 1;
  const cutoff = new Date(latestDate.getTime() - days * 86_400_000).toISOString().slice(0, -1);
  const latestTimestamp = latestDate.toISOString().slice(0, -1);
  const where = [`created_date >= ${quote(cutoff)}`, `created_date <= ${quote(latestTimestamp)}`];
  const borough = clean(filters.borough).toUpperCase();
  if (boroughs.has(borough)) where.push(`borough = ${quote(borough)}`);
  if (filters.status === 'closed') where.push("upper(status) = 'CLOSED'");
  if (filters.status === 'open') where.push("(status IS NULL OR upper(status) != 'CLOSED')");
  if (categoryMap.has(filters.category) && filters.category !== 'all') where.push(categorySql(filters.category));
  // Keep the user's query as a text search, rather than permitting LIKE wildcards.
  const search = clean(filters.search).slice(0, 160).toLowerCase().replace(/[%_\\]/g, '').trim();
  if (search) {
    where.push(`(${['incident_address', 'complaint_type', 'descriptor', 'incident_zip', 'unique_key'].map(field => `lower(${field}) like ${quote(`%${search}%`)}`).join(' OR ')})`);
  }
  const url = new URL(API_URL);
  // Keep the payload focused on fields used by markers, filters, dispatch and
  // the detail card. Selecting every source column makes 5,000-row requests
  // unnecessarily large and more likely to stall on the public endpoint.
  url.searchParams.set('$select', [
    'unique_key', 'created_date', 'closed_date', 'agency', 'agency_name',
    'complaint_type', 'descriptor', 'incident_zip', 'incident_address',
    'status', 'resolution_description', 'borough', 'community_board',
    'latitude', 'longitude',
  ].join(','));
  url.searchParams.set('$where', where.join(' AND '));
  url.searchParams.set('$order', 'created_date DESC, unique_key DESC');
  url.searchParams.set('$limit', String(Math.max(1, Math.min(5000, Math.floor(Number(limit) || 5000)))));
  if (Number.isFinite(Number(offset)) && Number(offset) > 0) url.searchParams.set('$offset', String(Math.floor(Number(offset))));
  return url.toString();
}

export function toGeoJSON(reports) {
  return {
    type: 'FeatureCollection',
    features: reports.map(({ coordinates, record, ...properties }) => ({
      type: 'Feature',
      id: properties.id,
      geometry: { type: 'Point', coordinates: [...coordinates] },
      properties: { ...properties },
    })),
  };
}

export function summarize(reports) {
  const categories = Object.fromEntries(CATEGORIES.map(({ id }) => [id, 0]));
  let closed = 0;
  for (const report of reports) {
    if (Object.hasOwn(categories, report.category)) categories[report.category] += 1;
    if (report.isClosed) closed += 1;
  }
  categories.all = reports.length;
  return { total: reports.length, open: reports.length - closed, closed,
    closedPercent: reports.length ? Math.round(closed / reports.length * 100) : 0, categories };
}

function csvCell(value) {
  let text = String(value ?? '');
  // Address/description fields are public submissions and may contain formulas.
  if (typeof value !== 'number' && (/^[\s\u0000-\u001f]*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text))) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export function reportsToCsv(reports) {
  const columns = [
    ['Report ID', 'id'], ['Problem', 'title'], ['Problem detail', 'detail'],
    ['Address', 'address'], ['Borough', 'borough'], ['ZIP', 'zip'],
    ['Status', 'status'], ['Agency', 'agency'], ['Created (New York time)', 'created'],
    ['Closed (New York time)', 'closed'], ['Category', 'category'], ['Agency update', 'description'],
  ];
  const header = [...columns.map(([label]) => label), 'Longitude', 'Latitude'].map(csvCell).join(',');
  const rows = reports.map(report => [...columns.map(([, key]) => report[key]), ...report.coordinates].map(csvCell).join(','));
  return [header, ...rows].join('\r\n') + '\r\n';
}
