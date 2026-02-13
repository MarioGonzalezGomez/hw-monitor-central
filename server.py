"""
HW Monitor Central — Proxy Server (Python)

A lightweight Python server that:
1. Serves the static frontend (HTML/CSS/JS)
2. Serves configuration from config.json via /api/config
3. Proxies /api/data?host=IP&port=PORT to LibreHardwareMonitor instances
   to avoid browser CORS restrictions

Usage: python server.py [port]
Default port: read from config.json, fallback 3000
"""

import http.server
import urllib.request
import urllib.error
import json
import sys
import os
from urllib.parse import urlparse, parse_qs

STATIC_DIR = os.path.dirname(os.path.abspath(__file__))
CONFIG_PATH = os.path.join(STATIC_DIR, 'config.json')

# Load configuration
def load_config():
    """Load and return the configuration from config.json."""
    try:
        with open(CONFIG_PATH, 'r', encoding='utf-8') as f:
            return json.load(f)
    except FileNotFoundError:
        print(f'  [WARN] config.json not found at {CONFIG_PATH}')
        print(f'  [WARN] Using default configuration')
        return {
            "server": {"port": 3000},
            "refresh": {"defaultInterval": 5000, "autoRefresh": True},
            "thresholds": {
                "cpu": {"warn": 75, "danger": 85, "max": 100},
                "gpu": {"warn": 70, "danger": 85, "max": 100}
            },
            "machines": []
        }
    except json.JSONDecodeError as e:
        print(f'  [ERROR] config.json tiene un error de formato: {e}')
        sys.exit(1)

config = load_config()

# Port: CLI arg > config > default
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else config.get('server', {}).get('port', 3000)

# Build allowed hosts from config
ALLOWED_HOSTS = set()
for machine in config.get('machines', []):
    ip = machine.get('ip', '')
    if ip:
        ALLOWED_HOSTS.add(ip)

MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
}


class ProxyHandler(http.server.BaseHTTPRequestHandler):
    """HTTP request handler with proxy, config, and static file support."""

    def log_message(self, format, *args):
        """Custom log format."""
        msg = format % args
        if '200' in msg or '304' in msg:
            print(f"  \033[32m✓\033[0m {msg}")
        elif '502' in msg or '504' in msg or '500' in msg:
            print(f"  \033[31m✗\033[0m {msg}")
        else:
            print(f"  · {msg}")

    def _set_cors_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')

    def do_OPTIONS(self):
        self.send_response(204)
        self._set_cors_headers()
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)

        if parsed.path == '/api/config':
            self._handle_config()
        elif parsed.path == '/api/data':
            self._handle_proxy(parsed)
        else:
            self._handle_static(parsed)

    def _handle_config(self):
        """Serve the current configuration (re-reads from disk each time for live updates)."""
        try:
            current_config = load_config()
            # Assign colors to machines if not set
            palette = ['#6366f1', '#06b6d4', '#8b5cf6', '#f43f5e', '#f59e0b', '#10b981', '#ec4899', '#14b8a6']
            for i, machine in enumerate(current_config.get('machines', [])):
                if 'color' not in machine:
                    machine['color'] = palette[i % len(palette)]
                if 'id' not in machine:
                    machine['id'] = f'machine-{i + 1}'

            response_data = json.dumps(current_config, ensure_ascii=False)
            self.send_response(200)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Cache-Control', 'no-cache')
            self._set_cors_headers()
            self.end_headers()
            self.wfile.write(response_data.encode('utf-8'))
        except Exception as e:
            self.send_response(500)
            self.send_header('Content-Type', 'application/json')
            self._set_cors_headers()
            self.end_headers()
            self.wfile.write(json.dumps({'error': str(e)}).encode())

    def _handle_proxy(self, parsed):
        """Proxy request to a LibreHardwareMonitor instance."""
        params = parse_qs(parsed.query)
        host = params.get('host', [None])[0]
        port = params.get('port', ['8085'])[0]

        if not host:
            self.send_response(400)
            self.send_header('Content-Type', 'application/json')
            self._set_cors_headers()
            self.end_headers()
            self.wfile.write(json.dumps({'error': 'Missing host parameter'}).encode())
            return

        # Re-read allowed hosts from config to support live config changes
        current_config = load_config()
        current_allowed = set(m.get('ip', '') for m in current_config.get('machines', []))

        if host not in current_allowed:
            self.send_response(403)
            self.send_header('Content-Type', 'application/json')
            self._set_cors_headers()
            self.end_headers()
            self.wfile.write(json.dumps({'error': f'Host {host} not in allowed list. Add it to config.json'}).encode())
            return

        target_url = f'http://{host}:{port}/data.json'

        try:
            req = urllib.request.Request(target_url)
            with urllib.request.urlopen(req, timeout=4) as response:
                data = response.read()

            self.send_response(200)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self._set_cors_headers()
            self.end_headers()
            self.wfile.write(data)

        except urllib.error.URLError as e:
            self.send_response(502)
            self.send_header('Content-Type', 'application/json')
            self._set_cors_headers()
            self.end_headers()
            self.wfile.write(json.dumps({
                'error': f'Cannot connect to {host}:{port} — {str(e.reason)}',
                'host': host,
                'port': port
            }).encode())

        except Exception as e:
            self.send_response(502)
            self.send_header('Content-Type', 'application/json')
            self._set_cors_headers()
            self.end_headers()
            self.wfile.write(json.dumps({
                'error': f'Proxy error: {str(e)}',
                'host': host,
                'port': port
            }).encode())

    def _handle_static(self, parsed):
        """Serve static files."""
        file_path = parsed.path
        if file_path == '/' or file_path == '':
            file_path = '/index.html'

        # Security: prevent path traversal
        safe_path = os.path.normpath(os.path.join(STATIC_DIR, file_path.lstrip('/')))
        if not safe_path.startswith(STATIC_DIR):
            self.send_response(403)
            self.end_headers()
            self.wfile.write(b'Forbidden')
            return

        if not os.path.isfile(safe_path):
            self.send_response(404)
            self.send_header('Content-Type', 'text/plain')
            self.end_headers()
            self.wfile.write(b'Not Found')
            return

        ext = os.path.splitext(safe_path)[1].lower()
        content_type = MIME_TYPES.get(ext, 'application/octet-stream')

        try:
            with open(safe_path, 'rb') as f:
                content = f.read()

            self.send_response(200)
            self.send_header('Content-Type', content_type)
            self.send_header('Cache-Control', 'no-cache')
            self._set_cors_headers()
            self.end_headers()
            self.wfile.write(content)
        except Exception:
            self.send_response(500)
            self.end_headers()
            self.wfile.write(b'Internal Server Error')


def main():
    server = http.server.HTTPServer(('0.0.0.0', PORT), ProxyHandler)

    machine_count = len(config.get('machines', []))
    
    print('')
    print('  ╔══════════════════════════════════════════════╗')
    print('  ║       HW Monitor Central — Server           ║')
    print('  ╠══════════════════════════════════════════════╣')
    print(f'  ║  🌐 http://localhost:{PORT:<25}║')
    print(f'  ║  📋 Configuración: config.json              ║')
    print(f'  ║  🖥  Equipos configurados: {machine_count:<19}║')
    print('  ║                                              ║')
    
    for machine in config.get('machines', []):
        name = machine.get('name', '?')
        ip = machine.get('ip', '?')
        port = machine.get('port', 8085)
        line = f'    → {name:8} {ip}:{port}'
        print(f'  ║{line:<44}║')
    
    print('  ║                                              ║')
    print('  ║  Presiona Ctrl+C para detener                ║')
    print('  ╚══════════════════════════════════════════════╝')
    print('')

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\n  Servidor detenido.')
        server.server_close()


if __name__ == '__main__':
    main()
