# Screenshot Object Pilot

## YOLO-OBB Comparison

The default review now loads `verification/aerial-yolo/detections.json`.
The vehicle-model selector switches between YOLO and the unchanged Grounding
DINO baseline; the canopy segmentation and procedural grove are identical.

```powershell
& .tools/tree-python/Scripts/python.exe scripts/detect-aerial-yolo.py shot.png
```

The script uses `ultralytics==8.4.152` and the official `yolo26m-obb.pt` checkpoint.
It processes the full image and the same six crops as the previous detector,
at input size 1024 and confidence threshold 0.25. Original pixel coordinates
and four rotated corners are retained. Polygon-IoU suppression merges duplicate
vehicles across crops and across the two DOTA vehicle subclasses. UI-label
intersections and out-of-image predictions are excluded. It does not apply a
hand-drawn road mask or manually remove the playground location.

The `shot.png` run returned 61 raw predictions and 28 retained vehicle candidates,
versus 23 in the prior baseline. Visual comparison showed roadway-aligned boxes
and removal of the prior courtyard vehicle boxes. This is a qualitative finding,
not an accuracy/recall benchmark; missed vehicles and false positives remain
possible. Scores from different models are not directly calibrated to each other.

Output includes `detections.png`, side-by-side `comparison.png`, `raw.json`,
and a compatible `detections.json` with checkpoint hash/version/parameters.
OBB corners are used directly in both the 2D overlay and 3D extrusion, without
discarding the angle. Vehicle models remain height-assumed candidate envelopes.
The detected long-axis orientation does not resolve the vehicle's front/back.

Playgrounds are **unsupported by this checkpoint**, not a successful negative
detection. The review explicitly shows this rather than reporting zero verified
playgrounds. This remains a local research experiment; deployment rights for
Ultralytics, the canopy model and the imagery require separate review.

Tests: `tests/test_aerial_yolo.py` checks rotated overlap, vehicle-label aliases,
deduplication and exclusions. JS tests check OBB coordinate/extrusion consistency.
Run browser tests with `AERIAL_REGIONS=1` and `AERIAL_YOLO=1` for model switching,
desktop/mobile rendering, canopy controls and oriented GLB metadata.

## Grove Rendering

The region review now defaults to procedural tree groves instead of extruded
green volumes. `src/aerial-grove.js` fills each existing mask polygon with
deterministically jittered tree placements. Crown radii are bounded by distance
to both the exterior and interior-hole boundaries. Nearby crowns overlap, with
varying heights, foliage clusters, trunks and forked branches. Two instanced
meshes share the geometry across the entire scene.

These are illustrative, low-poly tree models, not new detections or measured
tree locations/species/heights. The original 30 segmentation regions and all
facility candidates remain unchanged. The current default screenshot settings
produce 706 procedural placements; that number is not a real-tree census.

The review has grove/volume comparison, density and height controls, a grove
close-up view and GLB export of the selected representation. Export metadata
marks the procedural placement and assumed heights. Unit tests check repeatable
placement, mask/hole containment of the foliage geometry and height controls.
Desktop/mobile browser checks include comparison screenshots, density/height
changes and GLB metadata.

## Region Revision

The default review now uses `verification/aerial-regions/`, not the rejected
individual-tree pilot. Run:

```powershell
& .tools/tree-python/Scripts/python.exe scripts/detect-aerial-regions.py shot.png --assumed-meters-per-pixel 0.3 --exclusions research/aerial-shot-exclusions.json
```

`--reuse` reuses completed Grounding DINO detections from the same input hash.
The canopy model's probability map is also cached with source/model provenance.

The revised canopy path uses `restor/tcd-segformer-mit-b3` for per-pixel tree
cover, followed by connected regions (7-pixel closing, 100-pixel minimum area).
Holes and excluded map-label areas remain holes. It does not count individual
trees. A previous RGB-only grouping experiment was rejected because building
shadows and green roofs were included as canopy.

Facility candidates use `IDEA-Research/grounding-dino-tiny`, full-image plus six
overlapping crops. Class-aware NMS, UI exclusion and screenshot-specific size
and score gates reduce implausible boxes. Vehicle direction and detailed shape
are not inferred. Vehicles are candidate envelopes, not detailed car models.
Playground candidates below score 0.5 are held out in `reviewCandidates` and are
not inserted into 3D. Missing detections do not prove the facility is absent.

The inspected `shot.png` run produced 30 canopy regions (50,074 pixels),
23 vehicle candidates, and no accepted playground candidate. The initial
playground boxes included building roofs and a whole crop, so this portion
is not successful. None of these counts is a measured accuracy statistic.

Additional tests: `tests/test_aerial_regions.py`, `tests/aerial-regions.test.mjs`.
Set `AERIAL_REGIONS=1` for `tests/aerial-browser.mjs` to test the revised page.

**Research only:** The canopy [model card](https://huggingface.co/restor/tcd-segformer-mit-b3)
references NVIDIA's research license and CC BY-NC training imagery. This pilot
does not establish permission for commercial deployment. No model weights or
derived image artifacts are bundled into the apartment service. A deployment
needs its own licensing review/model choice and urban-aerial accuracy evaluation.

## Original Individual-Tree Pilot

This experiment is separate from the georeferenced apartment scenes. No detected
object is silently added to a real apartment's window view.

## Run

Install Python 3.12 and `scripts/requirements-aerial.txt`. The local workspace
already has `.tools/tree-python/Scripts/python.exe` with DeepForest 2.1.0.

```powershell
& .tools/tree-python/Scripts/python.exe scripts/detect-aerial-trees.py shot.png --assumed-meters-per-pixel 0.3 --patch-size 200 --exclusions research/aerial-shot-exclusions.json
& .tools/node-v24.21.0-win-x64/node.exe node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5174 --strictPort
```

Open `http://127.0.0.1:5174/aerial-review.html` in the development server.
The first execution downloads model weights. No image is uploaded to a model API;
inference uses local CPU. Hugging Face is contacted to resolve/download weights.

## Algorithm

1. Load the supplied RGB screenshot without generating/replacing its contents.
2. DeepForest detects tree-crown boxes in overlapping 200-pixel windows.
3. Model non-maximum suppression removes overlapping detections.
4. Reject boxes intersecting user-interface labels. Only these label rectangles
   are manually marked for `shot.png`; tree locations are not hand-placed.
5. Apply an RGB vegetation plausibility test. This is a heuristic, not a trained
   segmentation model. Keep rejected candidates separately for inspection.
6. Convert box centers and horizontal sizes from pixels using the explicit
   assumed scale. Map image-right to +X and image-down to +Z, without mirroring.
7. Build two shared instanced meshes for trunks and crowns. Height is a bounded
   crown-diameter heuristic, not measured from the image. Export carries the
   assumed-scale/height status and source hash in GLB metadata.

## Artifacts

Local, git-ignored output: `verification/aerial-refined/`:

- `source.png`: RGB input used by the detector and preview.
- `detections.png`: boxes over the input; red boxes mark excluded labels.
- `detections.json`: candidates, pixel coordinates, scores, model revision,
  source SHA-256, algorithm parameters, and assumptions.
- `rejected.json`: candidates rejected by the RGB plausibility filter.

The review provides score filtering, editable assumed scale, photo/tree toggles,
orbit/top views and GLB export. It is a development-only review page; local image
artifacts are not included in production bundles or committed automatically.

## Limits

The screenshot's tilt, shadows, green cast and small crowns cause model errors.
Green roofs can remain false positives; dark/shaded trees can be missed. The
colors were adjusted using this screenshot, not validated across Seoul. Scores
are model scores, not calibrated probabilities. No precision/recall is claimed
without separately annotated ground truth.

The entire screenshot is a flat backdrop, including visible roofs. Buildings,
terrain, cars and playgrounds are not reconstructed in this tree-only pilot.
Unknown scale, ground positions, relief displacement, tree heights and species
prevent treating the result as a surveyed 3D neighborhood. Further work needs
urban aerial training/validation, crown segmentation, ground geometry and height
evidence, not just more detailed tree meshes.

## Tests

```powershell
& .tools/tree-python/Scripts/python.exe tests/test_aerial_trees.py
& .tools/node-v24.21.0-win-x64/node.exe --test tests/aerial-objects.test.mjs
& .tools/node-v24.21.0-win-x64/node.exe tests/aerial-browser.mjs
```

Browser checks require the generated screenshot results and a running dev server.
They test desktop/mobile rendering, camera changes, tree/photo visibility,
threshold filtering, GLB export metadata, and horizontal overflow. These are
functional checks, not object-recognition accuracy measurements.

Model and implementation references:
[DeepForest](https://github.com/weecology/DeepForest),
[tree model](https://huggingface.co/weecology/deepforest-tree).
