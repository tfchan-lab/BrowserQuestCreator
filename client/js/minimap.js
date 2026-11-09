/**
 * Minimap renderer.
 *
 * Builds an offscreen "terrain" canvas from the real tileset art (each map tile
 * is drawn into a small cell, supersampled so the downscaled result is smooth).
 * The world is one large tilemap whose right-hand side is the dungeon / room
 * system; the "fixed" (whole-world) view crops to the contiguous open-world
 * landmass on the left and omits the dungeon rooms.
 *
 * Two modes:
 *   - "fixed" : the overworld scaled to the minimap width (whole map view)
 *   - "zoom"  : a local window centred on the player
 *
 * Entity dots: blue (large) = local player, green = other players + NPCs,
 * red = mobs.
 */
define(function() {

    // Offscreen supersampling: pixels per world tile when building the terrain.
    // Larger = smoother when the minimap is scaled down.
    var TERRAIN_SCALE = 3;

    // The dungeon / room system occupies the right part of the world map. This
    // is the left edge (in tiles) of that block; the fixed view crops to
    // [0, OVERWORLD_W). Derived from the map layout (open field ends ~x=93).
    var OVERWORLD_W = 93;

    var Minimap = Class.extend({
        init: function(game, classes) {
            this.game = game;
            this.Mob = classes && classes.Mob;
            this.Npc = classes && classes.Npc;
            this.Player = classes && classes.Player;

            this.terrain = null;        // offscreen supersampled terrain canvas
            this.tScale = TERRAIN_SCALE;
            this.mapW = 0;
            this.mapH = 0;
            this.overworldW = OVERWORLD_W;
            this.mode = 'zoom';         // 'zoom' | 'fixed' | 'hidden'
            this.zoomTiles = 36;        // world tiles visible across in zoom mode (smaller = closer)
            this.size = 125;            // minimap box size (px)

            this.canvas = null;
            this.ctx = null;
            this.viewW = 0;
            this.viewH = 0;
        },

        /** True once the map (and its tilesets) are ready. */
        isReady: function() {
            var m = this.game.map,
                r = this.game.renderer;
            return !!(m && m.isLoaded && m.data && m.width > 0 && m.height > 0
                      && r && r.tileset && r.tileset.width > 0);
        },

        /**
         * Builds the terrain thumbnail. Safe to call repeatedly; it rebuilds
         * only if not yet built (or forced).
         */
        buildTerrain: function(force) {
            if(this.terrain && !force) { return true; }
            if(!this.isReady()) { return false; }

            var map = this.game.map,
                data = map.data,
                width = map.width,
                height = map.height,
                renderer = this.game.renderer,
                tileset = renderer.tileset,
                s = renderer.upscaledRendering ? 1 : renderer.scale,
                ts = renderer.tilesize || 16,
                cols = (tileset.width / ts) / s,
                P = this.tScale;         // pixels per tile in the terrain canvas

            if(!(cols > 0) || !isFinite(cols)) { return false; }

            var getX = function(id, w) {
                if(id === 0) { return 0; }
                return (id % w === 0) ? w - 1 : (id % w) - 1;
            };

            var sw = ts * s;   // real source pixel size of one tile

            var off = document.createElement('canvas');
            off.width = width * P;
            off.height = height * P;
            var octx = off.getContext('2d');
            octx.imageSmoothingEnabled = true;

            // Base colour so transparent/empty cells read as ground, not holes.
            octx.fillStyle = '#3a5a2a';
            octx.fillRect(0, 0, off.width, off.height);

            for(var y = 0; y < height; y++) {
                var rowBase = y * width;
                for(var x = 0; x < width; x++) {
                    var id = data[rowBase + x];
                    if(typeof id !== 'number' || id < 0) { continue; }

                    var sx = getX(id + 1, cols) * sw,
                        sy = Math.floor(id / cols) * sw;

                    try {
                        octx.drawImage(tileset, sx, sy, sw, sw, x * P, y * P, P, P);
                    } catch(e) {
                        // Ignore a bad tile index; base fill already applied.
                    }
                }
            }

            this.terrain = off;
            this.mapW = width;
            this.mapH = height;
            // Clamp the crop to the actual map width.
            this.overworldW = Math.max(1, Math.min(width, OVERWORLD_W));
            return true;
        },

        setCanvas: function(canvas) {
            this.canvas = canvas;
            this.ctx = canvas ? canvas.getContext('2d') : null;
        },

        isHidden: function() {
            return this.mode === 'hidden';
        },

        /** Cycles zoom -> fixed -> hidden -> zoom. */
        toggleMode: function() {
            this.mode = (this.mode === 'zoom') ? 'fixed'
                      : (this.mode === 'fixed') ? 'hidden'
                      : 'zoom';
            return this.mode;
        },

        /** Sizes the canvas (CSS + pixel size) for the current mode. */
        applySize: function() {
            if(!this.canvas) { return; }
            var width = this.size,
                h;
            if(this.mode === 'fixed' && this.overworldW > 0 && this.mapH > 0) {
                h = Math.round(width * (this.mapH / this.overworldW));
            } else {
                h = this.size;
            }
            if(!(h > 0) || !isFinite(h)) { h = this.size; }
            this.viewW = width;
            this.viewH = h;
            this.canvas.width = this.viewW;
            this.canvas.height = this.viewH;
            this.canvas.style.width = this.viewW + 'px';
            this.canvas.style.height = this.viewH + 'px';
        },

        /** Renders terrain + entity dots for the current frame. */
        draw: function() {
            if(!this.ctx || this.mode === 'hidden') { return; }
            if(!this.buildTerrain(false)) {
                if(!(this.viewW > 0) || !(this.viewH > 0)) { this.applySize(); }
                return;
            }
            if(this.canvas.width !== this.viewW || this.canvas.height !== this.viewH) {
                this.applySize();
            }

            var ctx = this.ctx,
                W = this.viewW,
                H = this.viewH,
                player = this.game.player,
                P = this.tScale;

            ctx.clearRect(0, 0, W, H);
            ctx.imageSmoothingEnabled = true;

            var originX, originY, worldTilesW, worldTilesH;

            if(this.mode === 'fixed') {
                // Whole overworld crop (dungeon rooms excluded).
                worldTilesW = this.overworldW;
                worldTilesH = this.mapH;
                originX = 0;
                originY = 0;
                ctx.drawImage(this.terrain,
                    0, 0, worldTilesW * P, worldTilesH * P,
                    0, 0, W, H);
            } else {
                // Local window centred on the player.
                var half = this.zoomTiles / 2,
                    cx = player ? player.gridX : this.mapW / 2,
                    cy = player ? player.gridY : this.mapH / 2,
                    sx = Math.max(0, Math.min(this.mapW - this.zoomTiles, cx - half)),
                    sy = Math.max(0, Math.min(this.mapH - this.zoomTiles, cy - half));

                worldTilesW = Math.min(this.zoomTiles, this.mapW);
                worldTilesH = Math.min(this.zoomTiles, this.mapH);
                originX = Math.max(0, sx);
                originY = Math.max(0, sy);

                ctx.drawImage(this.terrain,
                    originX * P, originY * P, worldTilesW * P, worldTilesH * P,
                    0, 0, W, H);
            }

            var scaleX = W / worldTilesW,
                scaleY = H / worldTilesH;

            var toScreen = function(gx, gy) {
                return {
                    x: (gx - originX) * scaleX,
                    y: (gy - originY) * scaleY
                };
            };

            var inView = function(gx, gy) {
                return gx >= originX && gx <= originX + worldTilesW
                    && gy >= originY && gy <= originY + worldTilesH;
            };

            var self = this,
                Mob = this.Mob,
                Npc = this.Npc,
                Player = this.Player;

            // ---- Entities ------------------------------------------------
            this.game.forEachEntity(function(entity) {
                if(!entity || entity.isDead || entity.gridX === undefined || entity.gridY === undefined) {
                    return;
                }
                if(!inView(entity.gridX, entity.gridY)) { return; }

                var p = toScreen(entity.gridX, entity.gridY),
                    color = null,
                    radius = 3.2;   // all dots share the player's size

                if(entity === player) {
                    color = '#2f6fff';     // local player: blue
                } else if((Mob && entity instanceof Mob)) {
                    color = '#e33';        // mobs: red
                } else {
                    color = '#35c94a';     // other players + NPCs: green
                }

                self._dot(ctx, p.x, p.y, radius, color);
            });

            // ---- Viewport rectangle (zoom mode) --------------------------
            if(this.mode === 'zoom' && this.game.camera) {
                var cam = this.game.camera,
                    vp = toScreen(cam.gridX, cam.gridY),
                    vw = cam.gridW * scaleX,
                    vh = cam.gridH * scaleY;
                ctx.strokeStyle = 'rgba(255,255,255,0.55)';
                ctx.lineWidth = 1;
                ctx.strokeRect(vp.x + 0.5, vp.y + 0.5, vw, vh);
            }
        },

        _dot: function(ctx, x, y, r, color) {
            ctx.beginPath();
            ctx.fillStyle = color;
            ctx.arc(x, y, r, 0, Math.PI * 2, false);
            ctx.fill();
        }
    });

    return Minimap;
});
