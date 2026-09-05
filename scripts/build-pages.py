"""Assemble only the public runtime; preserve and verify every approved asset byte."""

import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat

ROOT = Path(__file__).resolve().parents[1]
DESTINATION = ROOT / "_site"
PUBLIC_ROOT_FILES = {"index.html", "styles.css", "script.js", "CNAME", ".nojekyll", "robots.txt"}
PUBLIC_ASSET_TYPES = {
    "brand": {".png"},
    "fonts": {".woff2"},
    "portfolio": {".png"},
    "posters": {".png", ".webp"},
    "video": {".mp4"},
}


def runtime_path(value):
    if not isinstance(value, str) or not re.fullmatch(r"[A-Za-z0-9_./-]+", value):
        raise SystemExit(f"Invalid manifest path: {value!r}")
    relative = PurePosixPath(value)
    if relative.is_absolute() or ".." in relative.parts or relative.as_posix() != value:
        raise SystemExit(f"Unsafe manifest path: {value!r}")
    if value not in PUBLIC_ROOT_FILES:
        parts = relative.parts
        if (len(parts) != 3 or parts[0] != "assets"
                or relative.suffix not in PUBLIC_ASSET_TYPES.get(parts[1], set())):
            raise SystemExit(f"Not an allowed public runtime path: {value}")
    return relative


def source_path(relative):
    candidate = ROOT
    for part in relative.parts:
        candidate = candidate / part
        if candidate.is_symlink() or getattr(candidate, "is_junction", lambda: False)():
            raise SystemExit(f"Refusing a linked source path: {relative}")
    if not candidate.is_file() or not stat.S_ISREG(candidate.stat().st_mode):
        raise SystemExit(f"Missing or non-regular file: {relative}")
    if not candidate.resolve().is_relative_to(ROOT):
        raise SystemExit(f"Source escaped project root: {relative}")
    return candidate


def verify_file(path, item):
    with path.open("rb") as stream:
        digest = hashlib.file_digest(stream, "sha256").hexdigest()
    if digest != item["sha256"].lower() or path.stat().st_size != item["bytes"]:
        raise SystemExit(f"Asset integrity mismatch: {item['path']}")


def build():
    manifest = json.loads((ROOT / "publish-manifest.json").read_text(encoding="utf-8-sig"))
    if not isinstance(manifest, dict) or not isinstance(manifest.get("files"), list) or not manifest["files"]:
        raise SystemExit("Manifest must contain a nonempty files array.")
    if DESTINATION.exists() or DESTINATION.is_symlink():
        raise SystemExit("Refusing to overwrite an existing _site directory; use a fresh build directory.")
    validated = []
    seen = set()
    for item in manifest["files"]:
        if not isinstance(item, dict):
            raise SystemExit("Every manifest entry must be an object.")
        relative = runtime_path(item.get("path"))
        if relative.as_posix().lower() in seen:
            raise SystemExit(f"Duplicate manifest path: {relative}")
        seen.add(relative.as_posix().lower())
        if type(item.get("bytes")) is not int or item["bytes"] < 0:
            raise SystemExit(f"Invalid byte count: {relative}")
        if not isinstance(item.get("sha256"), str) or not re.fullmatch(r"[A-Fa-f0-9]{64}", item["sha256"]):
            raise SystemExit(f"Invalid SHA-256: {relative}")
        source = source_path(relative)
        verify_file(source, item)
        validated.append((source, relative, item))
    if not {"index.html", "styles.css", "script.js"}.issubset(seen):
        raise SystemExit("Manifest is missing the public HTML, CSS, or JavaScript entrypoint.")
    total_bytes = sum(item["bytes"] for item in manifest["files"])
    deployment = {**manifest, "commit": os.environ.get("GITHUB_SHA", "local-candidate")}
    deployment_bytes = (json.dumps(deployment, indent=2) + "\n").encode("utf-8")
    if total_bytes + len(deployment_bytes) >= 1_000_000_000:
        raise SystemExit("Runtime exceeds this project's 1 GB Pages budget.")
    DESTINATION.mkdir()
    for source, relative, item in validated:
        target = DESTINATION / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, target)
        verify_file(target, item)
    (DESTINATION / "deployment.json").write_bytes(deployment_bytes)
    print(f"Verified {len(validated)} runtime files, {total_bytes} bytes; no evidence or source masters included.")


if __name__ == "__main__":
    build()
