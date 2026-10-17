"""Model clients. YOLO runs locally; Cosmos and the W&B LLMs are hosted (OpenAI-compatible).

Keys and endpoints come from .env (copy .env.example). Model IDs are overridable because the
organisers' environment may serve different names than the public endpoints.
"""

import base64
import os
from functools import cache
from pathlib import Path

from openai import OpenAI
from ultralytics import YOLO

WEIGHTS = Path(__file__).parent / "weights"


@cache
def yolo(size: str = "s") -> YOLO:
    """YOLO26 (latest Ultralytics release, Jan 2026). 'n' is fastest; 's' is a better default on CPU."""
    return YOLO(str(WEIGHTS / f"yolo26{size}.pt"))


@cache
def cosmos() -> OpenAI:
    """Cosmos 3 Nano Reasoner, via NVIDIA's hosted API, a NIM, or vLLM in the event environment."""
    return OpenAI(
        base_url=os.environ.get("COSMOS_BASE_URL", "https://integrate.api.nvidia.com/v1"),
        api_key=os.environ["NVIDIA_API_KEY"],
    )


@cache
def wandb_llm() -> OpenAI:
    """W&B Inference (served on CoreWeave)."""
    return OpenAI(
        base_url=os.environ.get("WANDB_BASE_URL", "https://api.inference.wandb.ai/v1"),
        api_key=os.environ["WANDB_API_KEY"],
    )


COSMOS_MODEL = os.environ.get("COSMOS_MODEL", "nvidia/cosmos3-nano-reasoner")
WANDB_MODEL = os.environ.get("WANDB_MODEL", "Qwen/Qwen3.8-27B")
WANDB_FAST_MODEL = os.environ.get("WANDB_FAST_MODEL", "nvidia/NVIDIA-Nemotron-3.5-Lightning-30B-A3B")


def ask_about_frames(frames_jpeg: list[bytes], question: str, client: OpenAI | None = None, model: str | None = None) -> str:
    """Send a few JPEG frames plus a question to a vision model (Cosmos or a W&B VL model)."""
    content = [{"type": "text", "text": question}] + [
        {"type": "image_url", "image_url": {"url": "data:image/jpeg;base64," + base64.b64encode(f).decode()}}
        for f in frames_jpeg
    ]
    resp = (client or cosmos()).chat.completions.create(
        model=model or COSMOS_MODEL,
        messages=[{"role": "user", "content": content}],
        max_tokens=512,
    )
    return resp.choices[0].message.content
