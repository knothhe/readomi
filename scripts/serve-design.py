#!/usr/bin/env python3
"""Serve the design canvas and its shared assets without exposing the repository."""

import argparse
from functools import partial
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit


class DesignHandler(SimpleHTTPRequestHandler):
    def send_head(self):
        if urlsplit(self.path).path == "/":
            self.send_response(HTTPStatus.FOUND)
            self.send_header("Location", "/design/")
            self.send_header("Content-Length", "0")
            self.end_headers()
            return None

        root = Path(self.directory).resolve()
        path = Path(self.translate_path(self.path)).resolve()
        allowed = (root / "design", root / "assets" / "design")
        if not any(path.is_relative_to(directory) for directory in allowed):
            self.send_error(HTTPStatus.NOT_FOUND)
            return None

        return super().send_head()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bind", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=4780)
    args = parser.parse_args()
    root = Path(__file__).resolve().parent.parent
    handler = partial(DesignHandler, directory=str(root))
    with ThreadingHTTPServer((args.bind, args.port), handler) as server:
        print(f"Design preview: http://{args.bind}:{server.server_port}/design/", flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
