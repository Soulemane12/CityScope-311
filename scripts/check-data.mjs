import assert from 'node:assert/strict';
import { API_URL, CATEGORIES, categoryFor, normalizeReport, buildLatestReportUrl, buildReportsUrl, toGeoJSON, summarize, reportsToCsv } from '../lib/reports.mjs';

const raw = {
  unique_key: '70999722', created_date: '2026-11-04T02:05:23.000', agency: 'NYPD',
  agency_name: 'New York City Police Department', complaint_type: 'Noise - Residential',
  descriptor: 'Banging/Pounding', status: 'In Progress', borough: 'MANHATTAN',
  incident_address: '21 WEST END AVENUE', incident_zip: '10023',
  latitude: '40.772462881371915', longitude: '-73.98984401160628',
  cross_street_1: 'WEST 60 STREET', cross_street_2: 'WEST 61 STREET',
  community_board: '07 MANHATTAN', council_district: '06', police_precinct: 'Precinct 20',
  location: { type: 'Point', coordinates: [-73.98984401160628, 40.772462881371915] },
};

const report = normalizeReport(raw);
assert.equal(report.id, '70999722');
assert.equal(report.category, 'noise');
assert.equal(report.isClosed, false);
assert.deepEqual(report.record, raw);
assert.notEqual(report.record, raw);
assert.equal(report.record.community_board, '07 MANHATTAN');
assert.equal(report.record.police_precinct, 'Precinct 20');
assert.deepEqual(report.coordinates, [-73.98984401160628, 40.772462881371915]);
for (const bad of [null, {}, { ...raw, latitude: '' }, { ...raw, latitude: 'NaN' }, { ...raw, longitude: 'Infinity' }, { ...raw, latitude: '41.2' }, { ...raw, longitude: '-74.9' }, { ...raw, unique_key: '' }]) {
  assert.equal(normalizeReport(bad), null, `Invalid map report accepted: ${JSON.stringify(bad)}`);
}
assert.equal(normalizeReport({ ...raw, descriptor: null }).detail, 'No additional details provided');
assert.equal(normalizeReport({ ...raw, status: 'Closed' }).isClosed, true);

const examples = [
  ['Noise - Street/Sidewalk', 'noise'], ['Noise - Commercial', 'noise'],
  ['Dirty Conditions', 'sanitation'], ['Missed Collection', 'sanitation'],
  ['Rodent', 'sanitation'], ['Street Sweeping', 'sanitation'],
  ['Illegal Parking', 'streets'], ['Blocked Driveway', 'streets'],
  ['Street Light Condition', 'streets'], ['HEAT/HOT WATER', 'buildings'],
  ['Elevator', 'buildings'], ['Unsanitary Condition', 'buildings'], ['Animal Abuse', 'other'], ['', 'other'],
];
for (const [title, expected] of examples) assert.equal(categoryFor(title), expected, title);
assert.equal(CATEGORIES.length, 6);

const latest = '2026-11-04T02:05:23.000';
const anchor = new URL(buildLatestReportUrl());
assert.equal(anchor.searchParams.get('$select'), 'created_date');
assert.equal(anchor.searchParams.get('$limit'), '1');
assert.equal(anchor.searchParams.get('$order'), 'created_date DESC, unique_key DESC');
assert.equal(anchor.searchParams.has('$where'), false);
const url = new URL(buildReportsUrl({ days: 7, borough: 'BROOKLYN', category: 'streets', status: 'open', search: "O'NEIL 100%" }, latest));
assert.equal(url.origin + url.pathname, API_URL);
assert.equal(url.searchParams.get('$select'), 'unique_key,created_date,closed_date,agency,agency_name,complaint_type,descriptor,incident_zip,incident_address,status,resolution_description,borough,community_board,latitude,longitude');
assert.equal(url.searchParams.get('$limit'), '5000');
assert.equal(url.searchParams.get('$order'), 'created_date DESC, unique_key DESC');
const where = url.searchParams.get('$where');
assert.ok(where.includes("created_date >= '2026-10-28T02:05:23.000'"));
assert.ok(where.includes("created_date <= '2026-11-04T02:05:23.000'"));
assert.ok(!where.includes('latitude'));
assert.ok(!where.includes('longitude'));
assert.ok(where.includes("borough = 'BROOKLYN'"));
assert.ok(where.includes("upper(status) != 'CLOSED'"));
assert.ok(where.includes("'%o''neil 100%'"));
assert.ok(!where.includes('100%%'));
assert.ok(where.includes('AND NOT')); // streets exclude earlier noise/sanitation rules
assert.ok(where.includes("lower(complaint_type) like '%noise%'"));
assert.ok(where.includes("lower(complaint_type) like '%sweeping%'"));
const malicious = new URL(buildReportsUrl({ days: "30 OR 1=1", borough: "BRONX' OR 1=1", category: "noise' OR 1=1", status: "closed' OR 1=1" }, latest)).searchParams.get('$where');
assert.ok(!malicious.includes('OR 1=1'));
assert.ok(malicious.includes("created_date >= '2026-11-03T02:05:23.000'"));
assert.throws(() => buildReportsUrl({}, 'not-a-date'), RangeError);
assert.throws(() => buildReportsUrl({}, '2026-02-30T12:00:00.000'), RangeError);
assert.throws(() => buildReportsUrl({}, "2026-11-04T02:05:23.000' OR 1=1"), RangeError);
const monthBoundary = new URL(buildReportsUrl({ days: 1 }, '2026-03-01T00:30:00.000')).searchParams.get('$where');
assert.ok(monthBoundary.includes("created_date >= '2026-02-28T00:30:00.000'"));

const closed = normalizeReport({ ...raw, unique_key: '2', status: 'Closed', complaint_type: 'Illegal Parking' });
assert.deepEqual(summarize([report, closed]), { total: 2, open: 1, closed: 1, closedPercent: 50,
  categories: { all: 2, streets: 1, sanitation: 0, noise: 1, buildings: 0, other: 0 } });
assert.equal(summarize([]).closedPercent, 0);
const geo = toGeoJSON([report]);
assert.equal(geo.type, 'FeatureCollection');
assert.equal(geo.features[0].id, report.id);
assert.equal(geo.features[0].properties.color, report.color);
assert.ok(!Object.hasOwn(geo.features[0].properties, 'record'));
assert.deepEqual(geo.features[0].geometry.coordinates, report.coordinates);
assert.notEqual(geo.features[0].geometry.coordinates, report.coordinates);

const csv = reportsToCsv([{ ...report, address: '=HYPERLINK("evil")', detail: 'Line 1, "quoted"\nLine 2', description: '\t=1+1' }]);
assert.ok(csv.includes('"\'=HYPERLINK(""evil"")"'));
assert.ok(csv.includes('"Line 1, ""quoted""\nLine 2"'));
assert.ok(csv.includes('"\'\t=1+1"'));
assert.ok(csv.includes('"-73.98984401160628"')); // numeric coordinates stay GIS-readable
assert.ok(csv.endsWith('\r\n'));

console.log('Data checks passed: NYC coordinates, category precedence, bounded escaped queries, GeoJSON, summaries, CSV safety.');
