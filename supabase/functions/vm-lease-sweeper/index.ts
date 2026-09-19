const SWEEP_URL = Deno.env.get('VM_SWEEP_URL') || 'https://belna.se/api/internal/vm-sweep';

Deno.serve(async (request) => {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const token = Deno.env.get('VM_SWEEP_TOKEN') || '';
  if (!token) return Response.json({ error: 'Sweeper is not configured.' }, { status: 503 });

  try {
    const response = await fetch(SWEEP_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(25_000),
    });
    const body = await response.text();
    return new Response(body, {
      status: response.status,
      headers: { 'Content-Type': response.headers.get('content-type') || 'application/json' },
    });
  } catch {
    return Response.json({ error: 'Belna VM sweep request failed.' }, { status: 502 });
  }
});
