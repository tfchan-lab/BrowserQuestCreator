/*
 * BrowserQuest in-app Map Editor.
 *
 * Phases implemented:
 *   0-1  view, tile painter (layer-aware), collision/blocking/plateau, save
 *   2    regions & triggers: music areas (incl. cave), checkpoints, roaming
 *        mob areas, chest areas, doors/portals
 *   3    NPC & mob placement: preview + drag NPCs (writes shared/data/npcs.json
 *        on "Apply NPCs"), place static mobs / items
 *   4    asset import: upload sprite PNG / sprite JSON to the repo
 *
 * Coordinate model: world tiles are 16px logical; the editor renders at SCALE
 * (2) using the scale-2 tilesheet, so one tile = 32 source px * zoom.
 */

(function() {
    'use strict';

    var SCALE = 2;
    var TILE = 16;
    var TILE_PX = TILE * SCALE;

    var state = {
        clientMap: null,
        serverMap: null,
        npcs: null,             // shared/data/npcs.json (editable, applied on demand)
        sprites: [],            // client/sprites/*.json metadata (+scale availability)
        tiles: {},              // client/maps/tiles.json name registry {id: name}
        tileset: null,
        cols: 0,
        selectedTile: 0,
        selectedSprite: null,   // sprite id chosen in the sprite palette
        zoom: 1,
        camX: 0, camY: 0,
        dragging: false,
        painting: false,
        dragStart: null,
        rectStart: null,        // for rectangle tools
        hover: null,
        selected: null,         // selected region/entity for the inspector
        dirty: { npcs: false }
    };

    // Pending placement defaults for the point/region tools (edited in inspector).
    var opts = {
        musicArea: { id: 'cave' },
        checkpoint: { start: false },
        roamingArea: { type: 'rat', nb: 3 },
        chestArea: { items: 'sword1' },
        door: { to: 'd', portal: false, tx: 0, ty: 0 },
        staticChest: { items: 'sword1' },
        staticEntity: { kind: 'rat' },
        npc: { name: 'New NPC', kind: 'villager', conversations: 'Hello there' }
    };

    // Data helpers -----------------------------------------------------------
    function idxToXY(map, i) { return { x: i % map.width, y: Math.floor(i / map.width) }; }
    function xyToIdx(map, x, y) { return y * map.width + x; }
    function inList(arr, i) { return arr && arr.indexOf(i) !== -1; }

    function tileSrc(id) {
        var gx = (id === 0) ? 0 : ((id % state.cols === 0) ? state.cols - 1 : (id % state.cols) - 1);
        var gy = Math.floor(id / state.cols);
        return { sx: gx * TILE_PX, sy: gy * TILE_PX };
    }

    var mapCanvas, mapCtx, paletteCanvas, paletteCtx;
    function $(id) { return document.getElementById(id); }
    function setStatus(msg) { $('status').textContent = msg || ''; $('status').title = msg || ''; }

    // Load -------------------------------------------------------------------
    function loadImage(src) {
        return new Promise(function(res, rej) {
            var img = new Image();
            img.onload = function() { res(img); };
            img.onerror = function() { rej(new Error('Failed to load ' + src)); };
            img.src = src;
        });
    }
    function loadJSON(url) {
        return fetch(url, { cache: 'no-store' }).then(function(r) {
            if(!r.ok) { throw new Error('HTTP ' + r.status + ' for ' + url); }
            return r.json();
        });
    }

    function init() {
        mapCanvas = $('map');
        mapCtx = mapCanvas.getContext('2d');
        paletteCanvas = $('palette');
        paletteCtx = paletteCanvas.getContext('2d');
        setStatus('Loading...');

        Promise.all([ loadJSON('/editor/api/load'), loadImage('/img/2/tilesheet.png'),
                      loadJSON('/editor/api/sprites') ])
            .then(function(res) {
                var data = res[0];
                if(!data || !data.clientMap || !data.serverMap) {
                    throw new Error('Editor API returned no map data.');
                }
                state.clientMap = data.clientMap;
                state.serverMap = data.serverMap;
                state.npcs = data.npcs || { version: 1, npcs: [] };
                if(!state.npcs.npcs) { state.npcs.npcs = []; }
                state.tileset = res[1];
                state.cols = (state.tileset.width / TILE) / SCALE;
                state.sprites = (res[2] && res[2].sprites) || [];
                state.tiles = (data.tiles) || {};
                setStatus('');
                buildPalette();
                buildSpritePalette();
                resizeMapCanvas();
                renderMap();
                bindEvents();
                buildInspector();
            }).catch(function(e) {
                setStatus('Error: ' + e.message);
                console.error(e);
            });
    }

    // Palette ----------------------------------------------------------------
    function buildPalette() {
        var cell = TILE_PX;
        var cols = state.cols;
        var rows = Math.ceil(state.tileset.height / TILE_PX);
        paletteCanvas.width = cols * cell;
        paletteCanvas.height = rows * cell;
        paletteCtx.fillStyle = '#111';
        paletteCtx.fillRect(0, 0, paletteCanvas.width, paletteCanvas.height);
        paletteCtx.imageSmoothingEnabled = false;
        paletteCtx.drawImage(state.tileset, 0, 0);
        paletteCtx.strokeStyle = 'rgba(255,255,255,0.12)';
        for(var x = 0; x <= cols; x++) { paletteCtx.beginPath(); paletteCtx.moveTo(x*cell,0); paletteCtx.lineTo(x*cell,paletteCanvas.height); paletteCtx.stroke(); }
        for(var y = 0; y <= rows; y++) { paletteCtx.beginPath(); paletteCtx.moveTo(0,y*cell); paletteCtx.lineTo(paletteCanvas.width,y*cell); paletteCtx.stroke(); }

        // Filter overlay: dim non-matching tiles (tile-id range / used-only).
        applyTileFilterOverlay();
        highlightPaletteSelection();
    }

    // --- Tile filter --------------------------------------------------------
    function usedTileIds() {
        var used = {};
        var data = state.clientMap ? state.clientMap.data : [];
        for(var i = 0; i < data.length; i++) {
            var cell = data[i];
            if(Array.isArray(cell)) { for(var j = 0; j < cell.length; j++) { if(cell[j]) { used[cell[j]] = 1; } } }
            else if(cell) { used[cell] = 1; }
        }
        return used;
    }

    function parseIdFilter(str) {
        // Supports "120", "100-150", "5,9,200-205". Returns a predicate or null.
        str = (str || '').trim();
        if(!str) { return null; }
        var parts = str.split(',').map(function(s){ return s.trim(); }).filter(Boolean);
        var ranges = [];
        for(var i = 0; i < parts.length; i++) {
            var m = parts[i].match(/^(\d+)\s*-\s*(\d+)$/);
            if(m) { ranges.push([parseInt(m[1],10), parseInt(m[2],10)]); }
            else if(/^\d+$/.test(parts[i])) { var n = parseInt(parts[i],10); ranges.push([n, n]); }
            else { return function(){ return false; }; }
        }
        return function(id) {
            for(var r = 0; r < ranges.length; r++) { if(id >= ranges[r][0] && id <= ranges[r][1]) { return true; } }
            return false;
        };
    }

    function applyTileFilterOverlay() {
        var raw = ($('tile-filter') ? $('tile-filter').value : '').trim();
        var usedOnly = $('tile-used-only') && $('tile-used-only').checked;
        if(!raw && !usedOnly) { return; }

        // A pure numeric expression ("120", "100-150", "5,9,200-205") filters by
        // id; anything else is treated as a case-insensitive NAME search over the
        // tile registry (client/maps/tiles.json).
        var pred = null, nameStr = null;
        if(raw && /^[\d,\s-]+$/.test(raw)) { pred = parseIdFilter(raw); }
        else if(raw) { nameStr = raw.toLowerCase(); }

        var used = usedOnly ? usedTileIds() : null;
        var cols = state.cols, cell = TILE_PX;
        var rows = Math.ceil(state.tileset.height / cell);
        // Opaque black to fully HIDE non-matching tiles (per request).
        paletteCtx.fillStyle = '#111';
        for(var gy = 0; gy < rows; gy++) {
            for(var gx = 0; gx < cols; gx++) {
                var id = gy * cols + gx + 1;
                var match = true;
                if(pred && !pred(id)) { match = false; }
                if(used && !used[id]) { match = false; }
                if(nameStr) {
                    var name = (state.tiles && state.tiles[String(id)]) ? String(state.tiles[String(id)]).toLowerCase() : '';
                    if(name.indexOf(nameStr) === -1) { match = false; }
                }
                if(!match) { paletteCtx.fillRect(gx*cell, gy*cell, cell, cell); }
            }
        }
    }

    // --- Palette tabs (Tiles / Sprites) ------------------------------------
    function switchPaletteTab(tab) {
        Array.prototype.forEach.call(document.querySelectorAll('#palette-tabs .ptab'), function(btn) {
            btn.classList.toggle('active', btn.getAttribute('data-tab') === tab);
        });
        var tiles = $('tab-tiles'), sprites = $('tab-sprites');
        if(tiles) { tiles.classList.toggle('active', tab === 'tiles'); }
        if(sprites) { sprites.classList.toggle('active', tab === 'sprites'); }
    }

    // --- Sprite palette -----------------------------------------------------
    function buildSpritePalette() {
        var container = $('sprite-palette');
        if(!container) { return; }
        var filter = ($('sprite-filter') ? $('sprite-filter').value : '').toLowerCase().trim();
        container.innerHTML = '';
        var shown = 0;
        state.sprites.forEach(function(sp) {
            if(filter && sp.id.toLowerCase().indexOf(filter) === -1) { return; }
            shown++;
            var hasPng = sp.scales && (sp.scales[2] || sp.scales[1] || sp.scales[3]);
            var cell = document.createElement('div');
            cell.className = 'sprite-cell' + (state.selectedSprite === sp.id ? ' selected' : '') + (hasPng ? '' : ' missing');
            cell.setAttribute('data-sprite', sp.id);
            cell.title = sp.id + ' (' + sp.width + 'x' + sp.height + ')';
            var thumb = document.createElement('div');
            thumb.className = 'thumb';
            if(hasPng) {
                var scale = sp.scales[2] ? 2 : (sp.scales[1] ? 1 : 3);
                var img = document.createElement('img');
                img.src = '/img/' + scale + '/' + sp.id + '.png';
                img.alt = sp.id;
                thumb.appendChild(img);
            }
            var name = document.createElement('div');
            name.className = 'sname';
            name.textContent = sp.id;
            cell.appendChild(thumb);
            cell.appendChild(name);
            cell.addEventListener('click', function() { selectSprite(sp.id); });
            container.appendChild(cell);
        });
        if(shown === 0) {
            container.innerHTML = '<div class="hint" style="grid-column:1/-1">No sprites match.</div>';
        }
    }

    function selectSprite(id) {
        state.selectedSprite = id;
        // Selecting a sprite is most useful for entity/NPC placement; switch tool
        // to staticEntity if currently on a tile tool.
        var tool = $('tool');
        if(tool.value === 'paint' || tool.value === 'erase' || tool.value === 'select') {
            tool.value = 'staticEntity';
        }
        if(tool.value === 'staticEntity') { opts.staticEntity.kind = id; }
        else if(tool.value === 'npc') { opts.npc.kind = id; }
        buildSpritePalette();
        buildInspector();
        renderMap();
    }
    function highlightPaletteSelection() {
        if(!state.selectedTile) { return; }
        var cols = state.cols;
        var gx = ((state.selectedTile % cols === 0) ? cols - 1 : (state.selectedTile % cols) - 1);
        var gy = Math.floor(state.selectedTile / cols);
        paletteCtx.strokeStyle = '#ffe14d';
        paletteCtx.lineWidth = 2;
        paletteCtx.strokeRect(gx*TILE_PX+1, gy*TILE_PX+1, TILE_PX-2, TILE_PX-2);
    }

    // Map render -------------------------------------------------------------
    function resizeMapCanvas() {
        var wrap = $('canvas-wrap');
        mapCanvas.width = wrap.clientWidth;
        mapCanvas.height = wrap.clientHeight;
    }
    function cellTiles(cell) { return Array.isArray(cell) ? cell : [cell]; }

    function renderMap() {
        var map = state.clientMap;
        var z = state.zoom;
        var vw = mapCanvas.width, vh = mapCanvas.height;
        mapCtx.fillStyle = '#000';
        mapCtx.fillRect(0, 0, vw, vh);
        mapCtx.imageSmoothingEnabled = false;

        var tileScreen = TILE_PX * z;
        var startX = Math.max(0, Math.floor(state.camX / TILE_PX));
        var startY = Math.max(0, Math.floor(state.camY / TILE_PX));
        var endX = Math.min(map.width, Math.ceil((state.camX + vw / z) / TILE_PX));
        var endY = Math.min(map.height, Math.ceil((state.camY + vh / z) / TILE_PX));

        for(var ty = startY; ty < endY; ty++) {
            for(var tx = startX; tx < endX; tx++) {
                var cell = map.data[xyToIdx(map, tx, ty)];
                var tiles = cellTiles(cell);
                var dx = (tx * TILE_PX - state.camX) * z;
                var dy = (ty * TILE_PX - state.camY) * z;
                for(var i = 0; i < tiles.length; i++) {
                    var id = tiles[i];
                    if(!id) { continue; }
                    var s = tileSrc(id);
                    mapCtx.drawImage(state.tileset, s.sx, s.sy, TILE_PX, TILE_PX, dx, dy, tileScreen, tileScreen);
                }
                if(isCollision(tx, ty)) {
                    mapCtx.fillStyle = 'rgba(255,0,0,0.28)';
                    mapCtx.fillRect(dx, dy, tileScreen, tileScreen);
                }
            }
        }

        drawOverlays();
        drawSelection();
        drawSelectionRect();
        drawHover();
    }

    function drawSelectionRect() {
        if(!state.selectionRect) { return; }
        var r = worldRect(state.selectionRect.x, state.selectionRect.y, state.selectionRect.w, state.selectionRect.h);
        mapCtx.fillStyle = 'rgba(255,255,255,0.15)';
        mapCtx.fillRect(r.x, r.y, r.w, r.h);
        strokeRect(r, '#ffffff');
    }

    function isCollision(x, y) { return inList(state.clientMap.collisions, xyToIdx(state.clientMap, x, y)); }

    function worldRect(x, y, w, h) {
        return {
            x: (x * TILE_PX - state.camX) * state.zoom,
            y: (y * TILE_PX - state.camY) * state.zoom,
            w: w * TILE_PX * state.zoom,
            h: h * TILE_PX * state.zoom
        };
    }

    function strokeRect(r, color) {
        mapCtx.strokeStyle = color;
        mapCtx.lineWidth = 1.5;
        mapCtx.strokeRect(r.x + 0.5, r.y + 0.5, r.w, r.h);
    }
    function fillDot(x, y, color, r) {
        var px = (x * TILE_PX - state.camX) * state.zoom + (TILE_PX * state.zoom) / 2;
        var py = (y * TILE_PX - state.camY) * state.zoom + (TILE_PX * state.zoom) / 2;
        mapCtx.beginPath();
        mapCtx.fillStyle = color;
        mapCtx.arc(px, py, r || 4, 0, Math.PI * 2, false);
        mapCtx.fill();
    }

    // --- Region/entity overlays --------------------------------------------
    function drawOverlays() {
        var cm = state.clientMap, sm = state.serverMap;

        // music areas (green); highlight cave
        (cm.musicAreas || []).forEach(function(a) {
            strokeRect(worldRect(a.x, a.y, a.w, a.h), (a.id === 'cave') ? '#f0a020' : '#2fa02f');
        });

        // checkpoints (blue)
        (cm.checkpoints || []).forEach(function(cp) {
            strokeRect(worldRect(cp.x, cp.y, cp.w, cp.h), '#3a7fff');
        });

        // roaming areas (purple, with dot count)
        (sm.roamingAreas || []).forEach(function(a) {
            strokeRect(worldRect(a.x, a.y, a.width, a.height), '#b04fff');
        });

        // chest areas (yellow)
        (sm.chestAreas || []).forEach(function(c) {
            strokeRect(worldRect(c.x, c.y, c.w, c.h), '#e0d020');
        });

        // static chests (yellow dot)
        (sm.staticChests || []).forEach(function(c) { fillDot(c.x, c.y, '#e0d020', 4); });

        // doors (cyan dots)
        (cm.doors || []).forEach(function(d) { fillDot(d.x, d.y, '#20d0d0', 4); });

        // static entities (red dots)
        Object.keys(sm.staticEntities || {}).forEach(function(k) {
            var i = parseInt(k, 10);
            var p = idxToXY(state.serverMap, i);
            fillDot(p.x, p.y, '#e33', 3);
        });

        // NPCs (magenta dots + label)
        (state.npcs.npcs || []).forEach(function(n) {
            fillDot(n.x, n.y, '#ff4dd0', 5);
        });
    }

    function drawSelection() {
        var s = state.selected;
        if(!s) { return; }
        mapCtx.save();
        if(s.kind === 'rect') {
            var r = worldRect(s.x, s.y, s.w, s.h);
            mapCtx.strokeStyle = '#fff';
            mapCtx.lineWidth = 2;
            mapCtx.setLineDash([4,3]);
            mapCtx.strokeRect(r.x, r.y, r.w, r.h);
            mapCtx.setLineDash([]);
        } else if(s.kind === 'point') {
            var px = (s.x * TILE_PX - state.camX) * state.zoom;
            var py = (s.y * TILE_PX - state.camY) * state.zoom;
            var sz = TILE_PX * state.zoom;
            mapCtx.strokeStyle = '#fff';
            mapCtx.lineWidth = 2;
            mapCtx.strokeRect(px, py, sz, sz);
        }
        mapCtx.restore();
    }

    function drawHover() {
        if(!state.hover) { return; }
        var r = worldRect(state.hover.x, state.hover.y, 1, 1);
        mapCtx.strokeStyle = 'rgba(255,255,255,0.5)';
        mapCtx.lineWidth = 1;
        mapCtx.strokeRect(r.x + 0.5, r.y + 0.5, r.w, r.h);
    }

    // Events -----------------------------------------------------------------
    function bindEvents() {
        paletteCanvas.addEventListener('click', function(e) {
            var r = paletteCanvas.getBoundingClientRect();
            var gx = Math.floor((e.clientX - r.left) / TILE_PX), gy = Math.floor((e.clientY - r.top) / TILE_PX);
            var id = gy * state.cols + gx + 1;
            var maxId = (state.tileset.width / TILE_PX) * (state.tileset.height / TILE_PX);
            if(id < 1 || id > maxId) { return; }
            state.selectedTile = id;
            buildPalette();
            var tname = state.tiles && state.tiles[String(id)];
            setStatus('Selected tile #' + id + (tname ? ' (' + tname + ')' : ''));
            var tool = $('tool');
            if(tool.value !== 'paint') { tool.value = 'paint'; buildInspector(); }
        });

        mapCanvas.addEventListener('wheel', function(e) {
            e.preventDefault();
            var oldZ = state.zoom;
            var newZ = Math.min(6, Math.max(0.35, oldZ * (e.deltaY < 0 ? 1.2 : 1/1.2)));
            var r = mapCanvas.getBoundingClientRect();
            var mx = e.clientX - r.left, my = e.clientY - r.top;
            var wx = state.camX + mx / oldZ, wy = state.camY + my / oldZ;
            state.zoom = newZ;
            state.camX = wx - mx / newZ;
            state.camY = wy - my / newZ;
            clampCam(); renderMap();
        }, { passive: false });

        mapCanvas.addEventListener('mousedown', function(e) {
            var tool = $('tool').value;
            if(e.button === 1 || e.button === 2) {
                state.dragging = true;
                state.dragStart = { x: e.clientX, y: e.clientY, camX: state.camX, camY: state.camY };
                e.preventDefault(); return;
            }
            if(e.button !== 0) { return; }
            var t = cursorToTile(e);
            if(tool === 'paint' || tool === 'erase' || tool === 'collision' || tool === 'blocking' || tool === 'plateau') {
                state.painting = true;
                applyTileTool(t);
                renderMap();
            } else if(isRectTool(tool)) {
                if(inBounds(t)) { state.rectStart = t; }
            } else if(isPointTool(tool)) {
                placePoint(tool, t);
            } else if(tool === 'select') {
                pickAt(t);
            }
        });

        window.addEventListener('mousemove', function(e) {
            if(state.dragging && state.dragStart) {
                var z = state.zoom;
                state.camX = state.dragStart.camX - (e.clientX - state.dragStart.x) / z;
                state.camY = state.dragStart.camY - (e.clientY - state.dragStart.y) / z;
                clampCam(); renderMap();
            } else if(state.painting) {
                var t = cursorToTile(e);
                if(inBounds(t)) { applyTileTool(t); renderMap(); }
            } else {
                var tool = $('tool').value;
                if(state.rectStart) {
                    var cur = cursorToTile(e);
                    state.hover = cur;
                    state.selectionRect = rectBetween(state.rectStart, cur);
                    renderMap();
                } else {
                    var h = cursorToTile(e);
                    state.hover = inBounds(h) ? h : null;
                    renderMap();
                }
            }
            updateInfo(e);
        });

        window.addEventListener('mouseup', function(e) {
            if(state.rectStart) {
                var cur = cursorToTile(e);
                var rect = rectBetween(state.rectStart, cur);
                commitRect($('tool').value, rect);
                state.rectStart = null;
                state.selectionRect = null;
                state.hover = null;
                renderMap();
            }
            state.dragging = false;
            state.dragStart = null;
            state.painting = false;
        });
        mapCanvas.addEventListener('contextmenu', function(e) { e.preventDefault(); });

        $('tool').addEventListener('change', function() { buildInspector(); renderMap(); });
        $('layer').addEventListener('change', function() {});
        $('save-btn').addEventListener('click', save);
        $('apply-npcs-btn').addEventListener('click', applyNpcs);

        // Tile filter
        if($('tile-filter')) { $('tile-filter').addEventListener('input', function() { buildPalette(); }); }
        if($('tile-used-only')) { $('tile-used-only').addEventListener('change', function() { buildPalette(); }); }
        // Sprite filter
        if($('sprite-filter')) { $('sprite-filter').addEventListener('input', function() { buildSpritePalette(); }); }

        // Palette tabs (Tiles / Sprites)
        Array.prototype.forEach.call(document.querySelectorAll('#palette-tabs .ptab'), function(btn) {
            btn.addEventListener('click', function() { switchPaletteTab(btn.getAttribute('data-tab')); });
        });

        // Import dialog
        $('import-btn').addEventListener('click', openImportDialog);
        $('imp-cancel').addEventListener('click', function() { $('import-dialog').style.display = 'none'; $('import-status').textContent=''; });
        $('imp-do').addEventListener('click', doImport);
        if($('imp-advanced')) {
            $('imp-advanced').addEventListener('change', function() {
                $('imp-json-row').style.display = this.checked ? 'flex' : 'none';
                if(this.checked) { refreshImportJsonPreview(); }
            });
        }
    }

    function isRectTool(t) { return t === 'musicArea' || t === 'checkpoint' || t === 'roamingArea' || t === 'chestArea'; }
    function isPointTool(t) { return t === 'door' || t === 'staticChest' || t === 'staticEntity' || t === 'npc'; }

    function clampCam() {
        var map = state.clientMap, z = state.zoom;
        var maxX = map.width * TILE_PX - mapCanvas.width / z;
        var maxY = map.height * TILE_PX - mapCanvas.height / z;
        state.camX = Math.max(0, Math.min(state.camX, Math.max(0, maxX)));
        state.camY = Math.max(0, Math.min(state.camY, Math.max(0, maxY)));
    }
    function cursorToTile(e) {
        var r = mapCanvas.getBoundingClientRect();
        var wx = state.camX + (e.clientX - r.left) / state.zoom;
        var wy = state.camY + (e.clientY - r.top) / state.zoom;
        return { x: Math.floor(wx / TILE_PX), y: Math.floor(wy / TILE_PX) };
    }
    function inBounds(t) { return t.x >= 0 && t.y >= 0 && t.x < state.clientMap.width && t.y < state.clientMap.height; }
    function rectBetween(a, b) {
        var x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
        var x2 = Math.max(a.x, b.x) + 1, y2 = Math.max(a.y, b.y) + 1;
        return { x: x, y: y, w: x2 - x, h: y2 - y };
    }

    function updateInfo(e) {
        if(!state.clientMap) { return; }
        var t = cursorToTile(e);
        var inb = inBounds(t);
        var cell = inb ? state.clientMap.data[xyToIdx(state.clientMap, t.x, t.y)] : '-';
        $('info').textContent = 'x: ' + t.x + ', y: ' + t.y + '  tile: ' +
            (Array.isArray(cell) ? '[' + cell.join(',') + ']' : cell);
    }

    // Tile tools -------------------------------------------------------------
    function applyTileTool(t) {
        var map = state.clientMap;
        var tool = $('tool').value;
        var layer = parseInt($('layer').value, 10) || 0;
        var i = xyToIdx(map, t.x, t.y);
        if(tool === 'paint') { paintTile(i, layer); }
        else if(tool === 'erase') { eraseTile(i, layer); }
        else if(tool === 'collision') { toggleList(map.collisions, i); toggleList(state.serverMap.collisions, i, true); }
        else if(tool === 'blocking') { toggleList(map.blocking, i); }
        else if(tool === 'plateau') { toggleList(map.plateau, i); }
    }

    function paintTile(i, layer) {
        var map = state.clientMap;
        var cell = map.data[i];
        var tiles = Array.isArray(cell) ? cell.slice() : [cell];
        while(tiles.length <= layer) { tiles.push(0); }
        tiles[layer] = state.selectedTile;
        while(tiles.length > 1 && tiles[tiles.length - 1] === 0) { tiles.pop(); }
        map.data[i] = (tiles.length === 1) ? tiles[0] : tiles;
    }
    function eraseTile(i, layer) {
        var map = state.clientMap;
        var cell = map.data[i];
        if(!Array.isArray(cell)) { if(layer === 0) { map.data[i] = 0; } return; }
        if(layer < cell.length) { cell[layer] = 0; }
        while(cell.length > 1 && cell[cell.length - 1] === 0) { cell.pop(); }
        map.data[i] = (cell.length === 1) ? cell[0] : cell;
    }
    function toggleList(arr, i, keepSorted) {
        if(!arr) { return; }
        var pos = arr.indexOf(i);
        if(pos === -1) { arr.push(i); if(keepSorted) { arr.sort(function(a,b){return a-b;}); } }
        else { arr.splice(pos, 1); }
    }

    // Region/point placement -------------------------------------------------
    function commitRect(tool, rect) {
        var cm = state.clientMap, sm = state.serverMap;
        var obj;
        if(tool === 'musicArea') {
            obj = { x: rect.x, y: rect.y, w: rect.w, h: rect.h, id: opts.musicArea.id || 'forest' };
            cm.musicAreas = cm.musicAreas || []; cm.musicAreas.push(obj);
            state.selected = { kind: 'rect', list: 'cm', field: 'musicAreas', ref: obj, x: obj.x, y: obj.y, w: obj.w, h: obj.h };
        } else if(tool === 'checkpoint') {
            // ids are 1-based sequential in this map
            var nextId = 1;
            (cm.checkpoints || []).forEach(function(c) { if(c.id >= nextId) { nextId = c.id + 1; } });
            obj = { id: nextId, x: rect.x, y: rect.y, w: rect.w, h: rect.h };
            cm.checkpoints = cm.checkpoints || []; cm.checkpoints.push(obj);
            var sobj = { id: obj.id, x: obj.x, y: obj.y, w: obj.w, h: obj.h, s: opts.checkpoint.start ? 1 : 0 };
            sm.checkpoints = sm.checkpoints || []; sm.checkpoints.push(sobj);
            state.selected = { kind: 'rect', list: 'cm', field: 'checkpoints', ref: obj, sref: sobj, x: obj.x, y: obj.y, w: obj.w, h: obj.h };
        } else if(tool === 'roamingArea') {
            var rid = 0; (sm.roamingAreas || []).forEach(function(a){ if(a.id >= rid) rid = a.id + 1; });
            obj = { id: rid, x: rect.x, y: rect.y, width: rect.w, height: rect.h, type: opts.roamingArea.type || 'rat', nb: opts.roamingArea.nb || 3 };
            sm.roamingAreas = sm.roamingAreas || []; sm.roamingAreas.push(obj);
            state.selected = { kind: 'rect', list: 'sm', field: 'roamingAreas', ref: obj, x: obj.x, y: obj.y, w: obj.w, h: obj.h };
        } else if(tool === 'chestArea') {
            obj = { x: rect.x, y: rect.y, w: rect.w, h: rect.h, i: kindsFromNames(opts.chestArea.items), tx: rect.x, ty: rect.y };
            sm.chestAreas = sm.chestAreas || []; sm.chestAreas.push(obj);
            state.selected = { kind: 'rect', list: 'sm', field: 'chestAreas', ref: obj, x: obj.x, y: obj.y, w: obj.w, h: obj.h };
        }
        buildInspector();
    }

    function placePoint(tool, t) {
        if(!inBounds(t)) { return; }
        var cm = state.clientMap, sm = state.serverMap;
        if(tool === 'door') {
            var d = { x: t.x, y: t.y, p: opts.door.portal ? 1 : 0, to: opts.door.to || 'd', tx: opts.door.tx || t.x, ty: opts.door.ty || t.y };
            cm.doors = cm.doors || []; cm.doors.push(d);
            sm.doors = sm.doors || []; sm.doors.push({ x: d.x, y: d.y, p: d.p, to: d.to, tx: d.tx, ty: d.ty });
            state.selected = { kind: 'point', list: 'cm', field: 'doors', ref: d, x: d.x, y: d.y };
        } else if(tool === 'staticChest') {
            var c = { x: t.x, y: t.y, i: kindsFromNames(opts.staticChest.items) };
            sm.staticChests = sm.staticChests || []; sm.staticChests.push(c);
            state.selected = { kind: 'point', list: 'sm', field: 'staticChests', ref: c, x: c.x, y: c.y };
        } else if(tool === 'staticEntity') {
            sm.staticEntities = sm.staticEntities || {};
            var seKey = xyToIdx(sm, t.x, t.y);
            sm.staticEntities[seKey] = opts.staticEntity.kind || 'rat';
            state.selected = { kind: 'point', list: 'sm', field: 'staticEntities', key: seKey,
                               ref: sm.staticEntities[seKey], x: t.x, y: t.y };
        } else if(tool === 'npc') {
            var npc = {
                id: 'npc_' + Date.now(),
                name: opts.npc.name || 'NPC',
                kind: opts.npc.kind || 'villager',
                x: t.x, y: t.y,
                conversations: (opts.npc.conversations || 'Hello there').split('\n'),
                events: []
            };
            state.npcs.npcs.push(npc);
            state.dirty.npcs = true;
            state.selected = { kind: 'point', list: 'npcs', field: 'npcs', ref: npc, x: npc.x, y: npc.y };
        }
        buildInspector();
        renderMap();
    }

    function pickAt(t) {
        if(!inBounds(t)) { return; }
        var cm = state.clientMap, sm = state.serverMap;

        // Priority: points (small, exact-hit) beat enclosing regions.
        // 1) NPCs
        for(var i = 0; i < state.npcs.npcs.length; i++) {
            var n = state.npcs.npcs[i];
            if(n.x === t.x && n.y === t.y) { state.selected = { kind: 'point', list: 'npcs', field: 'npcs', ref: n, x: n.x, y: n.y }; buildInspector(); renderMap(); return; }
        }
        // 2) Doors
        var doors = cm.doors || [];
        for(var d = doors.length - 1; d >= 0; d--) {
            if(doors[d].x === t.x && doors[d].y === t.y) {
                state.selected = { kind:'point', list:'cm', field:'doors', ref:doors[d], x:t.x, y:t.y };
                buildInspector(); renderMap(); return;
            }
        }
        // 3) Static chests
        var sc = sm.staticChests || [];
        for(var s2 = sc.length - 1; s2 >= 0; s2--) {
            if(sc[s2].x === t.x && sc[s2].y === t.y) {
                state.selected = { kind:'point', list:'sm', field:'staticChests', ref:sc[s2], x:t.x, y:t.y };
                buildInspector(); renderMap(); return;
            }
        }
        // 4) Static entities (mob/item) — exact tile, beats any region
        var key = xyToIdx(sm, t.x, t.y);
        if(sm.staticEntities && (key in sm.staticEntities)) {
            state.selected = { kind:'point', list:'sm', field:'staticEntities', key:key,
                               ref: sm.staticEntities[key], x:t.x, y:t.y };
            buildInspector(); renderMap(); return;
        }

        // 5) Regions (smallest containing rect)
        var best = null;
        function consider(list, listName, field, rectFn, extra) {
            (list || []).forEach(function(o) {
                var r = rectFn(o);
                if(t.x >= r.x && t.x < r.x + r.w && t.y >= r.y && t.y < r.y + r.h) {
                    var area = r.w * r.h;
                    if(!best || area < best.area) {
                        best = { area: area, sel: Object.assign({ kind: 'rect', list: listName, field: field, ref: o, x: r.x, y: r.y, w: r.w, h: r.h }, extra || {}) };
                    }
                }
            });
        }
        consider(cm.musicAreas, 'cm', 'musicAreas', function(o){return {x:o.x,y:o.y,w:o.w,h:o.h};});
        consider(cm.checkpoints, 'cm', 'checkpoints', function(o){return {x:o.x,y:o.y,w:o.w,h:o.h};});
        consider(sm.roamingAreas, 'sm', 'roamingAreas', function(o){return {x:o.x,y:o.y,w:o.width,h:o.height};});
        consider(sm.chestAreas, 'sm', 'chestAreas', function(o){return {x:o.x,y:o.y,w:o.w,h:o.h};});
        if(best) { state.selected = best.sel; buildInspector(); renderMap(); return; }

        state.selected = null; buildInspector(); renderMap();
    }

    function kindsFromNames(str) {
        return (str || '').split(',').map(function(s){ return s.trim(); }).filter(Boolean).map(function(name) {
            return (typeof Types !== 'undefined' && Types.getKindFromString) ? Types.getKindFromString(name) : name;
        });
    }

    // Inspector --------------------------------------------------------------
    function buildInspector() {
        var tool = $('tool').value;
        var body = $('inspector-body');
        var title = $('inspector-title');
        // If a selection exists, show its editor regardless of tool.
        if(state.selected) { renderSelectionInspector(); return; }

        if(tool === 'musicArea') {
            title.textContent = 'Music / cave area';
            body.innerHTML = textField('Area id (e.g. forest, cave, village)', 'opt-music-id', opts.musicArea.id) +
                '<div class="hint">Drag a rectangle on the map to place.</div>';
            bindInput('opt-music-id', function(v){ opts.musicArea.id = v; });
        } else if(tool === 'checkpoint') {
            title.textContent = 'Checkpoint';
            body.innerHTML = checkedField('Starting area (spawn)', 'opt-cp-start', opts.checkpoint.start) +
                '<div class="hint">Drag a rectangle. Drag to place a respawn/starting area.</div>';
            bindCheck('opt-cp-start', function(v){ opts.checkpoint.start = v; });
        } else if(tool === 'roamingArea') {
            title.textContent = 'Roaming mob area';
            body.innerHTML = textField('Mob type (e.g. rat, skeleton)', 'opt-ra-type', opts.roamingArea.type) +
                numberField('Mob count', 'opt-ra-nb', opts.roamingArea.nb) +
                '<div class="hint">Drag a rectangle to place.</div>';
            bindInput('opt-ra-type', function(v){ opts.roamingArea.type = v; });
            bindNumber('opt-ra-nb', function(v){ opts.roamingArea.nb = v; });
        } else if(tool === 'chestArea') {
            title.textContent = 'Chest area';
            body.innerHTML = textField('Item kinds (comma-sep, e.g. sword1,flask)', 'opt-ca-items', opts.chestArea.items) +
                '<div class="hint">Drag a rectangle to place.</div>';
            bindInput('opt-ca-items', function(v){ opts.chestArea.items = v; });
        } else if(tool === 'door') {
            title.textContent = 'Door / portal';
            body.innerHTML = textField('Target x', 'opt-door-tx', opts.door.tx) +
                textField('Target y', 'opt-door-ty', opts.door.ty) +
                selectField('Exit orientation', 'opt-door-to', opts.door.to, [['d','Down'],['u','Up'],['l','Left'],['r','Right']]) +
                checkedField('Portal (no return)', 'opt-door-portal', opts.door.portal) +
                '<div class="hint">Click a tile on the map to place the door.</div>';
            bindInput('opt-door-tx', function(v){ opts.door.tx = parseInt(v,10)||0; });
            bindInput('opt-door-ty', function(v){ opts.door.ty = parseInt(v,10)||0; });
            bindSelect('opt-door-to', function(v){ opts.door.to = v; });
            bindCheck('opt-door-portal', function(v){ opts.door.portal = v; });
        } else if(tool === 'staticChest') {
            title.textContent = 'Static chest';
            body.innerHTML = textField('Item kinds (comma-sep)', 'opt-sc-items', opts.staticChest.items) +
                '<div class="hint">Click a tile to place.</div>';
            bindInput('opt-sc-items', function(v){ opts.staticChest.items = v; });
        } else if(tool === 'staticEntity') {
            title.textContent = 'Static mob / item';
            body.innerHTML = spriteField('Kind', 'opt-se-kind', opts.staticEntity.kind) +
                '<div class="hint">Click a tile to place. Pick a sprite above or type a kind.</div>';
            bindSpriteField('opt-se-kind', function(v){ opts.staticEntity.kind = v; });
        } else if(tool === 'npc') {
            title.textContent = 'Add NPC';
            body.innerHTML = textField('Name', 'opt-npc-name', opts.npc.name) +
                spriteField('Sprite kind', 'opt-npc-kind', opts.npc.kind) +
                textField('Conversations (one per line)', 'opt-npc-conv', opts.npc.conversations) +
                '<div class="hint">Click a tile to place. Then "Apply NPCs" to write npcs.json.</div>';
            bindInput('opt-npc-name', function(v){ opts.npc.name = v; });
            bindSpriteField('opt-npc-kind', function(v){ opts.npc.kind = v; });
            bindInput('opt-npc-conv', function(v){ opts.npc.conversations = v; });
        } else if(tool === 'select') {
            title.textContent = 'Select';
            body.innerHTML = '<div class="hint">Click an NPC, region or door on the map to edit it.</div>' +
                npcListHtml();
            bindNpcList();
        } else {
            title.textContent = 'Inspector';
            body.innerHTML = '<div class="hint">Tile tools: choose a tile from the palette and paint. ' +
                'Region tools: drag a rectangle. Point tools: click.</div>';
        }
    }

    function npcListHtml() {
        var list = state.npcs.npcs || [];
        if(!list.length) { return '<div class="hint">No NPCs.</div>'; }
        return '<div style="margin-top:10px;color:#FCE045">NPCs (' + list.length + ')</div><ul class="list">' +
            list.map(function(n, i){ return '<li data-npc-index="'+i+'">'+escapeHtml(n.name||n.id)+' @'+n.x+','+n.y+'</li>'; }).join('') +
            '</ul>';
    }
    function bindNpcList() {
        Array.prototype.forEach.call(document.querySelectorAll('#inspector-body li[data-npc-index]'), function(li) {
            li.addEventListener('click', function() {
                var n = state.npcs.npcs[parseInt(li.getAttribute('data-npc-index'),10)];
                state.selected = { kind:'point', list:'npcs', field:'npcs', ref:n, x:n.x, y:n.y };
                buildInspector(); renderMap();
            });
        });
    }

    function renderSelectionInspector() {
        var s = state.selected;
        var body = $('inspector-body');
        $('inspector-title').textContent = 'Edit ' + s.field;

        if(s.list === 'npcs') {
            var n = s.ref;
            body.innerHTML =
                textField('Name', 'sel-name', n.name) +
                textField('Kind', 'sel-kind', n.kind) +
                textField('X', 'sel-x', n.x) +
                textField('Y', 'sel-y', n.y) +
                textField('Conversations (one per line)', 'sel-conv', (n.conversations||[]).join('\n')) +
                '<button id="sel-del" class="danger" type="button">Delete NPC</button>' +
                '<div class="hint">Changes are written when you press "Apply NPCs".</div>';
            bindInput('sel-name', function(v){ n.name = v; markNpcsDirty(); refreshNpcListPositions(); });
            bindInput('sel-kind', function(v){ n.kind = v; markNpcsDirty(); });
            bindNumberInput('sel-x', function(v){ n.x = v; s.x = v; markNpcsDirty(); renderMap(); refreshNpcListPositions(); });
            bindNumberInput('sel-y', function(v){ n.y = v; s.y = v; markNpcsDirty(); renderMap(); refreshNpcListPositions(); });
            bindInputTextarea('sel-conv', function(v){ n.conversations = v.split('\n'); markNpcsDirty(); });
            $('sel-del').addEventListener('click', function() {
                var idx = state.npcs.npcs.indexOf(n);
                if(idx >= 0) { state.npcs.npcs.splice(idx, 1); }
                state.selected = null; markNpcsDirty(); buildInspector(); renderMap();
            });
            return;
        }

        var ref = s.ref;
        var html = '';
        if(s.field === 'doors') {
            html = textField('X', 'sel-x', ref.x) + textField('Y', 'sel-y', ref.y) +
                textField('Target x', 'sel-tx', ref.tx) + textField('Target y', 'sel-ty', ref.ty) +
                selectField('Orientation', 'sel-to', ref.to || 'd', [['d','Down'],['u','Up'],['l','Left'],['r','Right']]) +
                checkedField('Portal', 'sel-p', ref.p === 1);
        } else if(s.field === 'musicAreas') {
            html = textField('Id', 'sel-id', ref.id) +
                textField('x','sel-x',ref.x)+textField('y','sel-y',ref.y)+textField('w','sel-w',ref.w)+textField('h','sel-h',ref.h);
        } else if(s.field === 'checkpoints') {
            html = textField('x','sel-x',ref.x)+textField('y','sel-y',ref.y)+textField('w','sel-w',ref.w)+textField('h','sel-h',ref.h) +
                checkedField('Starting area', 'sel-start', s.sref ? s.sref.s === 1 : false);
        } else if(s.field === 'roamingAreas') {
            html = textField('Mob type','sel-type',ref.type)+numberField('Count','sel-nb',ref.nb) +
                textField('x','sel-x',ref.x)+textField('y','sel-y',ref.y)+textField('w','sel-w',ref.width)+textField('h','sel-h',ref.height);
        } else if(s.field === 'chestAreas') {
            html = textField('Items (comma-sep ids or names)','sel-items',kindNames(ref.i)) +
                textField('x','sel-x',ref.x)+textField('y','sel-y',ref.y)+textField('w','sel-w',ref.w)+textField('h','sel-h',ref.h);
        } else if(s.field === 'staticChests') {
            html = textField('Items (comma-sep)','sel-items',kindNames(ref.i)) + textField('x','sel-x',ref.x)+textField('y','sel-y',ref.y);
        } else if(s.field === 'staticEntities') {
            html = textField('Kind','sel-kind',ref) + textField('x','sel-x',s.x)+textField('y','sel-y',s.y);
        }
        html += '<button id="sel-del" class="danger" type="button">Delete</button>';
        body.innerHTML = html;
        bindSelectionFields(s);
        $('sel-del').addEventListener('click', function() { deleteSelection(s); });
    }

    function deleteSelection(s) {
        if(s.field === 'staticEntities') {
            delete state.serverMap.staticEntities[s.key];
        } else if(s.field === 'doors') {
            removeFrom(state.clientMap.doors, s.ref); removeFrom(state.serverMap.doors, s.ref);
        } else {
            var container = (s.list === 'sm') ? state.serverMap : state.clientMap;
            removeFrom(container[s.field], s.ref);
            if(s.field === 'checkpoints' && s.sref) { removeFrom(state.serverMap.checkpoints, s.sref); }
        }
        state.selected = null; buildInspector(); renderMap();
    }
    function removeFrom(arr, obj) { if(!arr) { return; } var i = arr.indexOf(obj); if(i >= 0) { arr.splice(i,1); } }

    function bindSelectionFields(s) {
        var ref = s.ref;
        if(s.field === 'doors') {
            bindNumberInput('sel-x', function(v){ ref.x=v; });
            bindNumberInput('sel-y', function(v){ ref.y=v; });
            bindNumberInput('sel-tx', function(v){ ref.tx=v; });
            bindNumberInput('sel-ty', function(v){ ref.ty=v; });
            bindSelect('sel-to', function(v){ ref.to=v; });
            bindCheck('sel-p', function(v){ ref.p = v?1:0; });
            // mirror into server doors (same object reference if possible)
        } else if(s.field === 'musicAreas') {
            bindInput('sel-id', function(v){ ref.id=v; });
            bindNumberInput('sel-x', function(v){ ref.x=v; s.x=v; }); bindNumberInput('sel-y', function(v){ ref.y=v; s.y=v; });
            bindNumberInput('sel-w', function(v){ ref.w=v; s.w=v; }); bindNumberInput('sel-h', function(v){ ref.h=v; s.h=v; });
        } else if(s.field === 'checkpoints') {
            bindNumberInput('sel-x', function(v){ ref.x=v; if(s.sref)s.sref.x=v; s.x=v; });
            bindNumberInput('sel-y', function(v){ ref.y=v; if(s.sref)s.sref.y=v; s.y=v; });
            bindNumberInput('sel-w', function(v){ ref.w=v; if(s.sref)s.sref.w=v; s.w=v; });
            bindNumberInput('sel-h', function(v){ ref.h=v; if(s.sref)s.sref.h=v; s.h=v; });
            bindCheck('sel-start', function(v){ if(s.sref) s.sref.s = v?1:0; });
        } else if(s.field === 'roamingAreas') {
            bindInput('sel-type', function(v){ ref.type=v; });
            bindNumberInput('sel-nb', function(v){ ref.nb=v; });
            bindNumberInput('sel-x', function(v){ ref.x=v; s.x=v; }); bindNumberInput('sel-y', function(v){ ref.y=v; s.y=v; });
            bindNumberInput('sel-w', function(v){ ref.width=v; s.w=v; }); bindNumberInput('sel-h', function(v){ ref.height=v; s.h=v; });
        } else if(s.field === 'chestAreas') {
            bindInput('sel-items', function(v){ ref.i = kindsFromNames(v); });
            bindNumberInput('sel-x', function(v){ ref.x=v; s.x=v; }); bindNumberInput('sel-y', function(v){ ref.y=v; s.y=v; });
            bindNumberInput('sel-w', function(v){ ref.w=v; s.w=v; }); bindNumberInput('sel-h', function(v){ ref.h=v; s.h=v; });
        } else if(s.field === 'staticChests') {
            bindInput('sel-items', function(v){ ref.i = kindsFromNames(v); });
            bindNumberInput('sel-x', function(v){ ref.x=v; s.x=v; }); bindNumberInput('sel-y', function(v){ ref.y=v; s.y=v; });
        } else if(s.field === 'staticEntities') {
            bindInput('sel-kind', function(v){ state.serverMap.staticEntities[s.key] = v; s.ref = v; });
        }
    }

    function kindNames(list) {
        return (list||[]).map(function(k){
            if(typeof k === 'number' && typeof Types !== 'undefined' && Types.getKindAsString) {
                return Types.getKindAsString(k) || k;
            }
            return k;
        }).join(',');
    }

    function markNpcsDirty() { state.dirty.npcs = true; }
    function refreshNpcListPositions() { /* list rebuilt on next select-tool view */ }

    // Field helpers ----------------------------------------------------------
    function escapeHtml(s){ return String(s).replace(/[&<>"]/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }
    function textField(label, id, val) { return '<label>' + escapeHtml(label) + '<input type="text" id="' + id + '" value="' + escapeAttr(val) + '"></label>'; }
    function numberField(label, id, val) { return '<label>' + escapeHtml(label) + '<input type="number" id="' + id + '" value="' + escapeAttr(val) + '"></label>'; }
    function checkedField(label, id, checked) { return '<label><input type="checkbox" id="' + id + '"' + (checked?' checked':'') + '> ' + escapeHtml(label) + '</label>'; }
    function selectField(label, id, val, options) {
        var o = options.map(function(op){ return '<option value="'+op[0]+'"'+(op[0]===val?' selected':'')+'>'+op[1]+'</option>'; }).join('');
        return '<label>' + escapeHtml(label) + '<select id="' + id + '">' + o + '</select></label>';
    }
    function escapeAttr(v){ return String(v==null?'':v).replace(/"/g,'&quot;'); }

    /**
     * Sprite picker: a <select> of known sprite ids (sorted) plus a free-text
     * override for ids not in the list. Used for entity/NPC "kind".
     */
    function spriteField(label, id, val) {
        var ids = state.sprites.map(function(sp){ return sp.id; }).sort();
        var known = ids.indexOf(val) !== -1;
        var opts = ids.map(function(sid){ return '<option value="'+sid+'"'+(sid===val?' selected':'')+'>'+sid+'</option>'; }).join('');
        if(!known && val) { opts = '<option value="'+escapeAttr(val)+'" selected>'+escapeHtml(val)+' (custom)</option>' + opts; }
        return '<label>' + escapeHtml(label) +
            '<select id="' + id + '">' + opts + '</select></label>' +
            '<label>or type a kind<input type="text" id="' + id + '-custom" value="' + escapeAttr(val) + '"></label>';
    }
    function bindSpriteField(id, fn) {
        var sel = $(id), txt = $(id + '-custom');
        if(sel) { sel.addEventListener('change', function(){ if(txt) { txt.value = sel.value; } fn(sel.value); }); }
        if(txt) { txt.addEventListener('input', function(){ fn(txt.value); }); }
    }

    function bindInput(id, fn){ var el=$(id); if(el){ el.addEventListener('input', function(){ fn(el.value); }); } }
    function bindNumberInput(id, fn){ var el=$(id); if(el){ el.addEventListener('input', function(){ fn(parseInt(el.value,10)||0); renderMap(); }); } }
    function bindNumber(id, fn){ bindNumberInput(id, fn); }
    function bindCheck(id, fn){ var el=$(id); if(el){ el.addEventListener('change', function(){ fn(el.checked); }); } }
    function bindSelect(id, fn){ var el=$(id); if(el){ el.addEventListener('change', function(){ fn(el.value); }); } }
    function bindInputTextarea(id, fn){ bindInput(id, fn); }

    // Save -------------------------------------------------------------------
    function save() {
        var btn = $('save-btn'); btn.disabled = true; setStatus('Saving...');
        var payload = { clientMap: state.clientMap, serverMap: state.serverMap };
        fetch('/editor/api/save', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) })
            .then(function(r){ return r.json().then(function(j){ return {status:r.status, body:j}; }); })
            .then(function(res){
                btn.disabled = false;
                if(res.status === 200 && res.body.ok) {
                    var msg = 'Saved: ' + res.body.written.join(', ');
                    if(res.body.restartRequired) { msg += ' (server restart required)'; }
                    setStatus(msg);
                } else { setStatus('Save failed: ' + JSON.stringify(res.body)); }
            }).catch(function(e){ btn.disabled = false; setStatus('Save error: ' + e.message); });
    }

    function applyNpcs() {
        setStatus('Applying NPCs...');
        fetch('/editor/api/save', {
            method:'POST', headers:{'Content-Type':'application/json'},
            body: JSON.stringify({ files: [{ path: 'shared/data/npcs.json', data: state.npcs }] })
        }).then(function(r){ return r.json().then(function(j){ return {status:r.status, body:j}; }); })
          .then(function(res){
              if(res.status === 200 && res.body.ok) {
                  state.dirty.npcs = false;
                  setStatus('NPCs applied: ' + res.body.written.join(', ') + ' (run `npm run npcs:build` or restart to regenerate client data)');
              } else { setStatus('Apply NPCs failed: ' + JSON.stringify(res.body)); }
          }).catch(function(e){ setStatus('Apply NPCs error: ' + e.message); });
    }

    // Import -----------------------------------------------------------------
    function openImportDialog() {
        $('import-status').textContent = '';
        // Prefill id from selected sprite or empty.
        if($('imp-id') && !$('imp-id').value) {
            $('imp-id').value = state.selectedSprite || '';
        }
        $('import-dialog').style.display = 'flex';
    }

    function refreshImportJsonPreview() {
        if(!$('imp-json')) { return; }
        var obj = {
            id: ($('imp-id').value || '').trim(),
            width: parseInt($('imp-w').value, 10) || 16,
            height: parseInt($('imp-h').value, 10) || 16,
            animations: { idle: { length: parseInt($('imp-len').value, 10) || 1, row: parseInt($('imp-row').value, 10) || 0 } },
            offset_x: 0,
            offset_y: 0
        };
        $('imp-json').value = JSON.stringify(obj, null, 2);
    }

    function readFileAsDataURL(file) {
        return new Promise(function(res, rej) {
            var fr = new FileReader();
            fr.onload = function() { res(String(fr.result)); };
            fr.onerror = function(e) { rej(e); };
            fr.readAsDataURL(file);
        });
    }

    function loadDataURLImage(dataUrl) {
        return new Promise(function(res, rej) {
            var img = new Image();
            img.onload = function() { res(img); };
            img.onerror = function(e) { rej(e); };
            img.src = dataUrl;
        });
    }

    // Resize a PNG data URL to a target pixel size, returning a new PNG data URL.
    function resizeDataURL(dataUrl, w, h) {
        return loadDataURLImage(dataUrl).then(function(img) {
            var c = document.createElement('canvas');
            c.width = w; c.height = h;
            var ctx = c.getContext('2d');
            ctx.imageSmoothingEnabled = false;
            ctx.drawImage(img, 0, 0, w, h);
            return c.toDataURL('image/png');
        });
    }

    function doImport() {
        var id = ($('imp-id').value || '').trim();
        if(!/^[a-zA-Z0-9_-]+$/.test(id)) { $('import-status').textContent = 'Enter a valid sprite id (letters/digits/-/_) — must match the filename.'; return; }
        var w = parseInt($('imp-w').value, 10) || 16;
        var h = parseInt($('imp-h').value, 10) || 16;
        var len = parseInt($('imp-len').value, 10) || 1;
        var row = parseInt($('imp-row').value, 10) || 0;

        var animations;
        if($('imp-advanced') && $('imp-advanced').checked && $('imp-json').value.trim()) {
            try {
                var parsed = JSON.parse($('imp-json').value);
                if(parsed.animations) { animations = parsed.animations; }
                if(parsed.width) { w = parsed.width; }
                if(parsed.height) { h = parsed.height; }
            } catch(e) { $('import-status').textContent = 'Sprite JSON is invalid: ' + e.message; return; }
        }
        if(!animations) { animations = { idle: { length: len, row: row } }; }

        var files = {};
        [1,2,3].forEach(function(s) {
            var el = $('imp-png' + s);
            if(el && el.files && el.files[0]) { files[s] = el.files[0]; }
        });
        if(Object.keys(files).length === 0) { $('import-status').textContent = 'Provide at least one scale PNG.'; return; }

        $('import-status').textContent = 'Processing images...';

        // Read provided PNGs, then generate missing scales from the closest
        // available one (prefer scale 2). Target pixel size per scale =
        // frame width/height * scale * frame-grid.
        var scaleOrder = [2,1,3].filter(function(s){ return files[s]; });
        var readAll = Object.keys(files).map(function(s){ return readFileAsDataURL(files[s]).then(function(d){ return {scale:parseInt(s,10), data:d}; }); });

        // Shared across the promise chain below (must outlive each .then scope).
        var have = {};
        var pngs = {};

        Promise.all(readAll).then(function(list) {
            list.forEach(function(x){ have[x.scale] = x.data; });
            var srcScale = scaleOrder[0];
            // Generate missing scales from the chosen source image, preserving the
            // frame grid (framesX x framesY) so animations still line up.
            return loadDataURLImage(have[srcScale]).then(function(img) {
                var framesX = Math.max(1, Math.round(img.width / (w * srcScale)));
                var framesY = Math.max(1, Math.round(img.height / (h * srcScale)));
                var genP = [];
                [1,2,3].forEach(function(s) {
                    if(have[s]) { return; }
                    var tw = w * s * framesX, th = h * s * framesY;
                    genP.push(resizeDataURL(have[srcScale], tw, th).then(function(d){ have[s] = d; }));
                });
                return Promise.all(genP);
            });
        }).then(function() {
            var terrain = $('imp-terrain') && $('imp-terrain').checked;
            if(terrain) {
                $('import-status').textContent = 'Compositing terrain tile into tilesheets...';
                return importTerrainTile(have, id);
            }
            // Build base64 (strip data URL prefix).
            [1,2,3].forEach(function(s) { if(have[s]) { pngs[s] = have[s].split(',')[1]; } });
            $('import-status').textContent = 'Writing sprite...';
            return fetch('/editor/api/import-sprite', {
                method:'POST', headers:{'Content-Type':'application/json'},
                body: JSON.stringify({ id: id, width: w, height: h, animations: animations,
                                       offset_x: 0, offset_y: 0, pngs: pngs })
            }).then(function(r){ return r.json(); }).then(function(j) {
                if(j && j.ok) {
                    $('import-status').textContent = 'Imported ' + j.id + ' -> ' + j.written.join(', ');
                    return loadJSON('/editor/api/sprites').then(function(res) {
                        state.sprites = (res && res.sprites) || [];
                        buildSpritePalette();
                        setStatus('Imported sprite "' + j.id + '"');
                    });
                } else {
                    $('import-status').textContent = 'Import failed: ' + JSON.stringify(j);
                }
            });
        }).catch(function(e){ $('import-status').textContent = 'Import error: ' + e.message; });
    }

    /**
     * Composite a new terrain tile into all three tilesheet PNGs (appended at the
     * end so existing tile ids are unchanged), then upload the sheets + register
     * the tile's name. `have` holds per-scale source image data URLs (frame 0 of
     * a w*h sprite; we use its top-left w*h region).
     */
    function importTerrainTile(have, name) {
        // Load the three current tilesheets so we can append to them.
        return Promise.all([
            loadImage('/img/1/tilesheet.png'),
            loadImage('/img/2/tilesheet.png'),
            loadImage('/img/3/tilesheet.png')
        ]).then(function(sheets) {
            // Sheet must be 20 columns at every scale (tile size 16*scale).
            var cols = sheets[0].width / 16;
            var curRows = sheets[0].height / 16;

            // Determine the next free tile id = max(existing ids) + 1.
            var maxId = nextTileId();
            var id = maxId;                       // append at end
            var cellIndex = id - 1;               // 0-based
            var needRows = Math.floor(cellIndex / cols) + 1;
            var newRows = Math.max(curRows, needRows);

            // Some sheets (scale 2/3) may already be taller; normalise by appending
            // to whichever scale we draw (id is row*cols+col, identical across scales).
            var out = {};
            var jobs = sheets.map(function(sheet, i) {
                var s = i + 1;
                var ts = 16 * s;                 // tile size in px at this scale
                var targetH = newRows * ts, targetW = cols * ts;
                var c = document.createElement('canvas');
                c.width = targetW;
                c.height = targetH;
                var ctx = c.getContext('2d');
                ctx.imageSmoothingEnabled = false;
                // Preserve existing sheet art.
                ctx.drawImage(sheet, 0, 0);
                // Draw the new tile into its cell (top-left frame of source).
                var gx = cellIndex % cols, gy = Math.floor(cellIndex / cols);
                return loadDataURLImage(have[s]).then(function(img) {
                    ctx.drawImage(img, 0, 0, Math.min(ts, img.width), Math.min(ts, img.height),
                                  gx * ts, gy * ts, ts, ts);
                    out[s] = c.toDataURL('image/png');
                });
            });

            return Promise.all(jobs).then(function() {
                var payload = { id: id, name: name, sheets: {} };
                [1,2,3].forEach(function(s) { payload.sheets[s] = (out[s] || '').split(',')[1]; });
                return fetch('/editor/api/import-tile', {
                    method:'POST', headers:{'Content-Type':'application/json'},
                    body: JSON.stringify(payload)
                }).then(function(r){ return r.json(); });
            }).then(function(j) {
                if(j && j.ok) {
                    // Reload tileset + registry so the palette shows the new tile.
                    return Promise.all([ loadImage('/img/2/tilesheet.png'), loadJSON('/editor/api/load') ])
                        .then(function(res) {
                            state.tileset = res[0];
                            state.cols = (state.tileset.width / TILE) / SCALE;
                            state.tiles = (res[1] && res[1].tiles) || {};
                            state.selectedTile = j.id;
                            buildPalette();
                            switchPaletteTab('tiles');
                            $('import-status').textContent = 'Imported terrain tile #' + j.id +
                                ' ("' + name + '") -> ' + j.written.join(', ') + '. Reload to see new maps.';
                            setStatus('Terrain tile #' + j.id + ' imported (reload to refresh game).');
                        });
                } else {
                    $('import-status').textContent = 'Tile import failed: ' + JSON.stringify(j);
                }
            });
        });
    }

    function nextTileId() {
        var max = 0, map = state.clientMap, data = map ? map.data : [];
        for(var i = 0; i < data.length; i++) {
            var cell = data[i];
            if(Array.isArray(cell)) { for(var j = 0; j < cell.length; j++) { if(cell[j] > max) { max = cell[j]; } } }
            else if(cell > max) { max = cell; }
        }
        // Animated tile ids occupy a contiguous run of frames: the metadata is
        // keyed by the first frame id with an animation length `l`, so the ids
        // [base .. base+l-1] are all in use even if not placed in data[].
        var anim = map && map.animated;
        if(anim) {
            Object.keys(anim).forEach(function(k) {
                var base = parseInt(k, 10);
                var len = (anim[k] && anim[k].l) ? anim[k].l : 1;
                var last = base + len - 1;
                if(last > max) { max = last; }
            });
        }
        return max + 1;
    }

    // Boot -------------------------------------------------------------------
    window.addEventListener('DOMContentLoaded', init);
    window.addEventListener('resize', function() {
        if(!state.clientMap) { return; }
        resizeMapCanvas(); renderMap();
    });
})();
