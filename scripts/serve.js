#!/usr/bin/env node
'use strict';

// Static file server for local preview. Node builtins only.
//
// `app.js` fetches designs.json, and a browser blocks fetch on file:// URLs,
// so the page needs a server to run at all. This is that server, rather than
// `npx serve`: that pulls an unpinned package off the network and runs it on
// every invocation, and it binds to every interface, which puts the whole
// folder on the local network.

const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const HOST = '127.0.0.1';           // loopback only. This serves the repo.
const PORT = Number(process.env.PORT) || 3000;
const PORT_TRIES = 10;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

function send(res, status, body, type) {
  res.writeHead(status, {
    'Content-Type': type || 'text/plain; charset=utf-8',
    // The type header above is the whole answer. Never let a browser guess.
    'X-Content-Type-Options': 'nosniff',
    // Versioned URLs make production caching safe. In development the point is
    // to see the edit you just made.
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

const server = http.createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return send(res, 405, 'Method not allowed');
  }

  // WHATWG URL, not url.parse: it normalises to one canonical form before
  // the traversal check reads the path. The base is a throwaway — only the
  // path matters here.
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    return send(res, 400, 'Bad request');
  }

  const rel = pathname.endsWith('/') ? `${pathname}index.html` : pathname;
  const file = path.resolve(ROOT, `.${rel}`);

  // The resolve above collapses '..'. Anything that climbs out of ROOT is a
  // traversal attempt, so refuse it before touching the disk.
  if (file !== ROOT && !file.startsWith(ROOT + path.sep)) {
    return send(res, 403, 'Forbidden');
  }

  fs.stat(file, (err, stat) => {
    // No directory listing: a directory is a 404, not an index of the repo.
    if (err || !stat.isFile()) return send(res, 404, 'Not found');

    const type = TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
    if (req.method === 'HEAD') return send(res, 200, '', type);

    res.writeHead(200, {
      'Content-Type': type,
      'Content-Length': stat.size,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
    });
    fs.createReadStream(file).pipe(res);
  });
});

// A port left occupied by an earlier run should not stop the preview.
let attempt = 0;
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE' && ++attempt < PORT_TRIES) {
    return server.listen(PORT + attempt, HOST);
  }
  console.error(err.message);
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  console.log(`Serving ${ROOT}\n  http://${HOST}:${server.address().port}`);
});
