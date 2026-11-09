BrowserQuest
============

BrowserQuest is an HTML5/JavaScript multiplayer game experiment.

This fork has been modernized to run on current Node.js and browsers and adds a
set of gameplay systems on top of the original game (see **Features** below).


Running locally (modern Node.js)
--------------------------------

BrowserQuest was originally written in 2012 for Node.js 0.4. It now runs on
current Node.js (tested with Node.js 25) and current browsers. The ancient
`websocket-server` package has been replaced by `ws`.

Requirements: Node.js 18 or newer and npm.

1) Install dependencies:

        npm install

2) Start the game server. It serves the game client, the WebSocket game
   endpoint, the map editor, and the /status endpoint all on port 8000.
   `prestart` regenerates the data-driven content (equipment + NPCs) first:

        npm start

3) Open the game in your browser:

        http://localhost:8000/

The client must be served over HTTP (not opened via `file://`) because it loads
sprites and configuration with XHR. The server serves `client/` at `/` and maps
`/shared/*` to the repository's `shared/` directory, which the client imports at
runtime.

Useful endpoints:

- `/`            game client
- `/status`      per-world player counts (JSON)
- `/editor`      in-app GUI map editor (developer tool; see below)

Fallback: to run a separate static file server instead, start `npm run client`
in a second terminal and open `http://localhost:8080/client/index.html`.

Optional configuration:

- Server settings: copy `server/config_local.json-dist` to
  `server/config_local.json` and edit it (e.g. `editor_enabled`, port, worlds).
- Client WebSocket host/port: edit `client/config/config_local.json`
  (development) or `client/config/config_build.json` (production build).


Features
--------

Gameplay systems implemented in this fork (in addition to the original game):

- **Inventory & equipment (split)**: a unique *equipment* list (one entry per
  gear kind, equippable) plus a stackable *inventory* (consumables, shop items,
  and duplicate gear that can be sold). The inventory/equipment panel is split
  accordingly.
- **Gold & economy**: a persisted gold balance, earned by selling items at shops.
- **Shop system**: the Village Girl (any NPC with a `shop` event) sells/buys
  items. Talking cycles the NPC's dialogue; a clickable "Trade" option bubble
  opens the Shop HUD (Buy + Sell).
- **Usable warp item — [★ Initial Town]**: a single-use scroll that teleports
  the player to the initial town (buyable at the shop).
- **Health & regeneration**: numeric HP readout; health regenerates only when out
  of combat (no aggro) and idle for >2s.
- **Mobs & combat**: mob HP bars, a targeted-mob HP bar, integer-rounded damage,
  and mobs heal to full when their last attacker leaves (return-to-spawn).
- **XP / levels / stats**: XP from kills (co-op split favours lower levels),
  level-ups, an XP bar/HUD, and an allocatable-stat Character panel (Vigor →
  max HP, Strength → attack power).
- **Data-driven NPCs**: NPCs (names, dialogue, positions, shop events) are
  configured in `shared/data/npcs.json`.
- **Coordinates HUD**: current grid position shown top-right.
- **Minimap**: top-right minimap with zoom / whole-overworld / hidden modes, and
  colored entity dots (blue = you, green = other players/NPCs, red = mobs).


Map editor (`/editor`)
----------------------

A browser-based GUI map editor served by the game server at
`http://localhost:8000/editor` (enable via `editor_enabled: true` in the server
config; disable for production/shared deployments).

- Paint/erase terrain tiles (layer-aware) and edit collision/blocking/plateau.
- Place regions & triggers: music/cave areas, checkpoints, roaming mob areas,
  chest areas, and doors/portals.
- Place static mobs/items and add/drag NPCs (written to `shared/data/npcs.json`
  on **Apply NPCs**).
- Sprite palette with thumbnails; filter tiles by id or name; import sprites and
  new terrain tiles (appended to the tilesheets).
- Save writes the client map JSON (+ regenerated `world_client.js`) and the
  server map JSON ("server restart required").

See `editor/README.md` for details and the editor API.


Data-driven content & tools
---------------------------

Two data files (with JSON schemas) drive content, plus the map editor for maps:

- **Equipment**: `shared/data/equipment.json` (+ `.schema.json`). After editing,
  run `npm run equipment:build` (also runs on `npm start`). See
  `tools/equipment/README.md`.
- **NPCs**: `shared/data/npcs.json` (+ `.schema.json`). After editing, run
  `npm run npcs:build` (also runs on `npm start`). See `tools/npcs/README.md`.
- **Maps / sprites / tiles / regions**: use the in-app editor (`/editor`); the
  legacy Tiled exporter in `tools/maps/` remains for reference only.

See `tools/README.md` for the full tool index. A running log of tasks and tests
is kept in `update_log.md`.


License
-------

Code is licensed under MPL 2.0. Content is licensed under CC-BY-SA 3.0.
See the LICENSE file for details.


Credits
-------
Created by [Little Workshop](http://www.littleworkshop.fr):

* Franck Lecollinet - [@whatthefranck](http://twitter.com/whatthefranck)
* Guillaume Lecollinet - [@glecollinet](http://twitter.com/glecollinet)
