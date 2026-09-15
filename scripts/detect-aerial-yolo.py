"""Compare DOTA-pretrained YOLO-OBB vehicles with the existing screenshot pilot."""
import argparse
import copy
import hashlib
import json
import math
import os
import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw


def rotated_iou(a, b):
    a, b = np.asarray(a, dtype=np.float32), np.asarray(b, dtype=np.float32)
    intersection, _ = cv2.intersectConvexConvex(a, b)
    union = abs(cv2.contourArea(a)) + abs(cv2.contourArea(b)) - intersection
    return float(intersection / union) if union > 0 else 0


def merge_vehicles(items, exclusions, width, height):
    result = []
    excluded = [[[x1, y1], [x2, y1], [x2, y2], [x1, y2]] for x1, y1, x2, y2 in exclusions]
    for item in sorted(items, key=lambda o: -o["score"]):
        if item["label"].replace("-", " ").replace("_", " ") not in ("small vehicle", "large vehicle"):
            continue
        quad = item["quad"]
        if len(quad) != 4 or any(not math.isfinite(v) for p in quad for v in p):
            continue
        if any(x < 0 or x > width or y < 0 or y > height for x, y in quad):
            continue
        if abs(cv2.contourArea(np.asarray(quad, dtype=np.float32))) < 4:
            continue
        if any(rotated_iou(quad, box) > 0 for box in excluded):
            continue
        # Both DOTA vehicle subclasses may predict the same object across crops.
        if any(rotated_iou(quad, prior["quad"]) > 0.35 for prior in result):
            continue
        result.append(item)
    return [{**item, "id": f"yolo-vehicle-{i + 1}", "kind": "vehicle", "status": "unverified",
             "orientationStatus": "detected-axis-heading-unknown",
             "box": [min(p[0] for p in item["quad"]), min(p[1] for p in item["quad"]),
                     max(p[0] for p in item["quad"]), max(p[1] for p in item["quad"])]}
            for i, item in enumerate(result)]


def positions(length, size=432, overlap=96):
    return [0] if length <= size else sorted(set([*range(0, length - size, size - overlap), length - size]))


def main():
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("image", type=Path)
    parser.add_argument("--baseline", type=Path, default=Path("verification/aerial-regions/detections.json"))
    parser.add_argument("--output", type=Path, default=Path("verification/aerial-yolo"))
    parser.add_argument("--weights", type=Path, default=Path(".tools/models/yolo26m-obb.pt"))
    parser.add_argument("--confidence", type=float, default=0.25)
    args = parser.parse_args()
    if not 0 < args.confidence < 1:
        parser.error("Confidence must be between zero and one")
    source_hash = hashlib.sha256(args.image.read_bytes()).hexdigest()
    baseline = json.loads(args.baseline.read_text(encoding="utf-8"))
    image = Image.open(args.image).convert("RGB")
    width, height = image.size
    if baseline["source"]["sha256"] != source_hash or [baseline["source"]["width"], baseline["source"]["height"]] != [width, height]:
        parser.error("Baseline is not from this input image")
    args.output.mkdir(parents=True, exist_ok=True)
    args.weights.parent.mkdir(parents=True, exist_ok=True)
    config_dir = Path(".tools/yolo-config").resolve()
    config_dir.mkdir(parents=True, exist_ok=True)
    os.environ.setdefault("YOLO_CONFIG_DIR", str(config_dir))
    import torch
    import ultralytics
    from ultralytics import YOLO
    torch.set_num_threads(4)
    model = YOLO(str(args.weights))
    if model.task != "obb":
        parser.error("An OBB checkpoint is required")
    windows = [(0, 0, width, height)] + [(x, y, min(x + 432, width), min(y + 432, height))
               for y in positions(height) for x in positions(width)]
    raw = []
    for i, window in enumerate(windows):
        result = model.predict(image.crop(window), imgsz=1024, conf=args.confidence, iou=0.5,
                               device="cpu", verbose=False, save=False, max_det=1000)[0]
        if result.obb is not None:
            for quad, score, cls in zip(result.obb.xyxyxyxy.cpu().tolist(), result.obb.conf.cpu().tolist(), result.obb.cls.cpu().tolist()):
                raw.append({"quad": [[x + window[0], y + window[1]] for x, y in quad],
                            "score": score, "label": model.names[int(cls)], "window": window})
        print(f"Window {i + 1}/{len(windows)}: {len(raw)} total candidates", flush=True)
    objects = merge_vehicles(raw, baseline["excludedBoxes"], width, height)
    document = copy.deepcopy(baseline)
    document.update({"objects": objects, "reviewCandidates": [],
        "model": {"name": args.weights.name, "package": f"ultralytics=={ultralytics.__version__}",
                  "weightsSha256": hashlib.sha256(args.weights.read_bytes()).hexdigest(),
                  "scoreThreshold": args.confidence, "imageSize": 1024, "windows": windows,
                  "classes": model.names, "task": "obb"},
        "facilityParameters": {"confidence": args.confidence, "modelIou": 0.5, "mergeIou": 0.35, "minimumAreaPixels": 4},
        "facilityCoverage": {"vehicle": "candidate", "playground": "unsupported-class"},
        "baseline": {"source": str(args.baseline), "sha256": hashlib.sha256(args.baseline.read_bytes()).hexdigest(),
                     "vehicleCount": sum(o["kind"] == "vehicle" for o in baseline["objects"])},
        "limitations": ["Vehicle predictions are unverified; counts do not establish accuracy.",
                        "DOTA checkpoint has no playground class. OBB gives axis, not front/back heading.",
                        "Canopy data reused unchanged. Heights and metric scale remain assumed.",
                        "Research pilot only; model and imagery deployment licensing not established."]})
    image.save(args.output / "source.png")
    overlay = image.copy()
    draw = ImageDraw.Draw(overlay)
    for item in objects:
        points = [tuple(p) for p in item["quad"]]
        draw.line(points + points[:1], fill="#19ddff", width=2)
    overlay.save(args.output / "detections.png")
    before = image.copy()
    draw_before = ImageDraw.Draw(before)
    for item in baseline["objects"]:
        if item["kind"] == "vehicle":
            draw_before.rectangle(item["box"], outline="#ffdd36", width=2)
    comparison = Image.new("RGB", (width * 2, height + 36), "#ffffff")
    comparison.paste(before, (0, 36)); comparison.paste(overlay, (width, 36))
    draw = ImageDraw.Draw(comparison)
    draw.text((12, 10), f"Grounding DINO: {document['baseline']['vehicleCount']} vehicle candidates", fill="#172b34")
    draw.text((width + 12, 10), f"{args.weights.name}: {len(objects)} vehicle candidates (not accuracy)", fill="#172b34")
    comparison.save(args.output / "comparison.png")
    (args.output / "detections.json").write_text(json.dumps(document, indent=2), encoding="utf-8")
    (args.output / "raw.json").write_text(json.dumps(raw, indent=2), encoding="utf-8")
    print(json.dumps({"model": args.weights.name, "rawCandidates": len(raw), "vehicles": len(objects),
                      "baselineVehicles": document["baseline"]["vehicleCount"], "canopyRegionsUnchanged": len(document["regions"])}))


if __name__ == "__main__":
    main()
