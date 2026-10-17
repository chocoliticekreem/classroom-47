"""Evaluate VSS search for the streamer-safety queries the agent depends on.

Each query in eval_queries.json names the cameras whose footage should answer it. A query
is a hit@k when at least one of the top-k VSS moments comes from an expected camera.
Run it before and after a re-ingest with our Cosmos prompt and compare the two tables.

    INGRESS_URL=... USERNAME=... PASSWORD=... python3 eval_search.py [--top-k 8] [--min-similarity 0.3] [--json out.json]

Stdlib only, so it runs on the lab VM as-is. Never prints credentials.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).parent
TIMEOUT_S = 60


def http_json(method: str, url: str, body: dict | None, headers: dict) -> dict:
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers={"Content-Type": "application/json", **headers})
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT_S) as res:
            return json.load(res)
    except urllib.error.HTTPError as exc:
        sys.exit(f"{method} {url} failed: HTTP {exc.code}")
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        sys.exit(f"{method} {url} failed: {type(exc).__name__}")


def login(base: str) -> str:
    body = {"username": os.environ["USERNAME"], "password": os.environ["PASSWORD"]}
    token = http_json("POST", f"{base}/api/v1/auth/login", body, {}).get("access_token")
    if not token:
        sys.exit("login returned no access_token")
    return token


def moments(data: dict) -> list[dict]:
    for key in ("results", "moments", "segments", "items"):
        if isinstance(data.get(key), list):
            return [m for m in data[key] if isinstance(m, dict)]
    return []


def camera_of(m: dict) -> str:
    for key in ("camera_id", "camera"):
        if m.get(key):
            return str(m[key])
    meta = m.get("metadata") or {}
    return str(meta.get("camera_id") or "")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--queries", default=str(HERE / "eval_queries.json"))
    ap.add_argument("--top-k", type=int, default=8)
    ap.add_argument("--min-similarity", type=float, default=0.3)
    ap.add_argument("--json", help="also write the per-query results here")
    args = ap.parse_args()

    base = os.environ.get("INGRESS_URL", "").rstrip("/")
    if not base or not os.environ.get("USERNAME") or not os.environ.get("PASSWORD"):
        sys.exit("set INGRESS_URL, USERNAME and PASSWORD (values from /config/<team>.config, never printed)")
    headers = {"Authorization": f"Bearer {login(base)}"}

    queries = json.loads(Path(args.queries).read_text())
    rows = []
    for q in queries:
        data = http_json(
            "POST",
            f"{base}/api/v1/search",
            {"query": q["query"], "top_k": args.top_k, "min_similarity": args.min_similarity},
            headers,
        )
        found = moments(data)
        cams = [camera_of(m) for m in found]
        expected = set(q["expect_cameras"])
        rank = next((i + 1 for i, c in enumerate(cams) if c in expected), None)
        top_sim = max((float(m.get("similarity_score") or m.get("similarity") or 0) for m in found), default=0.0)
        rows.append({"query": q["query"], "hits": len(found), "rank": rank, "top_similarity": round(top_sim, 3), "cameras": cams})

    k = args.top_k
    print(f"| query | moments | first expected camera at | top similarity | hit@{k} |")
    print("|---|---|---|---|---|")
    for r in rows:
        print(f"| {r['query']} | {r['hits']} | {r['rank'] or '-'} | {r['top_similarity']} | {'yes' if r['rank'] else 'no'} |")
    hit = sum(1 for r in rows if r["rank"])
    print(f"\nhit@{k}: {hit}/{len(rows)}  (top_k={k}, min_similarity={args.min_similarity})")
    if args.json:
        Path(args.json).write_text(json.dumps(rows, indent=1))


if __name__ == "__main__":
    main()
