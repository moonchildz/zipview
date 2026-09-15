"""Experimental vegetation regions and grounded facility candidates from RGB."""
import argparse
import hashlib
import json
import math
import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw


def positions(length, size=432, overlap=96):
    if length <= size:
        return [0]
    return sorted(set([*range(0, length - size, size - overlap), length - size]))


def category(label):
    if "tree" in label or "bush" in label:
        return "vegetation"
    if "car" in label or "truck" in label:
        return "vehicle"
    if any(word in label for word in ["playground", "slide", "swing"]):
        return "playground"
    return None


def overlap(a, b):
    return max(0, min(a[2], b[2]) - max(a[0], b[0])) * max(0, min(a[3], b[3]) - max(a[1], b[1]))


def deduplicate(items, excluded):
    result = []
    for item in sorted(items, key=lambda i: -i["score"]):
        a = item["box"]
        area = (a[2] - a[0]) * (a[3] - a[1])
        if area <= 0 or any(overlap(a, b) for b in excluded):
            continue
        duplicate = False
        for prior in result:
            if item["kind"] != prior["kind"]:
                continue
            b = prior["box"]
            intersection = overlap(a, b)
            other_area = (b[2] - b[0]) * (b[3] - b[1])
            if intersection / (area + other_area - intersection) > 0.35:
                duplicate = True
                break
        if not duplicate:
            result.append(item)
    return result


def vegetation_regions(probability, excluded, min_area=100, gap=7):
    mask = (probability >= 0.5).astype('uint8') * 255
    for x1, y1, x2, y2 in excluded:
        mask[int(y1):math.ceil(y2), int(x1):math.ceil(x2)] = 0
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3)))
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (gap, gap)))
    # Never bridge across the pixels hidden by map UI.
    for x1, y1, x2, y2 in excluded:
        mask[int(y1):math.ceil(y2), int(x1):math.ceil(x2)] = 0
    count, labels, stats, _ = cv2.connectedComponentsWithStats(mask, 8)
    keep = np.zeros_like(mask)
    regions = []
    for label in range(1, count):
        if stats[label, cv2.CC_STAT_AREA] < min_area:
            continue
        component = (labels == label).astype('uint8') * 255
        contours, hierarchy = cv2.findContours(component, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_SIMPLE)
        for index, contour in enumerate(contours):
            if hierarchy[0][index][3] != -1 or len(contour) < 3:
                continue
            ring = cv2.approxPolyDP(contour, 1, True).reshape(-1, 2).tolist()
            if len(ring) < 3:
                continue
            holes = []
            child = hierarchy[0][index][2]
            while child != -1:
                hole = cv2.approxPolyDP(contours[child], 1, True).reshape(-1, 2).tolist()
                if len(hole) >= 3:
                    holes.append(hole)
                child = hierarchy[0][child][0]
            regions.append({"id": f"vegetation-{len(regions) + 1}", "kind": "vegetation-region",
                            "ring": ring, "holes": holes, "areaPixels": int(stats[label, cv2.CC_STAT_AREA]),
                            "method": "semantic-connected-region", "status": "unverified", "heightMeters": 5})
        keep[labels == label] = 255
    return regions, keep


def canopy_prediction(image, output, source_hash):
    import torch
    from transformers import AutoImageProcessor, AutoModelForSemanticSegmentation
    from huggingface_hub import model_info
    torch.set_num_threads(4)
    name = "restor/tcd-segformer-mit-b3"
    meta_file, probability_file = output / "canopy-model.json", output / "canopy-probability.npy"
    if meta_file.exists() and probability_file.exists():
        meta = json.loads(meta_file.read_text(encoding="utf-8"))
        if meta["sourceHash"] == source_hash and meta["name"] == name:
            return np.load(probability_file), meta
    revision = model_info(name).sha
    processor = AutoImageProcessor.from_pretrained(name, revision=revision)
    model = AutoModelForSemanticSegmentation.from_pretrained(name, revision=revision).eval()
    inputs = processor(images=image, return_tensors="pt")
    with torch.inference_mode():
        logits = model(**inputs).logits
        logits = torch.nn.functional.interpolate(logits, size=(image.height, image.width), mode="bilinear", align_corners=False)
        probability = logits.softmax(dim=1)[0, int(model.config.label2id["tree"])].numpy()
    meta = {"name": name, "revision": revision, "sourceHash": source_hash,
            "usage": "research-pilot-only; deployment license review required",
            "licenseNote": "Model card references NVIDIA research license and CC BY-NC training imagery."}
    np.save(probability_file, probability)
    meta_file.write_text(json.dumps(meta, indent=2), encoding="utf-8")
    return probability, meta


def main():
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("image", type=Path)
    parser.add_argument("--output", type=Path, default=Path("verification/aerial-regions"))
    parser.add_argument("--exclusions", type=Path)
    parser.add_argument("--reuse", action="store_true")
    parser.add_argument("--assumed-meters-per-pixel", type=float, required=True)
    args = parser.parse_args()
    if not math.isfinite(args.assumed_meters_per_pixel) or not 0 < args.assumed_meters_per_pixel <= 10:
        parser.error("Invalid assumed scale")
    image = Image.open(args.image).convert("RGB")
    width, height = image.size
    source_hash = hashlib.sha256(args.image.read_bytes()).hexdigest()
    exclusions = []
    if args.exclusions:
        doc = json.loads(args.exclusions.read_text(encoding="utf-8"))
        if doc["imageSize"] != [width, height]:
            parser.error("Exclusion image dimensions differ")
        exclusions = doc["boxes"]
    args.output.mkdir(parents=True, exist_ok=True)
    raw_file = args.output / "grounded-raw.json"
    if args.reuse:
        raw = json.loads(raw_file.read_text(encoding="utf-8"))
        if raw["sourceHash"] != source_hash or not raw["complete"]:
            parser.error("Cached results are incomplete or from a different image")
    else:
        import torch
        from transformers import AutoProcessor, AutoModelForZeroShotObjectDetection
        from huggingface_hub import model_info
        torch.set_num_threads(4)
        name = "IDEA-Research/grounding-dino-tiny"
        revision = model_info(name).sha
        processor = AutoProcessor.from_pretrained(name, revision=revision)
        model = AutoModelForZeroShotObjectDetection.from_pretrained(name, revision=revision).eval()
        raw = {"sourceHash": source_hash, "model": name, "revision": revision, "complete": False,
               "prompt": "tree. bush. car. truck. playground. playground slide. swing set.", "items": []}
        windows = [(0, 0, width, height)] + [(x, y, min(x + 432, width), min(y + 432, height))
                   for y in positions(height) for x in positions(width)]
        for index, window in enumerate(windows):
            crop = image.crop(window)
            inputs = processor(images=crop, text=raw["prompt"], return_tensors="pt")
            with torch.inference_mode():
                outputs = model(**inputs)
            result = processor.post_process_grounded_object_detection(outputs, inputs.input_ids,
                threshold=0.22, text_threshold=0.22, target_sizes=[(crop.height, crop.width)])[0]
            for box, score, label in zip(result["boxes"], result["scores"], result["text_labels"]):
                kind = category(label)
                if not kind:
                    continue
                b = box.tolist()
                b = [max(0, b[0] + window[0]), max(0, b[1] + window[1]),
                     min(width, b[2] + window[0]), min(height, b[3] + window[1])]
                raw["items"].append({"kind": kind, "box": b, "score": float(score), "label": label, "window": window})
            raw_file.write_text(json.dumps(raw, indent=2), encoding="utf-8")
            print(f"Window {index + 1}/{len(windows)}: {len(raw['items'])} candidates", flush=True)
        raw["complete"] = True
        raw_file.write_text(json.dumps(raw, indent=2), encoding="utf-8")
    objects = deduplicate(raw["items"], exclusions)
    probability, canopy_meta = canopy_prediction(image, args.output, source_hash)
    regions, mask = vegetation_regions(probability, exclusions)
    facility_candidates = [{**item, "id": f"{item['kind']}-{i + 1}", "status": "unverified"}
                          for i, item in enumerate(objects) if item["kind"] != "vegetation"]
    objects, review = [], []
    for item in facility_candidates:
        b = item["box"]
        # Screenshot-scale plausibility gate is configurable in a future geo pipeline.
        accepted = ((item["kind"] == "vehicle" and item["score"] >= 0.25 and max(b[2]-b[0], b[3]-b[1]) <= 40)
                    or (item["kind"] == "playground" and item["score"] >= 0.5))
        (objects if accepted else review).append(item)
    document = {"schemaVersion": 2, "coordinateSystem": "image-pixels",
        "source": {"fileName": args.image.name, "width": width, "height": height, "sha256": source_hash},
        "scale": {"metersPerPixel": args.assumed_meters_per_pixel, "status": "assumed"},
        "model": {"name": raw["model"], "revision": raw["revision"], "scoreThreshold": 0.22, "prompt": raw["prompt"]},
        "canopyModel": canopy_meta,
        "facilityParameters": {"vehicleScore": 0.25, "vehicleMaxSidePixels": 40, "playgroundScore": 0.5},
        "regionParameters": {"gapPixels": 7, "minimumAreaPixels": 100, "heightStatus": "assumed"},
        "excludedBoxes": exclusions, "regions": regions, "objects": objects, "reviewCandidates": review,
        "limitations": ["Semantic vegetation predictions are not ground truth; roofs/shadows can be misclassified.",
                         "Playground detections are unverified candidates, not reconstructed equipment.",
                         "Scale, heights and ground positions are assumed; image relief is not corrected."]}
    image.save(args.output / "source.png")
    Image.fromarray(mask).save(args.output / "vegetation-mask.png")
    overlay = image.convert("RGBA")
    tint = np.zeros((height, width, 4), dtype='uint8')
    tint[mask > 0] = [65, 232, 92, 110]
    overlay = Image.alpha_composite(overlay, Image.fromarray(tint))
    draw = ImageDraw.Draw(overlay)
    for region in regions:
        draw.line([tuple(p) for p in region["ring"] + region["ring"][:1]], fill="#77ff77", width=2)
    for obj in objects:
        color = "#ffdc35" if obj["kind"] == "vehicle" else "#fc79ed"
        draw.rectangle(obj["box"], outline=color, width=2)
        draw.text(tuple(obj["box"][:2]), f"{obj['kind']} {obj['score']:.2f}", fill=color)
    overlay.save(args.output / "detections.png")
    (args.output / "detections.json").write_text(json.dumps(document, indent=2), encoding="utf-8")
    print(json.dumps({"regions": len(regions), "vegetationPixels": int((mask > 0).sum()),
                      "vehicles": sum(o["kind"] == "vehicle" for o in objects),
                      "playgrounds": sum(o["kind"] == "playground" for o in objects)}))


if __name__ == "__main__":
    main()
