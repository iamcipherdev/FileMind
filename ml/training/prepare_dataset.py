"""Prepare a FileMind dataset.

Two sources, both local:
  1. --synthetic : generate a labeled corpus from built-in templates
                   (deterministic; good for a first honest training run)
  2. --from-scan : import from a manifest produced by scanning your own
                   folders (see ml/data/README.md for the format)

Output: JSONL with {"name", "content", "label"} + a CSV twin for spreadsheets.
"""

from __future__ import annotations

import argparse
import csv
import json
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from filemind_ml.dataset import LABELS  # noqa: E402

TEMPLATES: dict[str, list[str]] = {
    "documents": [
        "invoice_{n}_{client}.pdf", "receipt_{n}.pdf", "lease_agreement_{n}.pdf",
        "meeting_notes_{date}.txt", "report_draft_{n}.docx", "resume_{first}_{last}.docx",
        "manual_v{n}.pdf", "letter_to_{client}.txt",
    ],
    "spreadsheets": ["budget_{year}.xlsx", "expenses_{month}.xlsx", "hours_tracking_{n}.ods"],
    "presentations": ["pitch_deck_v{n}.pptx", "quarterly_review_{q}.pptx", "training_{topic}.key"],
    "images": ["IMG_{n}.jpg", "screenshot_{date}.png", "vacation_{place}.jpeg", "family_{event}.png", "scan_doc{n}.jpg"],
    "videos": ["VID_{n}.mp4", "birthday_{year}.mp4", "drone_flight_{place}.mov", "lecture_{topic}.mkv"],
    "audio": ["podcast_ep{n}.mp3", "voice_memo_{n}.m4a", "song_demo_{n}.wav", "interview_recording_{n}.flac"],
    "archives": ["backup_{date}.zip", "photos_archive_{year}.tar.gz", "project_export_{n}.7z"],
    "code": ["utils_{n}.py", "app_component_{n}.tsx", "server_main.go", "query_runner.py", "styles_main.css"],
    "design": ["logo_draft_v{n}.psd", "banner_{n}.ai", "wireframes_{n}.fig"],
    "fonts": ["inter_bold.ttf", "gothic_{n}.otf", "grotesk_medium.woff2"],
    "data": ["export_{table}.csv", "config_{n}.json", "metrics_{date}.json", "customers_export.tsv"],
    "books": ["{topic}_book.epub", "calibre_{n}.mobi"],
    "other": ["download_{n}", "untitled_{n}", "newfile_{n}", "document1"],
}

CONTENT_FRAGMENTS: dict[str, list[str]] = {
    "documents": ["invoice total due", "agreement between parties", "meeting agenda attendees", "dear sir or madam"],
    "spreadsheets": ["column,values", "budget forecast q1", "sum of expenses"],
    "presentations": ["slide overview agenda", "market opportunity pricing"],
    "images": [], "videos": [], "audio": [],
    "archives": ["compressed archive contents"],
    "code": ["import pandas as pd", "function render props", "export default component"],
    "design": ["layer mask vector artboard"],
    "fonts": [], "data": ["{\"status\": \"ok\", \"items\": 42}", "id,name,value"],
    "books": ["chapter one it was a", "preface acknowledgements"],
    "other": [],
}

CLIENTS = ["acme", "globex", "initech", "umbrella", "hooli"]
PLACES = ["beach", "mountains", "city", "lake"]
TOPICS = ["physics", "marketing", "gardening", "cooking", "history"]


def _fill(template: str, rng: random.Random) -> str:
    return (
        template.replace("{n}", str(rng.randint(1, 9999)))
        .replace("{date}", f"{rng.randint(2015, 2026)}-{rng.randint(1, 12):02d}-{rng.randint(1, 28):02d}")
        .replace("{year}", str(rng.randint(2015, 2026)))
        .replace("{month}", rng.choice(["jan", "feb", "mar", "apr", "may", "jun"]))
        .replace("{q}", f"q{rng.randint(1, 4)}")
        .replace("{client}", rng.choice(CLIENTS))
        .replace("{place}", rng.choice(PLACES))
        .replace("{topic}", rng.choice(TOPICS))
        .replace("{first}", rng.choice(["alex", "sam", "jo", "priya", "wei"]))
        .replace("{last}", rng.choice(["lee", "patel", "garcia", "kim", "nova"]))
        .replace("{table}", rng.choice(["users", "orders", "events"]))
        .replace("{event}", rng.choice(["dinner", "trip", "graduation"]))
    )


def generate_synthetic(per_class: int, seed: int = 13):
    rng = random.Random(seed)
    rows = []
    for label in LABELS:
        templates = TEMPLATES[label]
        for _i in range(per_class):
            name = _fill(rng.choice(templates), rng)
            content = ""
            frags = CONTENT_FRAGMENTS[label]
            if frags and rng.random() < 0.8:
                content = " ".join(rng.choice(frags) for _ in range(rng.randint(1, 4)))
            rows.append({"name": name, "content": content, "label": label})
    rng.shuffle(rows)
    return rows


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--synthetic", action="store_true", help="generate synthetic corpus")
    ap.add_argument("--per-class", type=int, default=800)
    ap.add_argument("--from-scan", type=str, default=None, help="JSONL manifest of your own files")
    ap.add_argument("--out", type=str, default="ml/data/dataset.jsonl")
    args = ap.parse_args()

    if args.synthetic:
        rows = generate_synthetic(args.per_class)
    elif args.from_scan:
        rows = [json.loads(line) for line in open(args.from_scan, encoding="utf-8") if line.strip()]
    else:
        ap.error("choose --synthetic or --from-scan")

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    with open(out, "w", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")

    csv_path = out.with_suffix(".csv")
    with open(csv_path, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["name", "content", "label"])
        w.writeheader()
        w.writerows(rows)

    counts: dict = {}
    for r in rows:
        counts[r["label"]] = counts.get(r["label"], 0) + 1
    print(f"wrote {len(rows)} rows -> {out}")
    for label in LABELS:
        print(f"  {label:>14}: {counts.get(label, 0)}")


if __name__ == "__main__":
    main()
