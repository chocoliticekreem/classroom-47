"""Mirrorverse agent: the CAMP "A" layer, served on the cluster at /app."""

from __future__ import annotations

import base64
import datetime as dt
import json
import os
import shutil
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

try:
    import weave
    from openai import OpenAI
except ImportError:
    weave = None
    OpenAI = None

LEVELS = ("calm", "busy", "danger")
# Overridable so the same agent can point at CoreWeave-hosted NVIDIA endpoints without a rebuild.
WANDB_BASE_URL = os.environ.get("WANDB_BASE_URL", "https://api.inference.wandb.ai/v1")
JWT_SAFETY_MARGIN_S = 60
DEFAULT_JWT_TTL_S = 50 * 60


class UpstreamError(Exception):
    def __init__(self, dependency: str, detail: str):
        super().__init__(detail)
        self.dependency = dependency
        self.detail = detail


def env_str(name: str, default: str = "") -> str:
    return os.environ.get(name, "").strip() or default


def env_int(name: str, default: int) -> int:
    try:
        return int(env_str(name, str(default)))
    except ValueError:
        return default


def env_float(name: str, default: float) -> float:
    try:
        return float(env_str(name, str(default)))
    except ValueError:
        return default


class Config:
    def __init__(self) -> None:
        self.port = env_int("PORT", 8080)
        self.timeout_s = env_float("REQUEST_TIMEOUT_S", 20.0)
        self.username = env_str("USERNAME")
        self.password = env_str("PASSWORD")
        self.ingress_url = env_str("INGRESS_URL").rstrip("/")
        self.wandb_api_key = env_str("WANDB_API_KEY")
        self.wandb_team = env_str("WANDB_TEAM")
        self.wandb_project = env_str("WANDB_PROJECT")
        self.wandb_model = env_str("WANDB_MODEL", "Qwen/Qwen3.8-27B")
        self.top_k = env_int("VSS_TOP_K", 8)
        self.min_similarity = env_float("VSS_MIN_SIMILARITY", 0.3)
        self.enrich_top = env_int("VSS_ENRICH_TOP", 3)
        # VastDB data VIP and keys, names as in /config/<team>.config (vast-database skills).
        self.s3_endpoint = env_str("S3_ENDPOINT").rstrip("/")
        self.access_key = env_str("ACCESS_KEY")
        self.secret_key = env_str("SECRET_KEY")
        self.vastdb_bucket = env_str("VASTDB_BUCKET")
        self.vdb_schema = env_str("VDB_SCHEMA", "vss-schema")
        self.verdicts_table = env_str("VERDICTS_TABLE", "classroom47_verdicts")

    @property
    def vss_configured(self) -> bool:
        return bool(self.ingress_url and self.username and self.password)

    @property
    def vastdb_configured(self) -> bool:
        return bool(self.s3_endpoint and self.access_key and self.secret_key and self.vastdb_bucket)

    @property
    def wandb_configured(self) -> bool:
        return bool(self.wandb_api_key and self.wandb_team and self.wandb_project)

    @property
    def weave_project(self) -> str:
        return f"{self.wandb_team}/{self.wandb_project}" if self.wandb_configured else ""


CFG = Config()


def http_json(method: str, url: str, body: dict | None, headers: dict[str, str], dependency: str) -> Any:
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    for key, value in headers.items():
        req.add_header(key, value)
    try:
        with urllib.request.urlopen(req, timeout=CFG.timeout_s) as resp:
            return json.loads(resp.read().decode() or "null")
    except urllib.error.HTTPError as exc:
        raise UpstreamError(dependency, f"HTTP {exc.code} from {method} {url}") from None
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise UpstreamError(dependency, f"{type(exc).__name__} reaching {url}") from None
    except json.JSONDecodeError:
        raise UpstreamError(dependency, f"non-JSON response from {url}") from None


def jwt_expiry(token: str) -> float:
    try:
        payload = token.split(".")[1]
        payload += "=" * (-len(payload) % 4)
        claims = json.loads(base64.urlsafe_b64decode(payload))
        return float(claims["exp"])
    except (IndexError, KeyError, ValueError, TypeError):
        return time.time() + DEFAULT_JWT_TTL_S


class VssClient:
    def __init__(self) -> None:
        self._token = ""
        self._expires_at = 0.0

    def token(self) -> str:
        if not CFG.vss_configured:
            raise UpstreamError("vss", "INGRESS_URL, USERNAME or PASSWORD not set")
        if self._token and time.time() < self._expires_at - JWT_SAFETY_MARGIN_S:
            return self._token
        body = {"username": CFG.username, "password": CFG.password}
        data = http_json("POST", f"{CFG.ingress_url}/api/v1/auth/login", body, {}, "vss")
        token = (data or {}).get("access_token") if isinstance(data, dict) else None
        if not token:
            raise UpstreamError("vss", "login returned no access_token")
        self._token = token
        self._expires_at = jwt_expiry(token)
        return token

    def post(self, path: str, body: dict) -> Any:
        headers = {"Authorization": f"Bearer {self.token()}"}
        return http_json("POST", f"{CFG.ingress_url}{path}", body, headers, "vss")

    def get(self, path: str, params: dict[str, str]) -> Any:
        headers = {"Authorization": f"Bearer {self.token()}"}
        return http_json("GET", f"{CFG.ingress_url}{path}?{urllib.parse.urlencode(params)}", None, headers, "vss")

    def search(self, query: str, top_k: int | None = None) -> list[dict]:
        data = self.post(
            "/api/v1/search",
            {"query": query, "top_k": top_k or CFG.top_k, "min_similarity": CFG.min_similarity},
        )
        return [normalize_moment(m) for m in extract_list(data)]

    def detections(self, source: str) -> dict:
        data = self.get("/api/v1/tools/detections", {"source": source})
        return data if isinstance(data, dict) else {}

    def segments(self, original_video: str) -> list[dict]:
        data = self.get("/api/v1/tools/segments", {"original_video": original_video})
        return extract_list(data)

    def open_stream(self, source: str, range_header: str | None):
        params = {"source": source, "token": self.token()}
        req = urllib.request.Request(f"{CFG.ingress_url}/api/v1/videos/stream?{urllib.parse.urlencode(params)}")
        if range_header:
            req.add_header("Range", range_header)
        try:
            return urllib.request.urlopen(req, timeout=CFG.timeout_s)
        except urllib.error.HTTPError as exc:
            raise UpstreamError("vss", f"HTTP {exc.code} from videos/stream") from None
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            raise UpstreamError("vss", f"{type(exc).__name__} reaching videos/stream") from None

    def search_and_answer(self, query: str) -> tuple[str, list[dict]]:
        data = self.post("/api/v1/agent/search-and-answer", {"query": query, "top_k": CFG.top_k})
        answer = ""
        if isinstance(data, dict):
            answer = str(data.get("answer") or data.get("response") or data.get("result") or "")
        return answer, [normalize_moment(m) for m in extract_list(data)]

    def reachable(self) -> bool:
        if not CFG.vss_configured:
            return False
        try:
            self.token()
            return True
        except UpstreamError:
            return False


VSS = VssClient()


def extract_list(data: Any) -> list[dict]:
    if isinstance(data, list):
        return [m for m in data if isinstance(m, dict)]
    if isinstance(data, dict):
        for key in ("results", "evidence", "moments", "segments", "sources", "data", "items"):
            value = data.get(key)
            if isinstance(value, list):
                return [m for m in value if isinstance(m, dict)]
    return []


def first(d: dict, *keys: str, default: Any = None) -> Any:
    for key in keys:
        if key in d and d[key] not in (None, ""):
            return d[key]
    meta = d.get("metadata")
    if isinstance(meta, dict):
        for key in keys:
            if key in meta and meta[key] not in (None, ""):
                return meta[key]
    return default


def to_float(value: Any) -> float | None:
    try:
        return round(float(value), 3)
    except (TypeError, ValueError):
        return None


def parse_counts(raw: object) -> dict:
    # VSS stores YOLO counts as a JSON string per segment.
    if isinstance(raw, dict):
        return raw
    try:
        val = json.loads(raw) if isinstance(raw, str) else {}
    except json.JSONDecodeError:
        return {}
    return val if isinstance(val, dict) else {}


def normalize_moment(m: dict) -> dict:
    return {
        "video": str(first(m, "filename", "original_video", "video", "video_name", "source", "file", default="")),
        "source": str(first(m, "source", "preview_source", default="")),
        "original_video": str(first(m, "original_video", default="")),
        "location": str(first(m, "location", default="")),
        "start_s": to_float(first(m, "segment_start_sec", "start_s", "start", "start_time", "start_sec")),
        "end_s": to_float(first(m, "segment_end_sec", "end_s", "end", "end_time", "end_sec")),
        "description": str(
            first(m, "reasoning_content", "description", "text", "caption", "content", "summary", default="")
        ),
        "similarity": to_float(first(m, "similarity_score", "similarity", "score", "distance")),
        "camera": str(first(m, "camera_id", "camera", default="")),
        "counts": parse_counts(first(m, "object_counts", default=None)),
    }


def dedupe(moments: list[dict]) -> list[dict]:
    seen: set[tuple] = set()
    out = []
    for m in moments:
        key = (m["video"], m["start_s"], m["end_s"])
        if key in seen:
            continue
        seen.add(key)
        out.append(m)
    return out[: CFG.top_k]


def people_timeline(detections: dict) -> list[dict]:
    # One point per second: how many people YOLO saw in that frame.
    fps = to_float(detections.get("fps")) or 30.0
    step = max(1, int(round(fps)))
    out = []
    for frame in detections.get("frames") or []:
        if not isinstance(frame, dict) or int(frame.get("frame_index", 0)) % step:
            continue
        dets = frame.get("detections") or []
        people = sum(1 for d in dets if isinstance(d, dict) and d.get("label") == "person")
        out.append({"t": to_float(frame.get("time_sec")), "people": people})
    return out


def enrich_moment(m: dict) -> dict:
    # Official agent tools (retrieval/agent-qa): per-frame YOLO boxes and the parent video's timeline.
    tools: dict[str, Any] = {}
    if m["source"]:
        try:
            det = VSS.detections(m["source"])
            timeline = people_timeline(det)
            tools["people_timeline"] = timeline
            tools["people_peak"] = max((p["people"] for p in timeline), default=0)
            tools["detection_count"] = det.get("detection_count")
            tools["max_detection_conf"] = det.get("max_detection_conf")
        except UpstreamError as exc:
            tools["detections_error"] = exc.detail
    if m["original_video"]:
        try:
            segs = VSS.segments(m["original_video"])
            tools["context"] = [
                {
                    "segment": s.get("segment_number"),
                    "start_s": to_float(s.get("segment_start_sec")),
                    "people": parse_counts(s.get("object_counts")).get("person", 0),
                    "current": s.get("source") == m["source"],
                }
                for s in sorted(segs, key=lambda s: s.get("segment_number") or 0)
            ]
        except UpstreamError as exc:
            tools["segments_error"] = exc.detail
    return {**m, "tools": tools}


def enrich_top(moments: list[dict], n: int) -> list[dict]:
    return [enrich_moment(m) if i < n else m for i, m in enumerate(moments)]


def clip_url(source: str) -> str:
    return f"/app/clip?{urllib.parse.urlencode({'source': source})}" if source else ""


def search_archive(query: str, top_k: int) -> dict:
    t0 = time.time()
    moments = enrich_top(VSS.search(query, top_k), top_k)
    for m in moments:
        m["clip_url"] = clip_url(m["source"])
    return {"query": query, "moments": moments, "latency_ms": int((time.time() - t0) * 1000)}


def build_vss_query(question: str, location: dict | None) -> str:
    place = f" near {location['name']}" if location and location.get("name") else ""
    focus = (
        "crowds gathering or growing, people moving towards or following the camera holder, "
        "people filming or pointing phones at the camera, blocked crossings, vehicles stopping for crowds"
    )
    return f"{question}{place}. Look for: {focus}."


SYSTEM_PROMPT = (
    "You are a safety advisor for a live IRL streamer walking through London. "
    "You get the streamer's question, live YOLO counts and video evidence from the city's cameras. "
    "Reply with STRICT JSON only, no prose, no markdown: "
    '{"level": "calm"|"busy"|"danger", "advice": string, "reasons": string[]}. '
    "advice: at most 2 sentences, imperative, spoken to the streamer. "
    "danger = crowd forming around or following the streamer, filming them, or a blocked route; "
    "busy = many people but nothing directed at the streamer; calm = otherwise."
)


def build_llm_user_message(question: str, location: dict | None, yolo: dict | None, answer: str, evidence: list[dict]) -> str:
    lines = [f"Streamer question: {question}"]
    if location:
        lines.append(f"Location: {json.dumps(location)}")
    if yolo:
        lines.append(f"Live YOLO counts: {json.dumps(yolo)}")
    if answer:
        lines.append(f"VSS agent answer: {answer}")
    lines.append("Video evidence (Cosmos descriptions):")
    for m in evidence:
        span = f"{m['start_s']}-{m['end_s']}s" if m["start_s"] is not None else "?"
        counts = f" yolo={json.dumps(m['counts'])}" if m["counts"] else ""
        tools = m.get("tools") or {}
        peak = f" peak_people_in_frame={tools['people_peak']}" if "people_peak" in tools else ""
        lines.append(f"- [{m['camera'] or m['video']} {span} sim={m['similarity']}{counts}{peak}] {m['description']}")
    if not evidence:
        lines.append("- none found")
    return "\n".join(lines)


class LlmClient:
    def __init__(self) -> None:
        self._client = None
        self._model = ""
        self._weave_ready = False

    def client(self):
        if OpenAI is None:
            raise UpstreamError("wandb", "openai/weave packages not installed")
        if not CFG.wandb_configured:
            raise UpstreamError("wandb", "WANDB_API_KEY, WANDB_TEAM or WANDB_PROJECT not set")
        if self._client is None:
            self._client = OpenAI(
                base_url=WANDB_BASE_URL,
                api_key=CFG.wandb_api_key,
                project=CFG.weave_project,
                timeout=CFG.timeout_s,
            )
        return self._client

    def init_weave(self) -> None:
        if self._weave_ready or weave is None or not CFG.wandb_configured:
            return
        try:
            weave.init(CFG.weave_project)
            self._weave_ready = True
        except Exception as exc:
            print(f"weave.init failed: {type(exc).__name__}", file=sys.stderr)

    def model_in_use(self) -> str:
        return self._model or CFG.wandb_model

    def complete(self, user_message: str) -> str:
        model = self._model or CFG.wandb_model
        try:
            return self._chat(model, user_message)
        except UpstreamError:
            if self._model:
                raise
        self._model = self._first_chat_model()
        return self._chat(self._model, user_message)

    def _chat(self, model: str, user_message: str) -> str:
        client = self.client()
        try:
            resp = client.chat.completions.create(
                model=model,
                temperature=0.2,
                messages=[
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": user_message},
                ],
            )
        except Exception as exc:
            raise UpstreamError("wandb", f"{type(exc).__name__} from model {model}") from None
        return resp.choices[0].message.content or ""

    def _first_chat_model(self) -> str:
        client = self.client()
        try:
            models = list(client.models.list())
        except Exception as exc:
            raise UpstreamError("wandb", f"{type(exc).__name__} listing models") from None
        for m in models:
            if "embed" not in m.id.lower():
                return m.id
        raise UpstreamError("wandb", "no chat model available")


LLM = LlmClient()


def parse_verdict(raw: str) -> dict:
    text = raw.strip()
    if text.startswith("```"):
        text = text.strip("`")
        text = text.split("\n", 1)[1] if "\n" in text else text
    start, end = text.find("{"), text.rfind("}")
    data: Any = None
    if start != -1 and end > start:
        try:
            data = json.loads(text[start : end + 1])
        except json.JSONDecodeError:
            data = None
    if not isinstance(data, dict):
        return {"level": "busy", "advice": text[:240] or "Stay aware of your surroundings.", "reasons": []}
    level = str(data.get("level", "")).lower()
    reasons = data.get("reasons")
    return {
        "level": level if level in LEVELS else "busy",
        "advice": str(data.get("advice") or "Stay aware of your surroundings.")[:400],
        "reasons": [str(r) for r in reasons][:6] if isinstance(reasons, list) else [],
    }


VERDICT_COLUMNS = (
    ("ts", "timestamp[us]"),
    ("question", "string"),
    ("location_name", "string"),
    ("lat", "double"),
    ("lon", "double"),
    ("level", "string"),
    ("advice", "string"),
    ("reasons_json", "string"),
    ("evidence_ids", "string"),
    ("model", "string"),
    ("weave_project", "string"),
    ("latency_ms", "int64"),
)


class VerdictStore:
    """VastDB as the agent's memory: one row per verdict, in the team's bucket (vast-database skills)."""

    def __init__(self) -> None:
        self._session = None
        self.last_error = ""
        self.written = 0

    def _arrow_schema(self):
        import pyarrow as pa

        return pa.schema([(name, pa.type_for_alias(alias)) for name, alias in VERDICT_COLUMNS])

    def _connect(self):
        if self._session is None:
            import vastdb

            self._session = vastdb.connect(
                endpoint=CFG.s3_endpoint, access=CFG.access_key, secret=CFG.secret_key, ssl_verify=False
            )
        return self._session

    def _table(self, tx, create: bool):
        schema = tx.bucket(CFG.vastdb_bucket).schema(CFG.vdb_schema)
        table = schema.table(CFG.verdicts_table, fail_if_missing=False)
        if table is None and create:
            table = schema.create_table(CFG.verdicts_table, columns=self._arrow_schema(), fail_if_exists=False)
        return table

    def write(self, row: dict) -> None:
        if not CFG.vastdb_configured:
            self.last_error = "S3_ENDPOINT, ACCESS_KEY, SECRET_KEY or VASTDB_BUCKET not set"
            return
        try:
            import pyarrow as pa

            schema = self._arrow_schema()
            with self._connect().transaction() as tx:
                self._table(tx, create=True).insert(pa.table({k: [row[k]] for k in schema.names}, schema=schema))
            self.written += 1
            self.last_error = ""
        except Exception as exc:
            self._session = None
            self.last_error = f"{type(exc).__name__}: {str(exc)[:200]}"
            print(f"vastdb write failed: {self.last_error}", file=sys.stderr)

    def write_async(self, row: dict) -> None:
        threading.Thread(target=self.write, args=(row,), daemon=True).start()

    def read(self, limit: int) -> dict:
        if not CFG.vastdb_configured:
            raise UpstreamError("vastdb", "S3_ENDPOINT, ACCESS_KEY, SECRET_KEY or VASTDB_BUCKET not set")
        names = [name for name, _ in VERDICT_COLUMNS]
        try:
            with self._connect().transaction() as tx:
                table = self._table(tx, create=False)
                rows = table.select(columns=names).read_all().to_pylist() if table is not None else []
        except Exception as exc:
            self._session = None
            raise UpstreamError("vastdb", f"{type(exc).__name__}: {str(exc)[:200]}") from None
        rows.sort(key=lambda r: r["ts"] or dt.datetime.min, reverse=True)
        hour_ago = dt.datetime.now(dt.timezone.utc) - dt.timedelta(hours=1)
        last_hour = {level: 0 for level in LEVELS}
        for r in rows:
            ts = r["ts"]
            if ts is not None and ts.tzinfo is None:
                ts = ts.replace(tzinfo=dt.timezone.utc)
            if ts is not None and ts >= hour_ago and r["level"] in last_hour:
                last_hour[r["level"]] += 1
        out = []
        for r in rows[:limit]:
            item = dict(r)
            item["ts"] = r["ts"].isoformat() if r["ts"] is not None else None
            item["reasons"] = json.loads(r["reasons_json"] or "[]")
            item["evidence_ids"] = json.loads(r["evidence_ids"] or "[]")
            del item["reasons_json"]
            out.append(item)
        return {
            "table": f"{CFG.vastdb_bucket}/{CFG.vdb_schema}/{CFG.verdicts_table}",
            "total": len(rows),
            "last_hour_by_level": last_hour,
            "verdicts": out,
        }


VERDICTS = VerdictStore()


def verdict_row(question: str, location: dict | None, verdict: dict, latency_ms: int) -> dict:
    loc = location or {}
    return {
        "ts": dt.datetime.now(dt.timezone.utc).replace(tzinfo=None),
        "question": question,
        "location_name": str(loc.get("name") or ""),
        "lat": to_float(loc.get("lat")),
        "lon": to_float(loc.get("lon")),
        "level": verdict["level"],
        "advice": verdict["advice"],
        "reasons_json": json.dumps(verdict["reasons"]),
        "evidence_ids": json.dumps([m["video"] for m in verdict["evidence"]]),
        "model": LLM.model_in_use(),
        "weave_project": CFG.weave_project,
        "latency_ms": latency_ms,
    }


def assess_core(question: str, location: dict | None, yolo: dict | None) -> dict:
    t0 = time.time()
    query = build_vss_query(question, location)
    answer, evidence = VSS.search_and_answer(query)
    if len(evidence) < CFG.top_k:
        evidence = dedupe(evidence + VSS.search(query))
    evidence = enrich_top(evidence, CFG.enrich_top)
    for m in evidence:
        m["clip_url"] = clip_url(m["source"])
    verdict = parse_verdict(LLM.complete(build_llm_user_message(question, location, yolo, answer, evidence)))
    verdict["evidence"] = evidence
    verdict["vss_answer"] = answer
    verdict["trace"] = {"weave_project": CFG.weave_project}
    verdict["latency_ms"] = int((time.time() - t0) * 1000)
    VERDICTS.write_async(verdict_row(question, location, verdict, verdict["latency_ms"]))
    return verdict


assess = weave.op()(assess_core) if weave is not None else assess_core


def validate_assess_body(body: Any) -> tuple[str, dict | None, dict | None]:
    if not isinstance(body, dict):
        raise ValueError("body must be a JSON object")
    question = str(body.get("question") or "What's happening near the streamer right now?")[:500]
    location = body.get("location") if isinstance(body.get("location"), dict) else None
    yolo = body.get("yolo") if isinstance(body.get("yolo"), dict) else None
    return question, location, yolo


DASHBOARD_HTML = """<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Mirrorverse agent</title>
<style>
:root{--bg:#0b0d10;--card:#14181d;--line:#232a33;--fg:#e8edf2;--mute:#8b98a5;--calm:#36c275;--busy:#f0b429;--danger:#ff4d4f;--accent:#5aa9ff}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 -apple-system,Inter,Segoe UI,sans-serif}
main{max-width:860px;margin:0 auto;padding:32px 16px}h1{font-size:22px;margin:0 0 4px}p.sub{color:var(--mute);margin:0 0 24px}
form{display:flex;gap:8px;margin-bottom:20px}input{flex:1;background:var(--card);border:1px solid var(--line);color:var(--fg);padding:12px 14px;border-radius:10px;font-size:15px}
button{background:var(--accent);color:#06101c;border:0;padding:12px 18px;border-radius:10px;font-weight:600;cursor:pointer}button:disabled{opacity:.5}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:18px;margin-bottom:14px}
.level{display:inline-block;padding:4px 12px;border-radius:999px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;font-size:12px;color:#06101c}
.calm{background:var(--calm)}.busy{background:var(--busy)}.danger{background:var(--danger)}
.advice{font-size:20px;margin:12px 0 8px}ul{margin:6px 0 0 18px;padding:0;color:var(--mute)}
.ev{border-top:1px solid var(--line);padding:10px 0}.ev:first-of-type{border-top:0}.meta{color:var(--mute);font-size:12px}
.err{color:var(--danger)}a{color:var(--accent)}.hidden{display:none}
</style></head><body><main>
<h1>Mirrorverse agent</h1>
<p class="sub">Know what's around you. Rehearse the future before you cause it.</p>
<form id="f"><input id="q" placeholder="What's happening near the streamer?" value="What's happening near the streamer?"><button id="b">Assess</button></form>
<div id="out" class="hidden">
  <div class="card"><span id="lvl" class="level"></span><div id="adv" class="advice"></div><ul id="rs"></ul>
    <p class="meta" id="trace"></p></div>
  <div class="card"><strong>Evidence</strong><div id="ev"></div></div>
</div>
<div id="err" class="card err hidden"></div>
<script>
const $=id=>document.getElementById(id);
$('f').addEventListener('submit',async e=>{e.preventDefault();$('b').disabled=true;$('err').classList.add('hidden');$('out').classList.add('hidden');
try{const r=await fetch('/app/assess',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({question:$('q').value})});
const d=await r.json();if(!r.ok){throw new Error(d.error||r.status)}
$('lvl').textContent=d.level;$('lvl').className='level '+d.level;$('adv').textContent=d.advice;
$('rs').innerHTML=(d.reasons||[]).map(x=>`<li>${esc(x)}</li>`).join('');
const wp=d.trace&&d.trace.weave_project;$('trace').innerHTML=wp?`Traced in Weave: <a target="_blank" href="https://wandb.ai/${esc(wp)}/weave">${esc(wp)}</a>`:'';
$('ev').innerHTML=(d.evidence||[]).map(m=>`<div class="ev"><div>${esc(m.description||'(no description)')}</div><div class="meta">${esc(m.video)} · ${fmt(m.start_s)}–${fmt(m.end_s)} s · sim ${m.similarity??'?'}</div></div>`).join('')||'<p class="meta">No moments returned.</p>';
$('out').classList.remove('hidden')}catch(x){$('err').textContent='Assess failed: '+x.message;$('err').classList.remove('hidden')}finally{$('b').disabled=false}});
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));const fmt=v=>v==null?'?':v;
</script></main></body></html>
"""


class Handler(BaseHTTPRequestHandler):
    server_version = "classroom47-agent/0.1"

    def log_message(self, fmt: str, *args: Any) -> None:
        print(f"{self.command} {self.path} {args[1] if len(args) > 1 else ''}", file=sys.stderr)

    def _cors(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _send(self, status: int, body: bytes, content_type: str) -> None:
        self.send_response(status)
        self._cors()
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _json(self, status: int, data: dict) -> None:
        self._send(status, json.dumps(data).encode(), "application/json")

    def _route(self) -> str:
        path = self.path.split("?", 1)[0]
        if path in ("/app", "/app/"):
            return "/"
        return path[4:] if path.startswith("/app/") else path

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self._cors()
        self.end_headers()

    def _query(self) -> dict[str, str]:
        parts = self.path.split("?", 1)
        return {k: v[0] for k, v in urllib.parse.parse_qs(parts[1]).items()} if len(parts) == 2 else {}

    def _guarded(self, fn) -> None:
        try:
            fn()
        except UpstreamError as exc:
            self._json(502, {"error": f"{exc.dependency} unavailable: {exc.detail}", "dependency": exc.dependency})
        except Exception as exc:
            self._json(500, {"error": f"internal error: {type(exc).__name__}"})

    def _clip(self) -> None:
        source = self._query().get("source", "")
        if not source.startswith("s3://"):
            self._json(400, {"error": "source must be an s3:// segment URI"})
            return
        upstream = VSS.open_stream(source, self.headers.get("Range"))
        with upstream:
            self.send_response(upstream.status)
            self._cors()
            self.send_header("Content-Type", "video/mp4")
            for name in ("Content-Length", "Content-Range", "Accept-Ranges"):
                if upstream.headers.get(name):
                    self.send_header(name, upstream.headers[name])
            self.end_headers()
            shutil.copyfileobj(upstream, self.wfile)

    def do_GET(self) -> None:
        route = self._route()
        if route == "/":
            self._send(200, DASHBOARD_HTML.encode(), "text/html; charset=utf-8")
        elif route == "/health":
            self._json(
                200,
                {
                    "ok": True,
                    "vss": VSS.reachable(),
                    "wandb": CFG.wandb_configured,
                    "vastdb": {
                        "configured": CFG.vastdb_configured,
                        "written": VERDICTS.written,
                        "last_error": VERDICTS.last_error,
                    },
                },
            )
        elif route == "/verdicts":
            limit = min(max(int(self._query().get("limit", "50") or 50), 1), 500)
            self._guarded(lambda: self._json(200, VERDICTS.read(limit)))
        elif route == "/clip":
            self._guarded(self._clip)
        else:
            self._json(404, {"error": "not found"})

    def _read_body(self) -> Any:
        length = int(self.headers.get("Content-Length") or 0)
        return json.loads(self.rfile.read(length) or b"{}")

    def do_POST(self) -> None:
        route = self._route()
        if route == "/assess":
            try:
                question, location, yolo = validate_assess_body(self._read_body())
            except (ValueError, json.JSONDecodeError) as exc:
                self._json(400, {"error": f"bad request: {exc}"})
                return
            self._guarded(lambda: self._json(200, assess(question, location, yolo)))
        elif route == "/search":
            try:
                body = self._read_body()
                query = str(body.get("query") or "").strip()[:500] if isinstance(body, dict) else ""
                top_k = min(max(int(body.get("top_k") or 6), 1), 20) if isinstance(body, dict) else 6
                if not query:
                    raise ValueError("query is required")
            except (ValueError, json.JSONDecodeError, TypeError) as exc:
                self._json(400, {"error": f"bad request: {exc}"})
                return
            self._guarded(lambda: self._json(200, search_archive(query, top_k)))
        else:
            self._json(404, {"error": "not found"})


def main() -> None:
    LLM.init_weave()
    server = ThreadingHTTPServer(("0.0.0.0", CFG.port), Handler)
    print(f"agent listening on :{CFG.port} (vss configured={CFG.vss_configured}, wandb configured={CFG.wandb_configured})", file=sys.stderr)
    server.serve_forever()


if __name__ == "__main__":
    main()
