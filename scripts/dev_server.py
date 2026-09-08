#!/usr/bin/env python3
"""Local Blink server with feed editing and refresh endpoints."""

import argparse
import hashlib
import json
import subprocess
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FEEDS_FILE = ROOT / "feeds.txt"
FETCH_SCRIPT = ROOT / "scripts" / "fetch_feeds.py"
MAX_BODY_BYTES = 2 * 1024 * 1024


def file_sha(content: str) -> str:
    return hashlib.sha256(content.encode("utf-8")).hexdigest()


class BlinkDevHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def send_json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def read_json(self) -> dict:
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError as exc:
            raise ValueError("Invalid Content-Length") from exc
        if length <= 0 or length > MAX_BODY_BYTES:
            raise ValueError("Invalid request size")
        try:
            return json.loads(self.rfile.read(length))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise ValueError("Invalid JSON body") from exc

    def do_GET(self) -> None:
        if self.path == "/__blink/feeds":
            content = FEEDS_FILE.read_text(encoding="utf-8")
            self.send_json(200, {"content": content, "sha": file_sha(content)})
            return
        super().do_GET()

    def do_PUT(self) -> None:
        if self.path != "/__blink/feeds":
            self.send_json(404, {"error": "Not found"})
            return
        try:
            payload = self.read_json()
            content = payload.get("content")
            if not isinstance(content, str):
                raise ValueError("Feed content must be text")
            current = FEEDS_FILE.read_text(encoding="utf-8") if FEEDS_FILE.exists() else ""
            expected_sha = payload.get("sha")
            if expected_sha and expected_sha != file_sha(current):
                self.send_json(409, {"error": "feeds.txt changed on disk. Reopen feed manager and try again."})
                return
            FEEDS_FILE.write_text(content, encoding="utf-8")
            self.send_json(200, {"content": {"sha": file_sha(content)}})
        except (OSError, ValueError) as exc:
            self.send_json(400, {"error": str(exc)})

    def do_POST(self) -> None:
        if self.path != "/__blink/refresh":
            self.send_json(404, {"error": "Not found"})
            return
        try:
            result = subprocess.run(
                [sys.executable, str(FETCH_SCRIPT)],
                cwd=ROOT,
                capture_output=True,
                text=True,
                timeout=15 * 60,
                check=False,
            )
        except subprocess.TimeoutExpired:
            self.send_json(504, {"error": "Local feed refresh timed out"})
            return
        if result.returncode != 0:
            detail = (result.stderr or result.stdout).strip().splitlines()
            self.send_json(500, {"error": detail[-1] if detail else "Local feed refresh failed"})
            return
        self.send_json(200, {"status": "complete"})


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Serve Blink with local feed management enabled")
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()
    server = ThreadingHTTPServer(("127.0.0.1", args.port), BlinkDevHandler)
    print(f"Blink local development server: http://127.0.0.1:{args.port}")
    print("GitHub auth disabled; feed changes write directly to feeds.txt.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping server.")
    finally:
        server.server_close()
