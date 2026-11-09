Tools
=====

Command-line helpers used to build/generate game assets and data. Most tools are
run from the project root.

| Tool | Purpose | Status |
|------|---------|--------|
| [`equipment/build.js`](#equipment-build-tool) | Validate equipment data and generate derived client/server files | Current (Node.js) |
| [`npcs/build.js`](#npc-build-tool) | Validate NPC data and generate inline browser data | Current (Node.js) |
| [`maps/`](#map-exporter) | Convert a Tiled `.tmx` map into the client/server map JSON | Legacy (Python 2 + old Node) |

The equipment and NPC tools are the only ones required for normal development;
the map exporter is only needed if you change the world map.

> **Map editing:** there is now an in-app **GUI map editor** at
> `http://localhost:8000/editor` (enable with `editor_enabled: true` in the server
> config). It edits the map/NPC JSON and assets directly in the browser and is
> the recommended way to retile the map or place triggers/entities. See
> `editor/README.md`. The legacy Tiled exporter below remains available.

---

NPC build tool
--------------

**Location:** `tools/npcs/build.js`
**Source of truth:** `shared/data/npcs.json`
**Docs:** `tools/npcs/README.md`

Validates the NPC data (id/name/kind/coords/conversations/events) and generates
`shared/js/npcs-data.js` (inline data for the browser client). NPCs are spawned
server-side from this data (not from the map), and the client matches them by
grid position for their displayed name and dialogue.

```bash
npm run npcs:build     # or `npm start`, which runs it via `prestart`
```

On any error the build prints the problems and writes nothing. On success:

```
NPC build OK: N NPC(s).
```

---

Equipment build tool
--------------------

**Location:** `tools/equipment/build.js`
**Source of truth:** `shared/data/equipment.json`
**Docs:** `tools/equipment/README.md` (full editor guide)

Validates the equipment JSON and regenerates the derived files:

- `shared/js/equipment-data.js` — inline data loaded by the browser client.
- `client/js/items.generated.js` — client item classes + `EntityFactory` builder
  metadata.
- `client/js/sprites.generated.js` — sprite manifest built from
  `client/sprites/*.json`.

### Usage

```bash
npm run equipment:build
```

`npm start` runs it automatically first via the `prestart` hook, so a forgotten
build cannot leave stale data on the server. You can also run it directly:

```bash
node tools/equipment/build.js
```

### What it validates

- `types` object present and well formed; every declared category has a matching
  `<category>s` array.
- Each item has a numeric `id`, a unique `name`, and a numeric `rank`.
- `type` (if present) matches the array it lives in.
- No duplicate `id` or `name`; duplicates of `rank` are warnings.
- Referenced sprite files exist in `client/sprites/` (`sprite` and `itemSprite`).
- Armors without `maxHp` produce a warning.

On any **error** the build prints the problems and exits non-zero **without
writing** any file. On success it prints:

```
Equipment build OK: N items across M type(s).
```

### When to run it

Any time you edit `shared/data/equipment.json` or add a sprite JSON file. See
`tools/equipment/README.md` for the JSON schema, how to add weapons/armors or new
equipment categories, ID ranges, sprite requirements, and validation details.

---

Map exporter
------------

**Location:** `tools/maps/`
**Docs:** `tools/maps/README.md`

Converts the Tiled map (`tools/maps/tmx/map.tmx`) into the JSON maps used by the
game:

- `client/maps/world_client.json` and `world_client.js`
  (the client loads one or the other depending on whether web workers are used).
- `server/maps/world_server.json`.

### Pipeline

1. `tmx2json.py` converts the `.tmx` file to a temporary JSON file.
2. `exportmap.js` runs the JSON through `processmap.js` (mode `client` or
   `server`).
3. The processed object is written to the appropriate map path(s).
4. The temporary file is deleted.

`export.py` orchestrates all of the above for a given mode.

### Usage

```bash
cd tools/maps
./export.py client     # writes client/maps/world_client.{json,js}
./export.py server     # writes server/maps/world_server.json
```

Run both to fully re-export. Restart the server after changing
`world_server.json`.

### Requirements and caveats (legacy)

This tool predates modern tooling and is **not maintained**:

- It is written for **Python 2** (`export.py` uses `import commands` and
  `print` statements; `tmx2json.py` uses `el.getchildren()` and `print`).
  Running it on Python 3 requires porting.
- It needs `lxml` (`pip install lxml`).
- `exportmap.js` uses `path.exists()` and `util.puts()`, which were **removed**
  from modern Node.js. To run it on current Node you must replace `path.exists`
  with `fs.existsSync` and `util.puts` with `console.log`.
- `export.py` and `tmx2json.py` assume a Unix-like shell (`rm`, executable
  scripts, optional `growlnotify` on macOS).
- There must be an empty layer at the bottom of the Tiled layer stack or the
  first terrain layer is dropped (known bug).
- Exporting a large map (the shipped `map.tmx` is ~64 MB) can take several
  minutes.

If you only need to change gameplay/data (equipment, mobs, items), you do **not**
need these tools.

---

Other scripts
-------------

- `regen-suite.js` (project root, not under `tools/`) — a small Node harness that
  exercises the passive-regeneration logic against real `Player` objects. Run
  with `node regen-suite.js`. See `update_log.md` for the recorded results.

---

Adding a new tool
-----------------

Place tools in their own subdirectory under `tools/<name>/`, keep them
self-contained, and document usage in a `README.md` next to the tool (and add a
row to the table at the top of this file). Prefer Node.js over Python for new
tools to stay compatible with the current runtime, and wire repeatable build
steps into `package.json` scripts (and `prestart` when the server depends on
their output).
