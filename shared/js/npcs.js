
/**
 * NPC loader (works as a classic global script and as a Node module).
 *
 * Human-edited source: `shared/data/npcs.json`.
 * For the browser, a build step generates `shared/js/npcs-data.js` (which defines
 * `BQ_NPC_DATA`) so loading is synchronous. In Node the JSON is read directly.
 *
 * Each NPC has: id, name, kind (sprite), x/y (grid coords), conversations
 * (array of strings), events (array), optional idleSpeed.
 */

(function() {

    var isNode = (typeof module !== 'undefined' && typeof require === 'function');

    var NPCs = {};

    // -----------------------------------------------------------------------
    // Data source
    // -----------------------------------------------------------------------

    NPCs.getRawData = function() {
        if(typeof BQ_NPC_DATA !== 'undefined') {
            return BQ_NPC_DATA;
        }
        if(isNode) {
            var fs = require('fs'),
                path = require('path'),
                filepath = path.resolve(__dirname, '../data/npcs.json');
            return JSON.parse(fs.readFileSync(filepath, 'utf8'));
        }
        throw new Error("BQ_NPC_DATA is not defined; run the npc build step.");
    };

    // -----------------------------------------------------------------------
    // Normalization / registry
    // -----------------------------------------------------------------------

    NPCs.registry = null;

    NPCs.normalize = function(raw) {
        var list = (raw && raw.npcs) || [],
            byId = {},
            byPos = {},
            all = [];

        list.forEach(function(entry) {
            var npc = {
                id: entry.id,
                name: entry.name,
                kind: entry.kind,
                x: entry.x,
                y: entry.y,
                idleSpeed: (typeof entry.idleSpeed === 'number') ? entry.idleSpeed : null,
                conversations: (entry.conversations || []).slice(),
                events: (entry.events || []).slice()
            };
            byId[npc.id] = npc;
            byPos[npc.x + ',' + npc.y] = npc;
            all.push(npc);
        });

        return { all: all, byId: byId, byPos: byPos };
    };

    NPCs.load = function(rawData) {
        if(!NPCs.registry) {
            NPCs.registry = NPCs.normalize(rawData || NPCs.getRawData());
        }
        return NPCs.registry;
    };

    // -----------------------------------------------------------------------
    // Lookups
    // -----------------------------------------------------------------------

    NPCs.getAll = function() {
        return NPCs.load().all;
    };

    NPCs.getById = function(id) {
        return NPCs.load().byId[id] || null;
    };

    NPCs.getAt = function(x, y) {
        return NPCs.load().byPos[x + ',' + y] || null;
    };

    /**
     * Returns the first shop event configured on an NPC config, or null.
     * A shop event looks like: { type: "shop", items: [{ kind, price }] }.
     */
    NPCs.getShop = function(npcOrId) {
        var npc = (typeof npcOrId === 'string') ? NPCs.getById(npcOrId) : npcOrId;
        if(!npc || !npc.events) { return null; }
        for(var i = 0; i < npc.events.length; i++) {
            var ev = npc.events[i];
            if(ev && ev.type === 'shop') { return ev; }
        }
        return null;
    };

    // -----------------------------------------------------------------------
    // Export
    // -----------------------------------------------------------------------

    var root = (typeof window !== 'undefined') ? window : (typeof global !== 'undefined' ? global : this);
    if(root) { root.NPCs = NPCs; }

    // Self-initialize when data is available.
    try {
        if(typeof BQ_NPC_DATA !== 'undefined' || isNode) {
            NPCs.load();
        }
    } catch(e) {
        // In the browser before npcs-data.js is loaded, defer until first use.
    }

    if(typeof module !== 'undefined' && module.exports) {
        module.exports = NPCs;
    } else if(typeof define === 'function' && define.amd) {
        define(['./npcs-data'], function() {
            try { NPCs.load(); } catch(e) { /* data unavailable */ }
            return NPCs;
        });
    }

})();
