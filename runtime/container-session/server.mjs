import http from 'node:http';

const port = Number(process.env.PORT || 8080);
const server = http.createServer((req, res) => {
  const path = new URL(req.url || '/', 'http://session.local').pathname;
  if (!['/health', '/ready'].includes(path)) {
    res.writeHead(404, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    return res.end(JSON.stringify({ ok: false, error: 'not_found' }));
  }
  if (!['GET', 'POST'].includes(req.method || '')) {
    res.writeHead(405, { 'content-type': 'application/json', allow: 'GET, POST', 'cache-control': 'no-store' });
    return res.end(JSON.stringify({ ok: false, error: 'method_not_allowed' }));
  }
  res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify({ ok: true, runtime: 'lingon-workspace', purpose: 'warm-presence', tools: [] }));
});

server.listen(port, '0.0.0.0');

const close = () => server.close(() => process.exit(0));
process.on('SIGTERM', close);
process.on('SIGINT', close);
