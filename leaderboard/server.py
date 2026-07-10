#!/usr/bin/env python3
"""Daily Sports Jeopardy! leaderboard server.

A tiny zero-dependency (stdlib-only) score server backing the game's
shared daily leaderboard. One row per (daily seed, player name); a
resubmission by the same name for the same day overwrites the old score.

    POST /jeopardy/scores   {"seed": "2026-07-10", "name": "Filip",
                             "score": 21, "total": 30, "grid": "🟩🟥..."}
    GET  /jeopardy/scores?seed=2026-07-10
    GET  /jeopardy/health

Both paths also work without the /jeopardy prefix, so the server runs
identically standalone (localhost dev) or behind a reverse proxy that
forwards the full /jeopardy/* path.

Run:  python3 server.py [--port 8124] [--db jeopardy-lb.db]
"""

import argparse
import json
import re
import sqlite3
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

SEED_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
NAME_MAX = 20
GRID_MAX = 400
TOTAL = 30

db_lock = threading.Lock()
db = None  # set in main()


def init_db(path):
    conn = sqlite3.connect(path, check_same_thread=False)
    conn.execute(
        """CREATE TABLE IF NOT EXISTS scores (
             seed       TEXT NOT NULL,
             name_key   TEXT NOT NULL,
             name       TEXT NOT NULL,
             score      INTEGER NOT NULL,
             total      INTEGER NOT NULL,
             grid       TEXT NOT NULL DEFAULT '',
             updated_at TEXT NOT NULL DEFAULT (datetime('now')),
             PRIMARY KEY (seed, name_key)
           )"""
    )
    conn.commit()
    return conn


def board(seed):
    rows = db.execute(
        """SELECT name, score, total, grid, updated_at FROM scores
           WHERE seed = ? ORDER BY score DESC, updated_at ASC""",
        (seed,),
    ).fetchall()
    return {
        "seed": seed,
        "entries": [
            {"name": r[0], "score": r[1], "total": r[2], "grid": r[3], "ts": r[4]}
            for r in rows
        ],
    }


class Handler(BaseHTTPRequestHandler):
    server_version = "JeopardyLB/1"

    def _send(self, code, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
        self.wfile.write(body)

    def _route(self):
        path = urlparse(self.path).path.rstrip("/")
        if path.startswith("/jeopardy"):
            path = path[len("/jeopardy"):] or "/"
        return path

    def do_OPTIONS(self):
        self._send(204, {})

    def do_GET(self):
        path = self._route()
        if path == "/health":
            return self._send(200, {"ok": True})
        if path == "/scores":
            qs = parse_qs(urlparse(self.path).query)
            seed = (qs.get("seed") or [""])[0]
            if not SEED_RE.match(seed):
                return self._send(400, {"error": "bad seed"})
            with db_lock:
                return self._send(200, board(seed))
        return self._send(404, {"error": "not found"})

    def do_POST(self):
        if self._route() != "/scores":
            return self._send(404, {"error": "not found"})
        try:
            length = min(int(self.headers.get("Content-Length", 0)), 10_000)
            data = json.loads(self.rfile.read(length).decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            return self._send(400, {"error": "bad json"})

        seed = data.get("seed", "")
        name = str(data.get("name", "")).strip()[:NAME_MAX]
        grid = str(data.get("grid", ""))[:GRID_MAX]
        try:
            score, total = int(data.get("score")), int(data.get("total"))
        except (TypeError, ValueError):
            return self._send(400, {"error": "bad score"})

        if not SEED_RE.match(seed):
            return self._send(400, {"error": "bad seed"})
        if not name:
            return self._send(400, {"error": "name required"})
        if total != TOTAL or not (0 <= score <= total):
            return self._send(400, {"error": "bad score"})

        with db_lock:
            db.execute(
                """INSERT INTO scores (seed, name_key, name, score, total, grid)
                   VALUES (?, ?, ?, ?, ?, ?)
                   ON CONFLICT (seed, name_key) DO UPDATE SET
                     name = excluded.name, score = excluded.score,
                     grid = excluded.grid, updated_at = datetime('now')""",
                (seed, name.lower(), name, score, total, grid),
            )
            db.commit()
            self._send(200, board(seed))

    def log_message(self, fmt, *args):  # quiet journald
        pass


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8124)
    ap.add_argument("--db", default="jeopardy-lb.db")
    args = ap.parse_args()

    global db
    db = init_db(args.db)
    print(f"Jeopardy leaderboard on :{args.port}, db={args.db}")
    ThreadingHTTPServer(("0.0.0.0", args.port), Handler).serve_forever()


if __name__ == "__main__":
    main()
