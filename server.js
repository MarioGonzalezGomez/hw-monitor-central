/**
 * HW Monitor Central — Proxy Server
 * 
 * A lightweight Node.js server that:
 * 1. Serves the static frontend (HTML/CSS/JS)
 * 2. Proxies /api/data?host=IP&port=PORT to the LibreHardwareMonitor instances
 *    adding proper CORS headers to avoid browser restrictions
 * 
 * Usage: node server.js [port]
 * Default port: 3000
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = parseInt(process.argv[2]) || 3000;

// MIME types for static files
const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
};

const server = http.createServer((req, res) => {
    // CORS headers for all responses
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    const url = new URL(req.url, `http://localhost:${PORT}`);

    // API proxy endpoint
    if (url.pathname === '/api/data') {
        const host = url.searchParams.get('host');
        const port = url.searchParams.get('port') || '8085';

        if (!host) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Missing host parameter' }));
            return;
        }

        const proxyUrl = `http://${host}:${port}/data.json`;

        const proxyReq = http.get(proxyUrl, { timeout: 4000 }, (proxyRes) => {
            let body = '';
            proxyRes.on('data', chunk => body += chunk);
            proxyRes.on('end', () => {
                res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(body);
            });
        });

        proxyReq.on('error', (err) => {
            res.writeHead(502, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: `Proxy error: ${err.message}`, host, port }));
        });

        proxyReq.on('timeout', () => {
            proxyReq.destroy();
            res.writeHead(504, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Timeout connecting to host', host, port }));
        });

        return;
    }

    // Static file serving
    let filePath = url.pathname;
    if (filePath === '/' || filePath === '') filePath = '/index.html';

    const fullPath = path.join(__dirname, filePath);

    // Security: prevent path traversal
    if (!fullPath.startsWith(__dirname)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
    }

    fs.readFile(fullPath, (err, data) => {
        if (err) {
            if (err.code === 'ENOENT') {
                res.writeHead(404);
                res.end('Not Found');
            } else {
                res.writeHead(500);
                res.end('Internal Server Error');
            }
            return;
        }

        const ext = path.extname(fullPath).toLowerCase();
        const contentType = MIME_TYPES[ext] || 'application/octet-stream';

        res.writeHead(200, { 'Content-Type': contentType });
        res.end(data);
    });
});

server.listen(PORT, '0.0.0.0', () => {
    console.log('');
    console.log('  ╔══════════════════════════════════════════════╗');
    console.log('  ║       HW Monitor Central — Server           ║');
    console.log('  ╠══════════════════════════════════════════════╣');
    console.log(`  ║  🌐 http://localhost:${PORT}                    ║`);
    console.log(`  ║  🌐 http://0.0.0.0:${PORT}                     ║`);
    console.log('  ║                                              ║');
    console.log('  ║  Proxy endpoints:                            ║');
    console.log('  ║  /api/data?host=IP&port=PORT                 ║');
    console.log('  ╚══════════════════════════════════════════════╝');
    console.log('');
});
