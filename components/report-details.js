'use client';


const sections = [
  ['Request', [
    ['unique_key', 'Report number'], ['status', 'Status'],
    ['complaint_type', 'Problem'], ['descriptor', 'Problem details'],
    ['descriptor_2', 'Additional problem details'], ['agency', 'Agency'],
    ['agency_name', 'Agency name'], ['created_date', 'Reported'],
    ['closed_date', 'Closed'], ['due_date', 'Due'],
    ['resolution_action_updated_date', 'Agency update date'],
    ['resolution_description', 'Agency update'], ['open_data_channel_type', 'Submitted via'],
  ]],
  ['Location', [
    ['incident_address', 'Address'], ['city', 'City'], ['borough', 'Borough'],
    ['incident_zip', 'ZIP code'], ['location_type', 'Location type'],
    ['address_type', 'Address type'], ['street_name', 'Street'],
    ['cross_street_1', 'Cross street 1'], ['cross_street_2', 'Cross street 2'],
    ['intersection_street_1', 'Intersection street 1'],
    ['intersection_street_2', 'Intersection street 2'], ['landmark', 'Landmark'],
    ['latitude', 'Latitude'], ['longitude', 'Longitude'],
  ]],
  ['Districts', [
    ['community_board', 'Community board'], ['council_district', 'City Council district'],
    ['police_precinct', 'Police precinct'], ['bbl', 'Borough, block & lot (BBL)'],
  ]],
];
const knownFields = new Set(sections.flatMap(([, fields]) => fields.map(([key]) => key)));
const fieldName = key => key.replace(/^:@computed_region_/, 'Computed region ').replaceAll('_', ' ').replace(/^\w/, c => c.toUpperCase());
function readable(value) {
  if (value == null || value === '') return 'Not provided';
  if (Array.isArray(value)) return value.map(readable).join(', ');
  if (typeof value === 'object') return Object.entries(value).map(([key, item]) => `${fieldName(key)}: ${readable(item)}`).join(' · ');
  return String(value);
}
function fieldValue(key, value) {
  if (key.endsWith('_date') && value) {
    const date = new Date(String(value) + 'Z');
    if (Number.isFinite(date.getTime())) return new Intl.DateTimeFormat('en-US', {
      month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'UTC',
    }).format(date) + ' ET';
  }
  return readable(value);
}
function baseline(report) {
  return {
    unique_key: report.id, status: report.status, complaint_type: report.title,
    descriptor: report.detail, agency: report.agency, agency_name: report.agencyName,
    created_date: report.created, closed_date: report.closed,
    resolution_description: report.description, incident_address: report.address,
    borough: report.borough, incident_zip: report.zip,
    latitude: report.coordinates[1], longitude: report.coordinates[0],
  };
}

export default function ReportDetails({ report, onClose }) {
  const record = { ...baseline(report), ...(report.record || {}) };

  const extraFields = Object.keys(record).filter(key => !knownFields.has(key)).map(key => [key, fieldName(key)]);
  const groups = extraFields.length ? [...sections, ['Additional fields', extraFields]] : sections;

  return <article className="detail full-record" aria-label={`Details for report ${report.id}`}>
    <button className="close" aria-label="Close report details" onClick={onClose}>×</button>
    <span className="report-id">Report #{report.id}</span>
    <h2>{record.complaint_type || report.title}</h2>
    <p>{record.incident_address || report.address}<br />{record.borough || report.borough} {record.incident_zip || report.zip}</p>
    <div className="record-status">{record.status || report.status}</div>
    {groups.map(([heading, fields]) => {
      const present = fields.filter(([key]) => Object.hasOwn(record, key));
      if (!present.length) return null;
      return <section className="record-section" key={heading}>
        <h3>{heading}</h3>
        <dl>{present.map(([key, label]) => <div className="record-field" key={key}><dt>{label}</dt><dd>{fieldValue(key, record[key])}</dd></div>)}</dl>
      </section>;
    })}
    <p className="record-source">Source: NYC Open Data · Dates in New York time</p>
  </article>;
}
