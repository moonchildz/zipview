"""Local screenshot pilot. Pixel coordinates, not a georeferenced scene."""

import argparse
import hashlib
import json
import math
import sys
from pathlib import Path


def normalize_predictions(rows, width, height, exclusions, threshold):
    trees = []
    for row in rows:
        box = [float(row[k]) for k in ("xmin", "ymin", "xmax", "ymax")]
        score = float(row["score"])
        if not all(math.isfinite(v) for v in [*box, score]):
            continue
        if score < threshold or score > 1:
            continue
        x1, y1, x2, y2 = box
        x1, x2 = max(0, x1), min(width, x2)
        y1, y2 = max(0, y1), min(height, y2)
        if x2 - x1 < 2 or y2 - y1 < 2:
            continue
        # Excluded labels contain no recoverable image evidence. Reject overlap.
        if any(x1 < b[2] and x2 > b[0] and y1 < b[3] and y2 > b[1]
               for b in exclusions):
            continue
        trees.append({"box": [x1, y1, x2, y2], "score": score})
    trees.sort(key=lambda t: (t["box"][1], t["box"][0]))
    return [{"id": f"tree-{i + 1}", "kind": "tree-candidate", **t}
            for i, t in enumerate(trees)]


def read_exclusions(path, width, height):
    if not path:
        return []
    doc = json.loads(Path(path).read_text(encoding="utf-8"))
    if doc["imageSize"] != [width, height]:
        raise ValueError("Exclusion imageSize does not match the input")
    for box in doc["boxes"]:
        if len(box) != 4 or not all(isinstance(v, (int, float)) and math.isfinite(v) for v in box):
            raise ValueError("Invalid exclusion box")
        if not (0 <= box[0] < box[2] <= width and 0 <= box[1] < box[3] <= height):
            raise ValueError("Exclusion box outside image")
    return doc["boxes"]


def vegetation_fraction(image, box):
    import numpy as np
    x1, y1, x2, y2 = box
    crop = np.asarray(image)[int(y1):math.ceil(y2), int(x1):math.ceil(x2)].astype(float)
    if not crop.size:
        return 0.0
    red, green, blue = crop[:, :, 0], crop[:, :, 1], crop[:, :, 2]
    # A conservative RGB plausibility filter, not semantic segmentation.
    excess_green = (2 * green - red - blue) / np.maximum(red + green + blue, 1)
    mask = (green > red * 1.3) & (green > blue * 1.1) & (green > 25) & (excess_green > 0.2)
    return float(mask.mean())


def main():
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("image", type=Path)
    parser.add_argument("--output", type=Path, default=Path("verification/aerial-refined"))
    parser.add_argument("--assumed-meters-per-pixel", type=float, required=True)
    parser.add_argument("--score", type=float, default=0.35)
    parser.add_argument("--patch-size", type=int, default=400)
    parser.add_argument("--min-vegetation", type=float, default=0.45)
    parser.add_argument("--exclusions", type=Path)
    parser.add_argument("--revision", default="main")
    args = parser.parse_args()
    scale = args.assumed_meters_per_pixel
    if not math.isfinite(scale) or not 0 < scale <= 10:
        parser.error("assumed scale must be finite, > 0 and <= 10 m/px")
    if not 0 < args.score < 1 or args.patch_size < 64 or not 0 <= args.min_vegetation <= 1:
        parser.error("score must be between 0 and 1; patch-size must be >= 64")

    from PIL import Image, ImageDraw, ImageOps
    image = ImageOps.exif_transpose(Image.open(args.image)).convert("RGB")
    width, height = image.size
    if width * height > 25_000_000:
        parser.error("Screenshot pilot limited to 25 megapixels")
    exclusions = read_exclusions(args.exclusions, width, height)
    args.output.mkdir(parents=True, exist_ok=True)

    import numpy as np
    from deepforest import main as deepforest
    from huggingface_hub import model_info
    revision = model_info("weecology/deepforest-tree", revision=args.revision).sha
    detector = deepforest.deepforest(config_args={
        "accelerator": "cpu", "devices": 1, "workers": 0,
        "score_thresh": args.score,
        "model": {"name": "weecology/deepforest-tree", "revision": revision},
        "log_root": str(args.output / "logs"),
    })
    # The installed 2.1.0 dataset loader uses RGB, despite the older BGR docstring.
    result = detector.predict_tile(
        image=np.asarray(image).copy(),
        patch_size=min(args.patch_size, width, height), patch_overlap=0.25,
        dataloader_strategy="single",
    )
    rows = [] if result is None else result.to_dict("records")
    trees = normalize_predictions(rows, width, height, exclusions, args.score)
    candidates = [{**tree, "vegetationFraction": vegetation_fraction(image, tree["box"])} for tree in trees]
    trees = [tree for tree in candidates if tree["vegetationFraction"] >= args.min_vegetation]
    document = {
        "schemaVersion": 1, "coordinateSystem": "image-pixels",
        "source": {"fileName": args.image.name, "width": width, "height": height,
                   "sha256": hashlib.sha256(args.image.read_bytes()).hexdigest()},
        "model": {"name": "weecology/deepforest-tree", "revision": revision,
                  "package": "deepforest==2.1.0", "scoreThreshold": args.score,
                  "patchSize": min(args.patch_size, width, height), "patchOverlap": 0.25},
        "vegetationFilter": {"minimumFraction": args.min_vegetation,
                             "rule": "G > 1.3 R, G > 1.1 B, G > 25, (2G-R-B)/(R+G+B) > 0.2", "status": "heuristic"},
        "counts": {"afterModelNms": len(rows), "afterLabelExclusion": len(candidates), "accepted": len(trees)},
        "scale": {"metersPerPixel": scale, "status": "assumed"},
        "height": {"status": "assumed", "crownDiameterRatio": 1.5,
                   "minimumMeters": 2, "maximumMeters": 18},
        "excludedBoxes": exclusions, "objects": trees,
        "limitations": ["Tree candidates only; no species identification or measured heights.",
                        "Boxes are not crown segmentation masks.",
                        "RGB plausibility filtering may miss shaded trees and retain green roofs.",
                        "Image coordinates are not ground coordinates; oblique displacement is uncorrected.",
                        "Excluded map labels remain unknown; no inpainting.",
                        "No buildings, cars or playground models are reconstructed."],
    }
    image.save(args.output / "source.png")
    overlay = image.copy()
    draw = ImageDraw.Draw(overlay)
    for box in exclusions:
        draw.rectangle(box, outline="#ff4060", width=2)
    for tree in trees:
        draw.rectangle(tree["box"], outline="#ffdd36", width=2)
        draw.text(tuple(tree["box"][:2]), f'{tree["id"]} {tree["score"]:.2f}', fill="#ffdd36")
    overlay.save(args.output / "detections.png")
    (args.output / "detections.json").write_text(json.dumps(document, indent=2), encoding="utf-8")
    (args.output / "rejected.json").write_text(json.dumps(
        [tree for tree in candidates if tree["vegetationFraction"] < args.min_vegetation], indent=2), encoding="utf-8")
    print(json.dumps({"treeCandidates": len(trees), "output": str(args.output),
                      "scaleStatus": "assumed", "modelRevision": revision}))


if __name__ == "__main__":
    main()
