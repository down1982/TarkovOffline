import os
import sys
import json
import base64
import urllib.request
from io import BytesIO
from PIL import Image
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler

PORT = 8080
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PUBLIC_DIR = os.path.join(BASE_DIR, "public")

# Lazy-loaded Scanner Engine
scanner_engine = None

def get_scanner():
    global scanner_engine
    if scanner_engine is None:
        sys.path.append(BASE_DIR)
        from scripts.scanner_engine import TarkovScannerEngine
        scanner_engine = TarkovScannerEngine()
    return scanner_engine

class TarkovHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=PUBLIC_DIR, **kwargs)

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-cache")
        if self.path.endswith("sw.js"):
            self.send_header("Service-Worker-Allowed", "/")
            self.send_header("Content-Type", "application/javascript; charset=utf-8")
        super().end_headers()

    def guess_type(self, path):
        if path.endswith(".svg"):
            return "image/svg+xml"
        if path.endswith("manifest.json"):
            return "application/manifest+json"
        if path.endswith(".json"):
            return "application/json; charset=utf-8"
        if path.endswith(".webp"):
            return "image/webp"
        if path.endswith(".png"):
            return "image/png"
        if path.endswith(".ico"):
            return "image/x-icon"
        return super().guess_type(path)

    def do_GET(self):
        super().do_GET()

    def do_POST(self):
        # AI Scanner OCR & Content Matcher Endpoint
        if self.path == "/api/scanner/recognize":
            try:
                content_length = int(self.headers.get('Content-Length', 0))
                post_data = self.rfile.read(content_length)
                payload = json.loads(post_data.decode('utf-8'))
                base64_image = payload.get("image", "")

                if "," in base64_image:
                    base64_image = base64_image.split(",")[1]

                image_bytes = base64.b64decode(base64_image)
                img = Image.open(BytesIO(image_bytes))

                scanner = get_scanner()
                lines = scanner.recognize_image(img)
                matched = scanner.match_content(lines)

                self.send_response(200)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.end_headers()
                self.wfile.write(json.dumps({"code": 0, "data": matched}, ensure_ascii=False).encode('utf-8'))
                return
            except Exception as e:
                self.send_response(500)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.end_headers()
                self.wfile.write(json.dumps({"code": 1, "error": str(e)}).encode('utf-8'))
                return

        self.send_response(404)
        self.end_headers()

def run_server():
    server_address = ("", PORT)
    httpd = ThreadingHTTPServer(server_address, TarkovHandler)
    print(f"\n========================================================")
    print(f"[*] 逃离塔科夫 离线战术助手服务器已启动")
    print(f"[*] 请在浏览器中打开: http://localhost:{PORT}")
    print(f"========================================================\n")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n[*] 服务器已关闭")

if __name__ == "__main__":
    run_server()
