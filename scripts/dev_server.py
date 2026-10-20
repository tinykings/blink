#!/usr/bin/env python3
"""Serve Blink locally without GitHub authentication."""

import argparse
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


class BlinkDevHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Serve Blink locally")
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()
    server = ThreadingHTTPServer(("127.0.0.1", args.port), BlinkDevHandler)
    print(f"Blink local development server: http://127.0.0.1:{args.port}")
    print("GitHub auth disabled; edit feeds.txt directly to manage subscriptions.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping server.")
    finally:
        server.server_close()
