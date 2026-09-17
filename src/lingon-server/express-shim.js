/* Minimal Express-compatible shim so the original Lingon backend routes run
   unchanged on the edge runtime (no Node http server available).
   Supports: app.use(mw), app.get/post/delete(path, ...handlers), path params,
   req.query/params/body/headers/ip/path/protocol/get(), and
   res.status/json/send/setHeader/redirect/end. */

function compile(pattern) {
  const keys = [];
  const rx = new RegExp(
    '^' +
      pattern
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/:(\w+)/g, (_m, k) => {
          keys.push(k);
          return '([^/]+)';
        })
        .replace(/\*/g, '.*') +
      '$',
  );
  return { rx, keys };
}

class Res {
  constructor() {
    this.statusCode = 200;
    this.headers = new Headers();
    this._body = null;
    this._sent = false;
    this._resolve = null;
    this.promise = new Promise((r) => {
      this._resolve = r;
    });
  }
  setHeader(k, v) {
    this.headers.set(k, String(v));
    return this;
  }
  status(code) {
    this.statusCode = code;
    return this;
  }
  _finish(body) {
    if (this._sent) return this;
    this._sent = true;
    this._resolve(new Response(body, { status: this.statusCode, headers: this.headers }));
    return this;
  }
  json(obj) {
    this.headers.set('Content-Type', 'application/json');
    return this._finish(JSON.stringify(obj));
  }
  send(body) {
    if (typeof body === 'object' && body !== null) return this.json(body);
    if (!this.headers.get('Content-Type')) this.headers.set('Content-Type', 'text/html; charset=utf-8');
    return this._finish(body == null ? '' : String(body));
  }
  end(body) {
    return this._finish(body ?? '');
  }
  redirect(location) {
    this.statusCode = 302;
    this.headers.set('Location', location);
    return this._finish('');
  }
}

export function createApp() {
  const layers = [];

  const add = (method, path, handlers) => {
    const { rx, keys } = compile(path);
    layers.push({ method, rx, keys, handlers });
  };

  const app = {
    set() {},
    use(...args) {
      const path = typeof args[0] === 'string' ? args[0] : '*';
      const handlers = args.filter((a) => typeof a === 'function');
      const { rx, keys } = compile(path === '*' ? '*' : path + '*');
      layers.push({ method: null, rx, keys, handlers, isMiddleware: true });
    },
    get(path, ...h) {
      add('GET', path, h);
    },
    post(path, ...h) {
      add('POST', path, h);
    },
    put(path, ...h) {
      add('PUT', path, h);
    },
    patch(path, ...h) {
      add('PATCH', path, h);
    },
    delete(path, ...h) {
      add('DELETE', path, h);
    },
    listen() {},

    async handle(request) {
      const url = new URL(request.url);
      const res = new Res();
      let body = {};
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        const text = await request.text().catch(() => '');
        if (text) {
          try {
            body = JSON.parse(text);
          } catch {
            body = {};
          }
        }
      }
      const headers = {};
      request.headers.forEach((v, k) => {
        headers[k.toLowerCase()] = v;
      });
      const query = Object.fromEntries(url.searchParams.entries());
      const req = {
        method: request.method,
        path: url.pathname,
        originalUrl: url.pathname + url.search,
        url: url.pathname + url.search,
        query,
        body,
        headers,
        params: {},
        ip: headers['cf-connecting-ip'] || headers['x-forwarded-for'] || 'ip',
        protocol: url.protocol.replace(':', ''),
        signal: request.signal,
        get: (k) => headers[String(k).toLowerCase()],
      };

      const matches = layers.filter(
        (l) => (l.method === null || l.method === request.method) && l.rx.test(url.pathname),
      );

      let i = 0;
      // Middleware often calls next() without awaiting it (Express style), so
      // track every spawned continuation and settle them all before replying.
      const pending = [];
      const track = (p) => {
        pending.push(p);
        return p;
      };
      const run = () =>
        track(
          (async () => {
            if (res._sent) return;
            const layer = matches[i++];
            if (!layer) {
              res.status(404).json({ error: 'Not found' });
              return;
            }
            const m = url.pathname.match(layer.rx);
            req.params = {};
            layer.keys.forEach((k, idx) => {
              req.params[k] = decodeURIComponent(m[idx + 1]);
            });
            let hi = 0;
            const next = () =>
              track(
                (async () => {
                  const h = layer.handlers[hi++];
                  if (!h) return run();
                  await h(req, res, next);
                })(),
              );
            await next();
          })(),
        );

      try {
        await run();
        while (pending.length) await Promise.all(pending.splice(0));
      } catch (e) {
        if (!res._sent) res.status(500).json({ error: String(e?.message || e) });
      }
      if (!res._sent) res.status(404).json({ error: 'Not found' });
      return res.promise;
    },
  };

  return app;
}

export default createApp;
