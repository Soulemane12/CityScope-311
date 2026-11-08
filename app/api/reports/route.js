const DATASET_ORIGIN = 'https://data.cityofnewyork.us';
const DATASET_PATH = '/resource/erm2-nwe9.json';
const CACHE_SECONDS = 300;

export const runtime = 'nodejs';

function errorResponse(message, status, retryAfter) {
  const headers = { 'Cache-Control': 'no-store' };
  if (retryAfter) headers['Retry-After'] = retryAfter;
  return Response.json({ error: message }, { status, headers });
}

export async function GET(request) {
  const source = new URL(request.url).searchParams.get('source');
  if (!source) return errorResponse('A NYC Open Data query is required.', 400);

  let upstream;
  try {
    upstream = new URL(source);
  } catch {
    return errorResponse('The NYC Open Data query is invalid.', 400);
  }
  if (upstream.origin !== DATASET_ORIGIN || upstream.pathname !== DATASET_PATH || upstream.username || upstream.password) {
    return errorResponse('Only the NYC 311 dataset can be queried.', 400);
  }

  const headers = { Accept: 'application/json' };
  if (process.env.NYC_OPEN_DATA_APP_TOKEN) headers['X-App-Token'] = process.env.NYC_OPEN_DATA_APP_TOKEN;

  let response;
  try {
    response = await fetch(upstream, {
      headers,
      next: { revalidate: CACHE_SECONDS },
      signal: AbortSignal.timeout(20000),
    });
  } catch (error) {
    return errorResponse(error.name === 'TimeoutError' ? 'NYC Open Data timed out. Try again shortly.' : 'Could not connect to NYC Open Data. Try again shortly.', 502);
  }

  if (response.status === 429) {
    return errorResponse('NYC Open Data is rate-limiting requests. Try again shortly.', 429, response.headers.get('retry-after') || '10');
  }
  if (!response.ok) return errorResponse(`NYC Open Data returned ${response.status}.`, 502);

  return new Response(response.body, {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': `public, s-maxage=${CACHE_SECONDS}, stale-while-revalidate=600`,
    },
  });
}
