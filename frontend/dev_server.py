from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

FRONTEND_DIR = Path(__file__).resolve().parent

class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

handler = partial(NoCacheHandler, directory=str(FRONTEND_DIR))
server = ThreadingHTTPServer(("127.0.0.1", 5500), handler)

print("ResearchForge frontend running at http://127.0.0.1:5500")
server.serve_forever()
