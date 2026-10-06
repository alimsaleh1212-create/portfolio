// Builds hiker.glb from KayKit's Rogue_Hooded.glb (CC0). See CREDITS.md.
// Usage (needs @gltf-transform/core, /extensions and /functions; not project dependencies):
//   node build-hiker.mjs path/to/Rogue_Hooded.glb hiker.glb
import { Document, NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { prune, quantize, dedup } from "@gltf-transform/functions";

const [src, out] = process.argv.slice(2);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(src);
const root = doc.getRoot();

// Weapons, the cape (a pack hangs there instead), and every animation but two.
const drop = ["Knife_Offhand", "1H_Crossbow", "2H_Crossbow", "Knife", "Throwable", "Rogue_Cape"];
for (const node of root.listNodes()) if (drop.includes(node.getName())) node.dispose();
for (const a of root.listAnimations()) {
  if (["Walking_A", "Idle"].includes(a.getName())) continue;
  for (const c of a.listChannels()) c.dispose();
  for (const s of a.listSamplers()) s.dispose();
  a.dispose();
}

// A rucksack: a main bag, a lid and a rolled mat, as plain boxes on the chest bone,
// coloured from cells of the atlas that is already in the file.
const material = root.listMaterials()[0];
const chest = root.listNodes().find((n) => n.getName() === "chest");
function box([cx, cy, cz], [w, h, d], uv) {
  const hx = w / 2, hy = h / 2, hz = d / 2;
  const faces = [
    [[1, 0, 0], [[hx, -hy, hz], [hx, -hy, -hz], [hx, hy, -hz], [hx, hy, hz]]],
    [[-1, 0, 0], [[-hx, -hy, -hz], [-hx, -hy, hz], [-hx, hy, hz], [-hx, hy, -hz]]],
    [[0, 1, 0], [[-hx, hy, hz], [hx, hy, hz], [hx, hy, -hz], [-hx, hy, -hz]]],
    [[0, -1, 0], [[-hx, -hy, -hz], [hx, -hy, -hz], [hx, -hy, hz], [-hx, -hy, hz]]],
    [[0, 0, 1], [[-hx, -hy, hz], [hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz]]],
    [[0, 0, -1], [[hx, -hy, -hz], [-hx, -hy, -hz], [-hx, hy, -hz], [hx, hy, -hz]]],
  ];
  const pos = [], nor = [], tex = [], idx = [];
  for (const [n, corners] of faces) {
    const base = pos.length / 3;
    for (const c of corners) { pos.push(c[0] + cx, c[1] + cy, c[2] + cz); nor.push(...n); tex.push(...uv); }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const buffer = root.listBuffers()[0];
  const accessor = (array, type) => doc.createAccessor().setArray(array).setType(type).setBuffer(buffer);
  const prim = doc.createPrimitive()
    .setAttribute("POSITION", accessor(new Float32Array(pos), "VEC3"))
    .setAttribute("NORMAL", accessor(new Float32Array(nor), "VEC3"))
    .setAttribute("TEXCOORD_0", accessor(new Float32Array(tex), "VEC2"))
    .setIndices(accessor(new Uint16Array(idx), "SCALAR").setBuffer(buffer))
    .setMaterial(material);
  return doc.createMesh().addPrimitive(prim);
}
// Atlas cells are 8 by 8; (column, row from the top) gives the centre of a flat-ish patch.
const cell = (col, row) => [(col + 0.4) / 8, 1 - (row + 0.5) / 8];
const parts = [
  ["Rucksack", [0, -0.04, -0.5], [0.58, 0.66, 0.34], cell(6, 0)],
  ["Rucksack_Lid", [0, 0.34, -0.5], [0.62, 0.14, 0.38], cell(1, 0)],
  ["Bedroll", [0, 0.5, -0.5], [0.66, 0.18, 0.2], cell(5, 1)],
];
for (const [name, c, s, uv] of parts) {
  chest.addChild(doc.createNode(name).setMesh(box(c, s, uv)));
}

await doc.transform(dedup(), prune(), quantize());
await io.write(out, doc);
