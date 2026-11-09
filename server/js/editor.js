/**
 * Editor backend: same-origin save/import endpoints used by the in-app map
 * editor at `/editor`.
 *
 * Safety:
 *   - Only active when the config flag `editor_enabled` is true (see ws.js).
 *   - All writes are restricted to a fixed set of allowed repo paths (no
 *     arbitrary writes). Client-supplied relative paths are resolved and
 *     validated against those roots.
 *
 * It intentionally has no auth beyond being reachable from the same origin; it
 * is a developer tool and should be disabled in production.
 */

var fs = require('fs'),
    path = require('path');

var Editor = {};

var ROOT = path.resolve(__dirname, '../..');

// Allowed write roots (relative to repo root). Anything else is rejected.
var ALLOWED_ROOTS = [
    'client/maps',
    'server/maps',
    'shared/data',
    'client/sprites',
    'client/img'
];

// Files that the editor may (re)generate as side-effects of a save.
var CLIENT_MAP_JSON = path.join(ROOT, 'client/maps/world_client.json');
var CLIENT_MAP_JS = path.join(ROOT, 'client/maps/world_client.js');
var SERVER_MAP_JSON = path.join(ROOT, 'server/maps/world_server.json');

Editor.ROOT = ROOT;

/** Resolves a repo-relative path and ensures it lives under an allowed root. */
Editor.resolveSafe = function(relPath) {
    if(typeof relPath !== 'string' || relPath.length === 0) { return null; }
    // Normalise separators and strip leading slashes.
    var rel = relPath.replace(/\\/g, '/').replace(/^\/+/, '');
    var abs = path.resolve(ROOT, rel);
    var rootAbs = path.resolve(ROOT);

    // Must stay inside the repo.
    if(abs !== rootAbs && abs.indexOf(rootAbs + path.sep) !== 0) { return null; }

    // Must be within one of the allowed roots.
    var relFromRoot = path.relative(ROOT, abs).replace(/\\/g, '/');
    var ok = ALLOWED_ROOTS.some(function(r) {
        return relFromRoot === r || relFromRoot.indexOf(r + '/') === 0;
    });
    return ok ? abs : null;
};

/**
 * Writes the edited client map. Expects the full client map object.
 * Also regenerates `world_client.js` (used by the web worker) so both stay
 * in sync. Returns { ok, file, jsFile }.
 */
Editor.saveClientMap = function(map) {
    if(!map || typeof map !== 'object' || !Array.isArray(map.data)) {
        return { ok: false, error: 'Invalid client map object (missing data[]).' };
    }
    var json = JSON.stringify(map);
    fs.writeFileSync(CLIENT_MAP_JSON, json);
    // Web-worker variant must be a JS assignment.
    fs.writeFileSync(CLIENT_MAP_JS, 'var mapData = ' + JSON.stringify(map));
    return { ok: true, file: 'client/maps/world_client.json',
             jsFile: 'client/maps/world_client.js' };
};

/** Writes the edited server map object. Returns { ok, file, restartRequired }. */
Editor.saveServerMap = function(map) {
    if(!map || typeof map !== 'object' || !map.staticEntities && !Array.isArray(map.collisions)) {
        return { ok: false, error: 'Invalid server map object.' };
    }
    fs.writeFileSync(SERVER_MAP_JSON, JSON.stringify(map));
    return { ok: true, file: 'server/maps/world_server.json', restartRequired: true };
};

/**
 * Generic (guarded) JSON file write — used by the editor for data files such as
 * `shared/data/npcs.json`. `relPath` must be within an allowed root.
 */
Editor.saveJsonFile = function(relPath, data) {
    var abs = Editor.resolveSafe(relPath);
    if(!abs) { return { ok: false, error: 'Path not allowed: ' + relPath }; }
    try {
        var json = JSON.stringify(data, null, 4);
        fs.writeFileSync(abs, json + '\n');
        return { ok: true, file: path.relative(ROOT, abs).replace(/\\/g, '/') };
    } catch(e) {
        return { ok: false, error: e.message };
    }
};

/**
 * Writes a binary asset (base64 data) to an allowed path, e.g. a sprite PNG.
 * `relPath` must be within an allowed root.
 */
Editor.saveBinaryFile = function(relPath, base64) {
    var abs = Editor.resolveSafe(relPath);
    if(!abs) { return { ok: false, error: 'Path not allowed: ' + relPath }; }
    try {
        var buf = Buffer.from(base64 || '', 'base64');
        // Ensure parent dir exists.
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, buf);
        return { ok: true, file: path.relative(ROOT, abs).replace(/\\/g, '/') };
    } catch(e) {
        return { ok: false, error: e.message };
    }
};

var SPRITES_DIR = path.join(ROOT, 'client/sprites');
var IMG_DIR = path.join(ROOT, 'client/img');
var SPRITES_GENERATED = path.join(ROOT, 'client/js/sprites.generated.js');
var SPRITE_SCALES = [1, 2, 3];

/**
 * Lists all entity sprites (`client/sprites/*.json`) with their metadata and
 * which scale PNGs exist (`client/img/<scale>/<id>.png`). Used by the editor's
 * sprite palette.
 */
Editor.listSprites = function() {
    var files;
    try { files = fs.readdirSync(SPRITES_DIR).filter(function(f) { return /\.json$/.test(f); }).sort(); }
    catch(e) { return []; }

    return files.map(function(f) {
        var data;
        try { data = JSON.parse(fs.readFileSync(path.join(SPRITES_DIR, f), 'utf8')); }
        catch(e) { return null; }
        if(!data || !data.id) { return null; }
        var scales = {};
        SPRITE_SCALES.forEach(function(s) {
            scales[s] = fs.existsSync(path.join(IMG_DIR, String(s), data.id + '.png'));
        });
        return {
            id: data.id,
            file: f,
            width: data.width,
            height: data.height,
            animations: data.animations || {},
            offset_x: data.offset_x || 0,
            offset_y: data.offset_y || 0,
            scales: scales
        };
    }).filter(Boolean);
};

/**
 * Regenerates `client/js/sprites.generated.js` from `client/sprites/*.json`
 * (same output as tools/equipment/build.js#generateSprites), so newly imported
 * sprites are picked up by the game client without a manual build.
 */
Editor.regenerateSpritesManifest = function() {
    var files;
    try { files = fs.readdirSync(SPRITES_DIR).filter(function(f) { return /\.json$/.test(f); }).sort(); }
    catch(e) { return { ok: false, error: e.message }; }

    var lines = [];
    lines.push("// AUTO-GENERATED by tools/equipment/build.js from client/sprites/*.json.");
    lines.push("// Do not edit by hand.");
    lines.push("define([");
    files.forEach(function(f) {
        lines.push("        'text!../sprites/" + f + "',");
    });
    lines.push("        ], function() {");
    lines.push("    var sprites = {};");
    lines.push("    _.each(arguments, function(spriteJson) {");
    lines.push("        var sprite = JSON.parse(spriteJson);");
    lines.push("        sprites[sprite.id] = sprite;");
    lines.push("    });");
    lines.push("    return sprites;");
    lines.push("});");
    lines.push("");

    try {
        fs.writeFileSync(SPRITES_GENERATED, lines.join("\n"));
        return { ok: true, file: 'client/js/sprites.generated.js', count: files.length };
    } catch(e) {
        return { ok: false, error: e.message };
    }
};

/**
 * Imports (or updates) an entity sprite: writes the sprite JSON with a correct
 * `id` (== filename), the provided per-scale PNGs, and regenerates the client
 * sprite manifest. Any of scales 1/2/3 may be omitted (the caller/generate
 * logic supplies them); missing ones are simply not written.
 *
 * payload: { id, width, height, animations, offset_x, offset_y,
 *            pngs: { "1": base64, "2": base64, "3": base64 } }
 */
Editor.importSprite = function(payload) {
    if(!payload || typeof payload.id !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(payload.id)) {
        return { ok: false, error: 'Invalid sprite id (use letters, digits, - or _).' };
    }
    if(typeof payload.width !== 'number' || typeof payload.height !== 'number'
       || payload.width <= 0 || payload.height <= 0) {
        return { ok: false, error: 'width and height must be positive numbers.' };
    }

    var id = payload.id,
        jsonPath = path.join(SPRITES_DIR, id + '.json'),
        written = [];

    var jsonObj = {
        id: id,
        width: payload.width,
        height: payload.height,
        animations: payload.animations || { idle: { length: 1, row: 0 } },
        offset_x: payload.offset_x || 0,
        offset_y: payload.offset_y || 0
    };

    try {
        fs.writeFileSync(jsonPath, JSON.stringify(jsonObj, null, '\t') + '\n');
        written.push('client/sprites/' + id + '.json');

        var pngs = payload.pngs || {};
        var anyPng = false;
        [1, 2, 3].forEach(function(s) {
            var b64 = pngs[s] || pngs[String(s)];
            if(!b64) { return; }
            var dir = path.join(IMG_DIR, String(s));
            fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(path.join(dir, id + '.png'), Buffer.from(b64, 'base64'));
            written.push('client/img/' + s + '/' + id + '.png');
            anyPng = true;
        });
        if(!anyPng) { return { ok: false, error: 'No PNG data provided for any scale.' }; }

        var man = Editor.regenerateSpritesManifest();
        if(man.ok) { written.push(man.file); }
    } catch(e) {
        return { ok: false, error: e.message };
    }

    return { ok: true, written: written, id: id };
};

/**
 * Imports a new TERRAIN TILE: the browser has already composited the new tile
 * into all three tilesheet PNGs (appended at the end, so existing tile ids are
 * unchanged) and uploads the resulting sheets here. We write the sheets and
 * register the tile's id->name in `client/maps/tiles.json`.
 *
 * payload: { id:number, name:string, sheets: { "1": base64, "2": base64, "3": base64 } }
 */
Editor.importTile = function(payload) {
    if(!payload || typeof payload.id !== 'number' || payload.id < 1) {
        return { ok: false, error: 'Invalid tile id.' };
    }
    var sheets = payload.sheets || {};
    if(!sheets[1] && !sheets['1']) {
        return { ok: false, error: 'Missing tilesheet PNGs.' };
    }

    var written = [];
    try {
        [1, 2, 3].forEach(function(s) {
            var b64 = sheets[s] || sheets[String(s)];
            if(!b64) { return; }
            var abs = path.join(IMG_DIR, String(s), 'tilesheet.png');
            fs.writeFileSync(abs, Buffer.from(b64, 'base64'));
            written.push('client/img/' + s + '/tilesheet.png');
        });

        // Update the tile name registry.
        var regPath = path.join(ROOT, 'client/maps/tiles.json');
        var reg = {};
        try { reg = JSON.parse(fs.readFileSync(regPath, 'utf8')); } catch(e) { reg = {}; }
        reg[String(payload.id)] = payload.name || ('tile ' + payload.id);
        fs.writeFileSync(regPath, JSON.stringify(reg, null, 4) + '\n');
        written.push('client/maps/tiles.json');
    } catch(e) {
        return { ok: false, error: e.message };
    }

    return { ok: true, id: payload.id, written: written };
};

/**
 * Reads a JSON file (used by the editor to load the current state). Only
 * allowed under the allowed roots.
 */
Editor.readJsonFile = function(relPath) {
    var abs = Editor.resolveSafe(relPath);
    if(!abs) { return null; }
    try {
        return JSON.parse(fs.readFileSync(abs, 'utf8'));
    } catch(e) {
        return null;
    }
};

Editor.handleRequest = function(request, response, pathname) {
    var sendJson = function(code, obj) {
        response.writeHead(code, {'Content-Type': 'application/json; charset=utf-8'});
        response.end(JSON.stringify(obj));
    };

    if(request.method === 'POST' && pathname === '/editor/api/save') {
        Editor._readBody(request, function(err, body) {
            if(err) { return sendJson(400, { ok: false, error: 'Bad body' }); }
            var payload;
            try { payload = JSON.parse(body); } catch(e) { return sendJson(400, { ok: false, error: 'Invalid JSON' }); }

            var result = { ok: true, written: [], restartRequired: false };
            if(payload.clientMap) {
                var r1 = Editor.saveClientMap(payload.clientMap);
                if(!r1.ok) { return sendJson(400, r1); }
                result.written.push(r1.file, r1.jsFile);
            }
            if(payload.serverMap) {
                var r2 = Editor.saveServerMap(payload.serverMap);
                if(!r2.ok) { return sendJson(400, r2); }
                result.written.push(r2.file);
                result.restartRequired = true;
            }
            if(payload.files && Array.isArray(payload.files)) {
                for(var i = 0; i < payload.files.length; i++) {
                    var f = payload.files[i] || {};
                    var r3 = Editor.saveJsonFile(f.path, f.data);
                    if(!r3.ok) { return sendJson(400, r3); }
                    result.written.push(r3.file);
                }
            }
            sendJson(200, result);
        });
        return true;
    }

    if(request.method === 'POST' && pathname === '/editor/api/asset') {
        Editor._readBody(request, function(err, body) {
            if(err) { return sendJson(400, { ok: false, error: 'Bad body' }); }
            var payload;
            try { payload = JSON.parse(body); } catch(e) { return sendJson(400, { ok: false, error: 'Invalid JSON' }); }
            var r = Editor.saveBinaryFile(payload.path, payload.base64);
            sendJson(r.ok ? 200 : 400, r);
        });
        return true;
    }

    if(request.method === 'GET' && pathname === '/editor/api/load') {
        // Handy for reloading saved state; not strictly required (editor can GET the JSON directly).
        sendJson(200, {
            clientMap: Editor.readJsonFile('client/maps/world_client.json'),
            serverMap: Editor.readJsonFile('server/maps/world_server.json'),
            npcs: Editor.readJsonFile('shared/data/npcs.json'),
            tiles: Editor.readJsonFile('client/maps/tiles.json') || {}
        });
        return true;
    }

    if(request.method === 'GET' && pathname === '/editor/api/sprites') {
        sendJson(200, { ok: true, sprites: Editor.listSprites() });
        return true;
    }

    if(request.method === 'POST' && pathname === '/editor/api/import-sprite') {
        Editor._readBody(request, function(err, body) {
            if(err) { return sendJson(400, { ok: false, error: 'Bad body' }); }
            var payload;
            try { payload = JSON.parse(body); } catch(e) { return sendJson(400, { ok: false, error: 'Invalid JSON' }); }
            var r = Editor.importSprite(payload);
            sendJson(r.ok ? 200 : 400, r);
        });
        return true;
    }

    if(request.method === 'POST' && pathname === '/editor/api/import-tile') {
        Editor._readBody(request, function(err, body) {
            if(err) { return sendJson(400, { ok: false, error: 'Bad body' }); }
            var payload;
            try { payload = JSON.parse(body); } catch(e) { return sendJson(400, { ok: false, error: 'Invalid JSON' }); }
            var r = Editor.importTile(payload);
            sendJson(r.ok ? 200 : 400, r);
        });
        return true;
    }

    return false;
};

Editor._readBody = function(request, callback) {
    var chunks = [];
    var total = 0;
    var LIMIT = 64 * 1024 * 1024; // 64MB
    request.on('data', function(c) {
        total += c.length;
        if(total > LIMIT) { request.destroy(); callback(new Error('too large')); return; }
        chunks.push(c);
    });
    request.on('end', function() { callback(null, Buffer.concat(chunks).toString('utf8')); });
    request.on('error', function(e) { callback(e); });
};

module.exports = Editor;
