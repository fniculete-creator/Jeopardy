# Leaderboard backend

Zero-dependency (Python stdlib + SQLite) score server for the shared daily
leaderboard. One row per (day, player name); resubmitting overwrites.

## Deploy to kalshi-bots (same pattern as the alpaca leaderboard)

```bash
# from this repo's root, on the local machine
scp -r leaderboard kalshi-bots:~/jeopardy-lb

ssh kalshi-bots
sudo cp ~/jeopardy-lb/jeopardy-lb.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now jeopardy-lb
curl -s localhost:8124/jeopardy/health   # -> {"ok": true}
```

Then route it through the existing HTTPS reverse proxy for
`100.57.37.231.nip.io` (the one already fronting the alpaca backend).
Caddy example — add inside that site block:

```
handle /jeopardy/* {
    reverse_proxy localhost:8124
}
```

(nginx equivalent: `location /jeopardy/ { proxy_pass http://127.0.0.1:8124; }`)

Verify from outside: `curl -s https://100.57.37.231.nip.io/jeopardy/health`

The game front-end (game.js `LB_API`) already points at
`https://100.57.37.231.nip.io/jeopardy` in production and
`http://localhost:8124/jeopardy` when served from localhost.

## Run locally

```bash
python3 leaderboard/server.py            # port 8124, db jeopardy-lb.db
```

## API

- `POST /jeopardy/scores` — body `{seed, name, score, total, grid}`;
  `seed` is the daily date `YYYY-MM-DD`, `total` must be 18000 (dollar
  scoring, 6 × $200–$1,000). Returns the updated board.
- `GET /jeopardy/scores?seed=YYYY-MM-DD` — board for that day, sorted by
  score desc then submission time.
- `GET /jeopardy/health`

Paths also work without the `/jeopardy` prefix.
