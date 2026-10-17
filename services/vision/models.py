"""Model clients. YOLO runs locally; Nemotron VL (W&B Inference) and Cosmos (event GPUs) are hosted.

Keys and endpoints come from services/vision/.env (copy .env.example).

    vl_json(frames, prompt)      Nemotron 3.5 Super VL on W&B: frames + question -> parsed JSON
    cosmos_reason(content)       Cosmos3-Reason: OpenAI-style chat, text + image/video parts
    cosmos_embed(text_or_data)   Cosmos Embed1: 256-dim vector for text or a data:video/... URL
"""

import base64
import json
import os
from functools import cache
from pathlib import Path

import requests
from dotenv import load_dotenv
from openai import OpenAI
from ultralytics import YOLO

HERE = Path(__file__).parent
WEIGHTS = HERE / "weights"
load_dotenv(HERE / ".env")

WANDB_VL_MODEL = os.environ.get("WANDB_VL_MODEL", "nvidia/NVIDIA-Nemotron-3.5-Super-VL-120B-A12B")


@cache
def yolo(size: str = "s") -> YOLO:
    """YOLO26 (latest Ultralytics release, Jan 2026). 'n' is fastest; 's' is a better default on CPU."""
    return YOLO(str(WEIGHTS / f"yolo26{size}.pt"))


@cache
def wandb_llm() -> OpenAI:
    """W&B Inference (served on CoreWeave)."""
    return OpenAI(
        base_url=os.environ.get("WANDB_INFERENCE_URL", "https://api.inference.wandb.ai/v1"),
        api_key=os.environ["WANDB_API_KEY"],
    )


def jpeg_part(jpeg: bytes) -> dict:
    return {"type": "image_url", "image_url": {"url": "data:image/jpeg;base64," + base64.b64encode(jpeg).decode()}}


def vl_json(frames_jpeg: list[bytes], prompt: str, max_tokens: int = 600) -> dict:
    """Ask Nemotron VL about some frames and parse the JSON it returns."""
    res = wandb_llm().chat.completions.create(
        model=WANDB_VL_MODEL,
        messages=[{"role": "user", "content": [{"type": "text", "text": prompt}, *map(jpeg_part, frames_jpeg)]}],
        max_tokens=max_tokens,
        temperature=0,
        # Without thinking it sometimes leaves a string value unquoted; W&B enforces JSON mode server-side.
        response_format={"type": "json_object"},
        # Nemotron VL reasons by default and can spend the whole budget thinking before it answers.
        extra_body={"chat_template_kwargs": {"enable_thinking": False}},
    )
    text = res.choices[0].message.content or ""
    return json.loads(text[text.find("{"): text.rfind("}") + 1])


def _gpu_headers() -> dict:
    token = os.environ.get("GPU_BEARER_TOKEN")
    if not token:
        raise RuntimeError("GPU_BEARER_TOKEN is empty: copy it from /config/<team>.config on the lab VM into services/vision/.env")
    return {"Authorization": f"Bearer {token}"}


@cache
def _model_id(base_url: str) -> str:
    """These NIMs name their model at runtime; ask rather than hard-code it."""
    res = requests.get(f"{base_url}/v1/models", headers=_gpu_headers(), timeout=15)
    res.raise_for_status()
    return res.json()["data"][0]["id"]


def cosmos_reason(content: list[dict] | str, max_tokens: int = 512) -> str:
    """Cosmos3-Reason chat. Content parts can be text, image_url or video_url (data: URLs)."""
    base = os.environ["COSMOS3_REASON_URL"]
    res = requests.post(
        f"{base}/v1/chat/completions",
        headers=_gpu_headers(),
        json={"model": _model_id(base), "messages": [{"role": "user", "content": content}], "max_tokens": max_tokens, "temperature": 0},
        timeout=120,
    )
    res.raise_for_status()
    return res.json()["choices"][0]["message"]["content"]


def cosmos_embed(text_or_data_url: str, request_type: str = "query") -> list[float]:
    """Cosmos Embed1: a 256-dim vector for text, or for a video passed as a data:video/mp4;base64 URL."""
    base = os.environ["COSMOS_EMBED1_URL"]
    res = requests.post(
        f"{base}/v1/embeddings",
        headers=_gpu_headers(),
        json={"input": text_or_data_url, "model": _model_id(base), "request_type": request_type, "encoding_format": "float"},
        timeout=120,
    )
    res.raise_for_status()
    return res.json()["data"][0]["embedding"]
