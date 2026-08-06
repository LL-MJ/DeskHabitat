# Orchard asset pack

Production-ready transparent PNG assets for the DeskHabitat orchard theme.
The logical sizes in `manifest.ts` target the existing 128 x 64 isometric
projection. Source textures are kept near 2x logical resolution for clean
downscaling.

The runtime PNG files live in `src/renderer/public/assets/orchard`. Keeping
them in Vite's static public directory avoids asset-URL parsing problems caused
by the `#` character in the repository's parent directory.

## Visual direction

- Mature naive-folk storybook illustration, not a juvenile mascot style.
- Soft gouache and watercolor with visible paper grain.
- Rust-brown pencil or crayon contours and handmade asymmetry.
- Muted moss, olive, ochre, cream, terracotta, and warm timber colors.
- Isometric camera approximately 30 degrees above the ground.
- Shadows are intentionally omitted and should be rendered consistently in
  Pixi.

## Contents

| Asset | Footprint | Intended layer |
| --- | --- | --- |
| `grass-tile.png` | 1 x 1 | ground |
| `apple-tree.png` | 2 x 2 | object |
| `shelter.png` | 3 x 2 | object |
| `apple-basket.png` | 1 x 1 | object |
| `wildflowers.png` | 1 x 1 | decoration |
| `stone-edge.png` | one grid edge | object |
| `soil-edge.png` | both continuous visible world edges | ground base |
| `fallen-apple.png` | dynamic loose object | object |

## Generation prompt set

Every asset was generated separately with the established DeskHabitat orchard
concept images as references. The shared prompt required the visual direction
above, exact isometric alignment, a single isolated subject, generous padding,
and a perfectly flat `#ff00ff` chroma-key background with no cast shadow,
ground plane, text, UI, watermark, or unrelated props.

The per-asset subjects were: a broad asymmetric apple tree; a four-post open
moss-roof shelter; a shallow woven apple basket; a sparse wildflower tuft; one
clean 2:1 grass diamond; a low connecting dry-stone edge segment; and one
continuous constant-thickness soil ribbon with a grassy lip.

The chroma-key sources were converted to RGBA with the Codex image-generation
skill's removal helper using soft matte, despill, and a one-pixel edge
contraction. `scripts/process_chroma_assets.py` then trims and normalizes the
output textures.

The soil edge source intentionally retains transparent canvas padding. Its
effective alpha bounds are framed at load time, then an affine transform maps
the same continuous ribbon onto both visible world faces while preserving a
constant 18 px vertical thickness.
