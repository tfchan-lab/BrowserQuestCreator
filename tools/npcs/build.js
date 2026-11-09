#!/usr/bin/env node
/**
 * NPC build/validation tool.
 *
 * Reads shared/data/npcs.json, validates it, and generates
 * shared/js/npcs-data.js (inline data for the browser client).
 *
 * Usage: node tools/npcs/build.js
 */

var fs = require('fs'),
    path = require('path');

var ROOT = path.resolve(__dirname, '../..');
var DATA_FILE = path.join(ROOT, 'shared/data/npcs.json');
var OUT_DATA = path.join(ROOT, 'shared/js/npcs-data.js');
var GAMETYPES = path.join(ROOT, 'shared/js/gametypes.js');

var errors = [];
var warnings = [];

function fail(msg) { errors.push(msg); }
function warn(msg) { warnings.push(msg); }

function readJson(file) {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}

// Known NPC kinds (from gametypes.js). Extracted loosely to validate `kind`.
function knownNpcKinds() {
    var src = fs.readFileSync(GAMETYPES, 'utf8');
    var kinds = [];
    var re = /([a-z0-9_]+):\s*\[\s*Types\.Entities\.[A-Z0-9_]+\s*,\s*"npc"\s*\]/g;
    var m;
    while((m = re.exec(src)) !== null) { kinds.push(m[1]); }
    return kinds;
}

// Known object/item kinds (non-npc, non-mob, non-gear appear as "object").
function knownItemKinds() {
    var src = fs.readFileSync(GAMETYPES, 'utf8');
    var kinds = [];
    var re = /([a-z0-9_]+):\s*\[\s*Types\.Entities\.[A-Z0-9_]+\s*,\s*"object"\s*\]/g;
    var m;
    while((m = re.exec(src)) !== null) { kinds.push(m[1]); }
    return kinds;
}

function validate(raw) {
    if(!raw || !Array.isArray(raw.npcs)) {
        fail("Missing `npcs` array.");
        return;
    }

    var seenIds = {}, seenPos = {};
    var validKinds = knownNpcKinds();

    raw.npcs.forEach(function(npc, i) {
        var where = 'npcs[' + i + ']' + (npc && npc.id ? ' (' + npc.id + ')' : '');

        if(!npc || typeof npc !== 'object') { fail(where + ': not an object.'); return; }

        if(typeof npc.id !== 'string' || !/^[a-z0-9_]+$/.test(npc.id)) {
            fail(where + ': `id` must be a lowercase string (a-z0-9_).');
        } else if(seenIds[npc.id]) {
            fail(where + ': duplicate id.');
        } else {
            seenIds[npc.id] = true;
        }

        if(typeof npc.name !== 'string' || npc.name.length === 0) {
            fail(where + ': `name` (display name) is required.');
        }

        if(typeof npc.kind !== 'string') {
            fail(where + ': `kind` is required.');
        } else if(validKinds.length && validKinds.indexOf(npc.kind) === -1) {
            fail(where + ': unknown NPC kind "' + npc.kind + '". Known: ' + validKinds.join(', '));
        }

        if(typeof npc.x !== 'number' || typeof npc.y !== 'number') {
            fail(where + ': `x` and `y` must be numbers.');
        } else {
            var posKey = npc.x + ',' + npc.y;
            if(seenPos[posKey]) {
                warn(where + ': duplicate position (' + posKey + ') — two NPCs overlap.');
            }
            seenPos[posKey] = true;
        }

        if(!Array.isArray(npc.conversations)) {
            fail(where + ': `conversations` must be an array of strings.');
        } else {
            npc.conversations.forEach(function(line, j) {
                if(typeof line !== 'string') {
                    fail(where + '.conversations[' + j + ']: must be a string.');
                }
            });
        }

        if(!Array.isArray(npc.events)) {
            fail(where + ': `events` must be an array.');
        } else {
            npc.events.forEach(function(ev, j) {
                if(!ev || typeof ev !== 'object' || typeof ev.type !== 'string') {
                    fail(where + '.events[' + j + ']: each event needs a string `type`.');
                    return;
                }
                if(ev.type === 'shop') {
                    if(!Array.isArray(ev.items)) {
                        fail(where + '.events[' + j + ']: shop event needs an `items` array.');
                        return;
                    }
                    ev.items.forEach(function(it, k) {
                        var iw = where + '.events[' + j + '].items[' + k + ']';
                        if(!it || (typeof it.kind !== 'string' && typeof it.kind !== 'number')) {
                            fail(iw + ': `kind` must be a string (name) or number (id).');
                            return;
                        }
                        if(typeof it.kind === 'string' && knownItemKinds().indexOf(it.kind) === -1) {
                            fail(iw + ': unknown item kind "' + it.kind + '".');
                        }
                        if(typeof it.price !== 'number' || it.price < 0) {
                            fail(iw + ': `price` must be a number >= 0.');
                        }
                    });
                }
            });
        }

        if(npc.idleSpeed !== undefined && typeof npc.idleSpeed !== 'number') {
            fail(where + ': `idleSpeed` must be a number.');
        }
    });
}

function generateDataFile(raw) {
    var clean = {};
    Object.keys(raw).forEach(function(k) {
        if(k.charAt(0) === '_' || k.charAt(0) === '$') { return; }
        clean[k] = raw[k];
    });
    var header = "// AUTO-GENERATED by tools/npcs/build.js from shared/data/npcs.json.\n" +
                 "// Do not edit by hand; edit the JSON and re-run `npm run npcs:build`.\n";
    var body = "var BQ_NPC_DATA = " + JSON.stringify(clean, null, 4) + ";\n";
    fs.writeFileSync(OUT_DATA, header + body);
}

function main() {
    var raw;
    try {
        raw = readJson(DATA_FILE);
    } catch(e) {
        console.error("Could not read " + DATA_FILE + ": " + e.message);
        process.exit(1);
    }

    validate(raw);

    warnings.forEach(function(w) { console.log("WARN: " + w); });
    if(errors.length) {
        errors.forEach(function(e) { console.error("ERROR: " + e); });
        console.error("\nNPC build FAILED with " + errors.length + " error(s). No files written.");
        process.exit(1);
    }

    generateDataFile(raw);

    console.log("NPC build OK: " + raw.npcs.length + " NPC(s).");
    console.log("  wrote " + path.relative(ROOT, OUT_DATA));
}

main();
