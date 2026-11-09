BrowserQuest Map Editor
=======================

An in-app, browser-based map editor served by the game server at:

    http://localhost:8000/editor

It is a developer tool. It is only enabled when the server config flag
`editor_enabled` is `true` (see `server/config.json` / `server/config_local.json`).
Disable it for production / shared deployments.

Why in-app (same server/port)?
------------------------------
- Reuses the existing HTTP server + static file serving (no second process/port).
- Same-origin, so the editor can read the map JSON and tileset and POST saves
  back without any CORS setup.
- "Immediate integration": saving writes the game's map files in place, so the
  client picks up changes on reload (client map) and the server on restart
  (server map).

How it works
------------
- On load, the editor fetches `GET /editor/api/load`, which returns the current
  `client/maps/world_client.json`, `server/maps/world_server.json` and
  `shared/data/npcs.json` from disk.
- It renders tiles using the scale-2 tilesheet (`/img/2/tilesheet.png`), matching
  the game's tile-id math.
- **Save** POSTs to `/editor/api/save`; the server validates the payload and
  writes the files, regenerating `client/maps/world_client.js` (the web-worker
  copy) so both stay in sync. Server-map saves report "server restart required".

Editor API (all POST, JSON body; loopback/`editor_enabled` only)
----------------------------------------------------------------
- `POST /editor/api/save` — body `{ clientMap, serverMap, files?: [{path, data}] }`.
  Writes the client map JSON + JS, the server map JSON, and any allowed data
  files (e.g. `shared/data/npcs.json`). Paths are restricted to:
  `client/maps`, `server/maps`, `shared/data`, `client/sprites`, `client/img`.
- `POST /editor/api/asset` — body `{ path, base64 }`; writes a binary asset
  (e.g. a sprite PNG) to an allowed path.
- `GET /editor/api/load` — returns current `clientMap`, `serverMap`, `npcs`.
- `GET /editor/api/sprites` — returns every `client/sprites/*.json` with its
  `{id,width,height,animations}` and which scale PNGs exist
  (`scales: {1:bool,2:bool,3:bool}`). Powers the editor's sprite palette.
- `POST /editor/api/import-sprite` — body
  `{ id, width, height, animations, offset_x, offset_y, pngs: {"1","2","3"} }`
  (base64 PNGs). Writes `client/sprites/<id>.json` (forcing `id === filename`),
  the provided `client/img/<scale>/<id>.png` files, and regenerates
  `client/js/sprites.generated.js` so the game picks it up without a manual build.
- `POST /editor/api/import-tile` — body
  `{ id, name, sheets: {"1","2","3"} }` (base64 PNGs of the *full* tilesheet per
  scale, already composited by the browser). Writes the three
  `client/img/<scale>/tilesheet.png` and registers `name` for `id` in
  `client/maps/tiles.json`.
- `GET /editor/api/load` also returns `tiles` (the `client/maps/tiles.json`
  name registry).

Current features (Phase 0–4)
----------------------------
- Pan (middle/right drag), zoom (mouse wheel, toward cursor).
- Tile palette picker from the real tilesheet.
- Tools: paint tile, erase tile (per layer), toggle collision, blocking, plateau.
- **Layer-aware painting**: each map cell may hold stacked tiles; pick the
  target layer (Base 0 / Decor 1 / Decor 2). Base terrain vs decoration overlays
  are supported, so both open-world and detailed region/interior design work.
- Collision edits are mirrored into the server map (identical flat indices).
- **Regions & triggers (drag a rectangle):** music areas (incl. cave rooms),
  checkpoints (with "starting area" flag → server `s`), roaming mob areas
  (type + count), chest areas (item list).
- **Points (click):** doors/portals (target + orientation + portal flag),
  static chests (item list), static mobs/items (kind). Doors are written to both
  the client and server maps.
- **Select / move:** pick any NPC, region, door, chest or static entity to edit
  its fields in the Inspector, then Delete if needed. Points (entities) take
  priority over enclosing regions when both are under the cursor.
- **Sprite palette (entities/items):** a grid of every `client/sprites/*.json`
  with a frame-0 thumbnail (from `img/<scale>/<id>.png`), showing "no PNG" if a
  scale is missing. Click a sprite to use it as the `kind` for static entities or
  NPCs (the Inspector's Kind is a sprite dropdown with a free-text override). A
  name filter narrows the grid.
- **Tile filter:** filter the tile palette by **id** (`120`, `100-150`,
  `5,9,200-205`) **or by name** (any non-numeric text searches the tile-name
  registry `client/maps/tiles.json`). Non-matching tiles are hidden (blacked out).
  A **"Only tiles used in map"** toggle further narrows by usage.
- **Terrain tile import:** the "Import sprite…" dialog's **"This is a terrain
  tile"** toggle now composites the uploaded art into all three tilesheet PNGs
  (`client/img/{1,2,3}/tilesheet.png`) **appended at the end**, so existing tile
  ids are unchanged. The new id is `max(map data ids, animated frame spans) + 1`
  — animated tiles occupy a contiguous run of frame ids (`animated[id].l`), e.g.
  the wave animation 1921–1935, so the importer skips past them (a new sheet row
  is added only if capacity is exceeded). It writes the sheets, registers the
  name in `client/maps/tiles.json`, and the new tile appears in the Tiles tab and
  is searchable by name. (Compositing is done in-browser via canvas.)
- **NPC editing:** preview existing NPCs (magenta dots); add/drag/delete NPCs.
  Changes are written to `shared/data/npcs.json` only when you press **Apply
  NPCs** (so map/NPC edits are applied explicitly). Run `npm run npcs:build` (or
  restart) afterwards to regenerate `shared/js/npcs-data.js`.
- **Import sprite:** the "Import sprite…" dialog takes the sprite id, frame
  width/height, idle animation, and **any of the scale 1/2/3 PNGs** (missing
  scales are auto-generated by down/upscaling the closest provided one, keeping
  the frame grid). It writes the JSON (with `id === filename`), the PNGs, and
  regenerates `sprites.generated.js`. An optional "this is a terrain tile"
  toggle just notes intent (importing brand-new *terrain* tiles into the
  tilesheet + renumbering is not yet supported; use existing tile kinds via the
  painter).
- Save writes the client map JSON, regenerates `world_client.js`, and writes the
  server map JSON (shows "server restart required").

Inspector overlays
------------------
- Green outline = music area; orange = cave music area.
- Blue = checkpoint; purple = roaming area; yellow = chest area / static chest.
- Cyan dot = door; red dot = static entity; magenta dot = NPC.

Roadmap (remaining)
-------------------
- Optional ergonomics: undo/redo, snapping, tile flood-fill, layer list UI.
- True "new terrain tile" import (grow a tilesheet + renumber) — currently the
  painter retiles using existing tile kinds; sprite import covers entities.

Asset reference (for creating test sprites / importing)
--------------------------------------------------------
Sprites live in **two files**: `client/sprites/<name>.json` (animation metadata
incl. `width`/`height`) and `client/img/{1,2,3}/<name>.png` (the pixel art, one
PNG per scale). `client/js/sprites.generated.js` is generated from
`client/sprites/*.json`. To import, upload a PNG to e.g. `client/img/2/foo.png`
and a matching `client/sprites/foo.json` (same `id`, `width`, `height`,
`animations`). The engine maps `id` → `img/<scale>/<id>.png`.

**Terrain tilesheets** (`client/img/<scale>/tilesheet.png`) — 16px logical tiles,
PNG is scaled by `<scale>`:

| Scale | File | Pixel size | Tile px |
|-------|------|-----------|---------|
| 1 | `client/img/1/tilesheet.png` | 320 x 1568 | 16 |
| 2 | `client/img/2/tilesheet.png` | 640 x 3136 | 32 |
| 3 | `client/img/3/tilesheet.png` | 960 x 4704 | 48 |

Columns per sheet = width / (16 * scale): scale-1 = 20 cols, scale-2 = 20 cols,
scale-3 = 20 cols.

**Entity / item sprites** (dimensions are the logical `width`/`height` in the
sprite JSON; the PNG is `width*scale` x `height*scale`):

| Size (logical) | Sprites |
|----------------|---------|
| 14x14 | arrow, hand, loot, sword, talk |
| 16x16 | chest, impact, shadow16, sparks, target, and all `item-*` icons (item-flask, item-cake, item-sword1, item-teleportscroll, ...) |
| 24x24 | agent, beachnpc, coder, death, desertnpc, forestnpc, lavanpc, priest, scientist, villagegirl, villager, item-cake |
| 25x24 | guard |
| 26x26 | goblin, sorcerer, wizard |
| 28x28 | snake |
| 32x32 | clotharmor, crab, firefox, goldenarmor, king, leatherarmor, mailarmor, octocat, platearmor, redarmor, rick, sword1 |
| 32x48 | bat |
| 34x34 | spectre |
| 38x38 | morningstar |
| 40x48 | eye |
| 42x42 | deathknight |
| 48x48 | axe, bluesword, goldensword, ogre, rat, redsword, skeleton, skeleton2, sword2 |
| 49x24 | nyan |
| 64x72 | boss |

For a quick Phase-4 test, the simplest is an existing 16x16 icon style: create a
`client/sprites/mytile.json` with `id: "mytile"`, `width: 16`, `height: 16`,
`animations: { idle: { length: 1, row: 0 } }`, and a 32x32 PNG at
`client/img/2/mytile.png` (16x16 at scale 2). Larger character sprites use the
multi-frame animation rows shown in existing JSON files.



Notes
-----
- The client and server map files are separate but both edited here so they stay
  consistent (the TMX exporter in `tools/maps/` remains available but is no longer
  required for incremental edits).
- Editing tiles over an existing map = changing tile ids in `data[]` (the engine
  is id-based), so "switch tiles to another kind" is fully supported.
