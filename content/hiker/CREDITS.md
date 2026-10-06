# The Hiker's model: source and licence

`hiker.glb` is the Hiker (CONTEXT.md): the figure who stands for Ali on the trail. It is made from
a character in a free asset pack, with changes listed below.

- **Model**: "Rogue (Hooded)" from KayKit, *Adventurers Character Pack* (version 1.0)
- **Author**: Kay Lousberg (<https://www.kaylousberg.com>)
- **Source**: <https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0>
  (commit `672074b73ba276876a19e8816ecdc5241817ab47`), file
  `addons/kaykit_character_pack_adventures/Characters/gltf/Rogue_Hooded.glb`. The author's own
  page is <https://kaylousberg.itch.io/kaykit-adventurers>.
- **Fetched**: 6 October 2026
- **Licence**: Creative Commons Zero v1.0 Universal (CC0, public domain dedication),
  <https://creativecommons.org/publicdomain/zero/1.0/>. The pack's `LICENSE.txt` says: "License:
  (Creative Commons Zero, CC0) ... This content is free to use in personal, educational and
  commercial projects. Support me by using a brand resource provided in this pack or by crediting
  Kay Lousberg, www.kaylousberg.com (this is not mandatory)". The author's page lists the asset
  licence as "Creative Commons Zero v1.0 Universal" and says "No generative AI was used".
  CC0 allows commercial use and redistribution of the file, so it may sit in this public repository.
  Credit is not required; it is given anyway.

## What was changed

Run `build-hiker.mjs` (here, with `@gltf-transform/core`, `/extensions` and `/functions`) on the
original file:

- Removed the knives, crossbows and throwable (hand-slot props) and the cape.
- Removed all 74 animations except `Walking_A` and `Idle`.
- Added a rucksack, its lid and a bedroll: three plain boxes on the chest bone, coloured from
  cells of the model's own colour atlas (no new texture).
- Deduplicated, pruned and quantized (KHR_mesh_quantization, which three.js reads natively; no
  decoder is needed).
- The original is 3,597,652 bytes; the result is 229,176 bytes with 3,957 triangles
  and one 1024 by 1024 PNG colour atlas.

## Hashes (SHA-256)

- Original `Rogue_Hooded.glb`: `93e6e25213009952276d9cf34f5d96a243767334c66f280db0433ddfabb91545`
- `hiker.glb`: `d57aced9e5521e43d722f95f30817219d791d698f2753e9c34c97461ba778126`
- Original `LICENSE.txt` (copied here as `LICENSE-KayKit.txt`): `ae322141814056dda0deea7540d74c41d87aee1da319977cd1bd84ee5a923629`

The lantern the Hiker carries is not part of the model: the scene draws it.
