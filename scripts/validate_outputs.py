#!/usr/bin/env python3
import csv
import json
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PUBLIC_DIRS = [ROOT / "data", ROOT / "dashboard", ROOT / "docs"]
FORBIDDEN_COLUMNS = {"ip", "network", "cidr", "endpoint", "endpoints", "node", "nodes", "asn_org"}
IPV4_RE = re.compile(r"(?<![\w.])(?:\d{1,3}\.){3}\d{1,3}(?![\w.])")
CIDR_RE = re.compile(r"(?<![\w.])(?:\d{1,3}\.){3}\d{1,3}/\d{1,2}(?![\w.])")


def public_files():
    for directory in PUBLIC_DIRS:
        if directory.exists():
            for path in directory.rglob("*"):
                if path.is_file():
                    yield path


def check_csv(path):
    with path.open(newline="", encoding="utf-8") as handle:
        reader = csv.reader(handle)
        try:
            header = next(reader)
        except StopIteration:
            return []
    lowered = {item.strip().lower() for item in header}
    return [f"{path}: forbidden public column `{col}`" for col in sorted(lowered & FORBIDDEN_COLUMNS)]


def check_text(path):
    text = path.read_text(encoding="utf-8", errors="ignore")
    problems = []
    for match in IPV4_RE.findall(text):
        parts = [int(part) for part in match.split(".")]
        if all(0 <= part <= 255 for part in parts):
            problems.append(f"{path}: IP-like value `{match}`")
            break
    cidr = CIDR_RE.search(text)
    if cidr:
        problems.append(f"{path}: CIDR-like value `{cidr.group(0)}`")
    return problems


def main():
    problems = []
    for path in public_files():
        if path.suffix == ".csv":
            problems.extend(check_csv(path))
        if path.suffix in {".csv", ".json", ".html", ".js", ".css", ".md"}:
            problems.extend(check_text(path))

    for path in ROOT.rglob("*"):
        if path.is_file() and path.parts[-1] != ".gitignore" and "internal" not in path.parts:
            if path.suffix in {".mmdb", ".sqlite", ".db"}:
                problems.append(f"{path}: private database file outside internal/")

    if problems:
        print(json.dumps({"status": "failed", "problems": problems}, indent=2))
        raise SystemExit(1)
    print(json.dumps({"status": "ok", "checked": [str(path.relative_to(ROOT)) for path in public_files()]}, indent=2))


if __name__ == "__main__":
    main()

