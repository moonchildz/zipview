# Additional source collection — 2026-09-12

Run `npm run collect:evidence` to download source pages and attachments, query SH's public apartment information portal, verify file hashes, and build the local review gallery. `pipeline:targets` includes these stages. Run `npm run review:evidence` to rebuild the gallery offline. Chrome must be installed for the SH collector.

Gallery while Vite runs: http://127.0.0.1:5173/research/linkage/generated/evidence-review.html

The collection contains 46 unique downloaded assets. Twelve source drawings/documents have content-specific review notes. Other assets include photographs, advertisements and location maps; these are not twelve additional apartment types or 46 verified plans. Downloads/reports are Git-ignored; collection code and provenance notes are retained.

| Source | Acquired evidence | Limits |
| --- | --- | --- |
| [SH apartment information](https://www.i-sh.co.kr/houseinfo/), business70339 | Sinchon 34A/B, 49A, 53A architectural sheets; site plan; 1654×2340 dimensioned resident guide containing four plans | Architectural sheets are 640×452. Resident guide identifies 34B as 203-dong, but provider labels/diagrams differ. Do not merge on the label alone. |
| SH business70339, 49A sheet | Explicit **209-dong terrace** detail, basic/extended plans | Does not independently resolve the whole 209/210 geographic polygon or floor elevations. |
| [Sinchon rental plan repost](https://foodmaker.toesoon.com/entry/신촌푸르지오-공공임대) | Dimensioned 34AT (34.250㎡,15 households), 34B (34.752㎡,4), 49AT(A) (49.020㎡,4); 68-page 2021 rental notice PDF | Area/count corroborate KB candidates29616,75982,179187. Options, geometry and source-specific names need comparison before replacing models. |
| [Xi2 84F terrace listing](https://w2althy.tistory.com/15598555) | Small 84F plan and original terrace/interior photographs | No exact dong, ho or floor. Does not split fifteen ambiguous84F/F1 units. |
| SH business70109 | Dongso-mun Hanjin 6840×4816 unit drawing, another dimensioned sheet, location plans/photos | Redevelopment rental property at Seongbuk-ro4-gil52. Applicability to Hanshin Hanjin205 remains unconfirmed. |

SH's Xi result business70371 is Songwol-gil130 (phase1), not phase2 at99. Its pamphlet was not imported as a phase2 plan. MyHome confirms Sinchon's address under rental-house ID30855892, but currently has no plan attachment. Eunpyeong's old special-supply page yielded no downloadable attachment. These unsuccessful routes are not counted as acquired drawings.

Stored records:

- `downloads/evidence/sh/manifest.json`: public URLs, categories, hashes, dimensions, paths. Raw search/detail/category responses accompany it.
- `generated/additional-sources.json`: additional downloads, source URLs, hashes and errors. Expiring signed queries are omitted from the report.
- `generated/evidence-review.json`: deduplicated verified files, content reviews and unresolved crosswalks. The SH rental guide and three dimensional references now indicate local model/scale application. This is not geographic placement verification; the terrace34B calibration is limited to type viewing, not203 homes.
- `scripts/build-evidence-review.mjs`: content-bound reviews and gallery generation. Changed file bytes or missing reviewed references fail verification.

Acquisition does not establish measured ground-floor elevations, per-floor heights, window sill/head heights, or geographic registration of every home. The next implementation must use these specific sources to resolve geometry and source-type crosswalks; type/area similarity alone is insufficient.
