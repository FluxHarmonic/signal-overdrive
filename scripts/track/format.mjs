// Offline authoring data only. Runtime modules continue to use generated samples.
import fs from "node:fs";

const fail = message => { throw new Error(`track format: ${message}`); };
const finite = value => typeof value === "number" && Number.isFinite(value);
const keysOnly = (value, allowed, name) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`invalid ${name}`);
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(`unknown ${name} field ${key}`);
};

export function validateTrack(t) {
  if (!t || typeof t !== "object" || Array.isArray(t)) fail("expected an object");
  const fields = ["version", "id", "title", "district", "role", "geometry", "zones", "iceLayers", "song", "sections", "musicZones", "decoration"];
  for (const key of Object.keys(t)) if (!fields.includes(key)) fail(`unknown field ${key}`);
  if (t.version !== 1) fail("expected version 1");
  if (typeof t.id !== "string" || !/^[a-z][a-z0-9-]*$/.test(t.id)) fail("invalid id");
  for (const key of ["title", "district"]) {
    if (typeof t[key] !== "string" || !t[key].length) fail(`missing ${key}`);
  }
  if (!["race", "test"].includes(t.role)) fail("role must be race or test");
  const g = t.geometry;
  if (!g || !finite(g.halfWidth) || g.halfWidth < 78 || g.halfWidth > 92) fail("constant halfWidth must be 78..92; short squeezes need a format extension");
  if (g.type === "catmull-rom") {
    keysOnly(g, ["type", "halfWidth", "control"], "geometry");
    if (!Array.isArray(g.control) || g.control.length < 4 || g.control.length > 256) fail("need 4..256 control points");
    for (const p of g.control) {
      if (!Array.isArray(p) || p.length !== 2 || !p.every(finite)) fail("invalid control point");
    }
    for (let i = 0; i < g.control.length; i++) {
      const a = g.control[i], b = g.control[(i + 1) % g.control.length];
      if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 1) fail("duplicate adjacent control points");
    }
  } else if (g.type === "stadium") {
    keysOnly(g, ["type", "halfWidth", "center", "straight", "radius", "points"], "geometry");
    if (!Array.isArray(g.center) || g.center.length !== 2 || !g.center.every(finite)
      || !finite(g.straight) || g.straight <= 0 || !finite(g.radius) || g.radius <= 0
      || !Number.isInteger(g.points) || g.points < 4 || g.points > 256) fail("invalid stadium");
  } else fail("unknown geometry type");

  function interval(z, boost = false) {
    if (!Array.isArray(z) || z.length !== (boost ? 3 : 4) || !z.every(finite)) fail("invalid zone");
    const [from, to] = boost ? [z[0], z[0]] : z;
    const [left, right] = z.slice(-2);
    if (from < 0 || to > 1 || (boost ? from >= 1 : from >= to)
      || left < -1 || right > 1 || left >= right) fail("zone outside normalized bounds");
  }
  if (!t.zones || !Array.isArray(t.zones.boost) || !Array.isArray(t.zones.ice)) fail("missing zones");
  keysOnly(t.zones, ["boost", "repair", "ice"], "zones");
  t.zones.boost.forEach(z => interval(z, true));
  interval(t.zones.repair);
  t.zones.ice.forEach(z => interval(z));
  if (!Array.isArray(t.iceLayers)) fail("missing iceLayers");
  function uniqueIds(entries, name) {
    const ids = entries.map(e => e.id);
    if (ids.some(id => typeof id !== "string" || !/^[a-z][a-z0-9-]*$/.test(id))
      || new Set(ids).size !== ids.length) fail(`invalid or duplicate ${name} ids`);
  }
  uniqueIds(t.iceLayers, "layer");
  let product = 1;
  for (const layer of t.iceLayers) {
    keysOnly(layer, ["id", "layouts"], "ICE layer");
    if (!layer.id || !Array.isArray(layer.layouts) || !layer.layouts.length) fail("empty ICE layer");
    uniqueIds(layer.layouts, "layout");
    product *= layer.layouts.length;
    if (product > 4096) fail("ICE layout product exceeds 4096");
    for (const layout of layer.layouts) {
      keysOnly(layout, ["id", "zones"], "ICE layout");
      if (!layout.id || !Array.isArray(layout.zones)) fail("invalid ICE layout");
      layout.zones.forEach(z => interval(z));
    }
  }
  if (!t.song || !t.song.id || !t.song.cues || !finite(t.song.bpm) || t.song.bpm <= 0
    || !Array.isArray(t.song.sections)) fail("missing song contract");
  if (typeof t.song.cues !== "string" || !/^music\/[a-z0-9-]+\/cues\.sgl$/.test(t.song.cues)) fail("cue sheet must be a repository-local music/<id>/cues.sgl path");
  const expected = [
    { mark: "lap1", lap: 1, at: 0 }, { mark: "lap2", lap: 2, at: 0 },
    { mark: "hold", lap: 2, at: 0.5 },
    { mark: "fill", targetLap: 3, targetAt: 0, leadBars: 2 },
    { mark: "traced", lap: 3, at: 0 }, { mark: "uplink", lap: 4, at: 0 },
  ];
  if (t.song.sections.length !== expected.length) fail("song needs all six race section targets");
  expected.forEach((entry, i) => {
    const actual = t.song.sections[i];
    if (!actual || Object.keys(actual).length !== Object.keys(entry).length
      || Object.entries(entry).some(([key, value]) => actual[key] !== value)) {
      fail(`section ${entry.mark} disagrees with the v1 conductor contract`);
    }
  });
  if (!Array.isArray(t.sections) || !Array.isArray(t.musicZones)) fail("missing section/zone annotations");
  uniqueIds(t.sections, "section");
  uniqueIds(t.musicZones, "music zone");
  for (const section of t.sections) {
    if (!section.id || !section.label) fail("invalid section annotation");
    interval([section.from, section.to, -1, 1]);
  }
  for (const zone of t.musicZones) {
    if (!zone.id || !["drop", "searchlights", "firewall"].includes(zone.kind)
      || !Array.isArray(zone.sections)) fail("invalid music zone");
    if (!zone.sections.length || zone.sections.some(mark => !expected.some(e => e.mark === mark))) fail("unknown music zone section");
    interval([zone.from, zone.to, -1, 1]);
  }
  if (!t.decoration || !Number.isInteger(t.decoration.puddles)
    || t.decoration.puddles < 0 || t.decoration.puddles > 1000) fail("invalid puddle count");
  return t;
}

export function loadTrack(file) {
  return validateTrack(JSON.parse(fs.readFileSync(file, "utf8")));
}
