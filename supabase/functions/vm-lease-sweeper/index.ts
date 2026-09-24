const SWEEP_URL = Deno.env.get('VM_SWEEP_URL') || 'https://belna.se/api/internal/vm-sweep';

function sameSecret(a: string, b: string) {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const token = Deno.env.get('VM_SWEEP_TOKEN') || '';
  // SECURITY: only the scheduler holding the trigger secret may start a sweep.
  const triggerToken = Deno.env.get('VM_SWEEP_TRIGGER_TOKEN')?.trim() || '';
  if (!token || !triggerToken) return Response.json({ error: 'Sweeper is not configured.' }, { status: 503 });
  const supplied = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!sameSecret(supplied, triggerToken)) return Response.json({ error: 'Unauthorized' }, { status: 401 });

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
