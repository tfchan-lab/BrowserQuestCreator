
/**
 * Equipment loader (works as a classic global script and as a Node module).
 *
 * Human-edited source: `shared/data/equipment.json`.
 * For the browser, a build step generates `shared/js/equipment-data.js`
 * (which defines `BQ_EQUIPMENT_DATA`) so loading is synchronous. In Node the
 * JSON is read directly if the generated file is absent.
 *
 * Supports arbitrary equipment categories declared in the JSON `types` object
 * (e.g. "weapon", "armor", and future "deco", "ring", ...). Each category is an
 * array keyed by its plural name in the data file (weapon -> `weapons`).
 */

(function() {

    var isNode = (typeof module !== 'undefined' && typeof require === 'function');

    // Resolve `Types` lazily. In the browser, `equipment.js` may execute before
    // `gametypes.js` has set `window.Types`, so we must not capture it at module
    // evaluation time.
    function getTypes() {
        if(isNode) { return require('./gametypes'); }
        return (typeof window !== 'undefined') ? window.Types : undefined;
    }

    var Equipment = {};

    // -----------------------------------------------------------------------
    // Data source
    // -----------------------------------------------------------------------

    Equipment.getRawData = function() {
        if(typeof BQ_EQUIPMENT_DATA !== 'undefined') {
            return BQ_EQUIPMENT_DATA;
        }
        if(isNode) {
            var fs = require('fs'),
                path = require('path'),
                filepath = path.resolve(__dirname, '../data/equipment.json');
            return JSON.parse(fs.readFileSync(filepath, 'utf8'));
        }
        throw new Error("BQ_EQUIPMENT_DATA is not defined; run the equipment build step.");
    };

    // -----------------------------------------------------------------------
    // Normalization
    // -----------------------------------------------------------------------

    Equipment.normalize = function(raw) {
        var types = raw.types || {},
            items = {},
            byName = {},
            byType = {};

        Object.keys(types).forEach(function(typeName) {
            byType[typeName] = [];
            var list = raw[typeName + 's'] || [];
            list.forEach(function(entry) {
                var rank = (typeof entry.rank === 'number') ? entry.rank : 0;
                var item = {
                    id: entry.id,
                    name: entry.name,
                    type: entry.type || typeName,
                    subtype: entry.subtype || entry.name,
                    rank: rank,
                    level: (typeof entry.level === 'number') ? entry.level : rank,
                    maxHp: (typeof entry.maxHp === 'number') ? entry.maxHp : null,
                    sprite: entry.sprite || entry.name,
                    itemSprite: entry.itemSprite || ('item-' + entry.name),
                    lootMessage: entry.lootMessage || ('You pick up a ' + entry.name),
                    sellPrice: (typeof entry.sellPrice === 'number') ? entry.sellPrice : undefined
                };
                items[item.id] = item;
                byName[item.name] = item;
                byType[typeName].push(item);
            });

            byType[typeName].sort(function(a, b) { return a.rank - b.rank; });
        });

        return {
            types: types,
            items: items,
            byName: byName,
            byType: byType
        };
    };

    // -----------------------------------------------------------------------
    // Registry + Types integration
    // -----------------------------------------------------------------------

    Equipment.registry = null;
    Equipment.ranked = {};

    /**
     * Loads/normalizes the equipment data and installs it into `Types`.
     *
     * Normalization is cached, but the *installation* into `Types` is re-run on
     * every call. This is important in the browser: `equipment.js` may execute
     * before `gametypes.js` defines the global `Types`, and the AMD factory calls
     * `load()` again once `Types` is available — the registration must not be
     * skipped just because the registry was already built.
     */
    Equipment.load = function(rawData) {
        if(!Equipment.registry) {
            Equipment.registry = Equipment.normalize(rawData || Equipment.getRawData());
        }

        var reg = Equipment.registry,
            Types = getTypes(); // resolve lazily (may have just become available)

        if(!Types) {
            // Cannot install yet (browser, Types not loaded). Call again later.
            return reg;
        }

        Object.keys(reg.byType).forEach(function(typeName) {
            Equipment.ranked[typeName] = [];
            reg.byType[typeName].forEach(function(item) {
                Types.Entities[item.name.toUpperCase()] = item.id;
                if(Types.registerKind) {
                    Types.registerKind(item.id, item.name, item.type);
                }
                Equipment.ranked[typeName].push(item.id);
            });
        });

        if(Equipment.ranked.weapon) { Types.rankedWeapons = Equipment.ranked.weapon; }
        if(Equipment.ranked.armor) { Types.rankedArmors = Equipment.ranked.armor; }

        return reg;
    };

    // -----------------------------------------------------------------------
    // Lookups
    // -----------------------------------------------------------------------

    Equipment.getItem = function(kind) {
        Equipment.load();
        return Equipment.registry.items[kind] || null;
    };
    Equipment.getItemByName = function(name) {
        Equipment.load();
        return Equipment.registry.byName[name] || null;
    };
    Equipment.getTypeItems = function(typeName) {
        Equipment.load();
        return Equipment.registry.byType[typeName] || [];
    };
    Equipment.getTypes = function() {
        Equipment.load();
        return Equipment.registry.types;
    };
    Equipment.getRank = function(kind) {
        var item = Equipment.getItem(kind);
        return item ? item.rank : undefined;
    };
    Equipment.getLevel = function(kind) {
        var item = Equipment.getItem(kind);
        return item ? item.level : undefined;
    };
    Equipment.getMaxHitPoints = function(kind) {
        var item = Equipment.getItem(kind);
        return (item && item.maxHp != null) ? item.maxHp : undefined;
    };
    Equipment.getLootMessage = function(kind) {
        var item = Equipment.getItem(kind);
        return item ? item.lootMessage : undefined;
    };
    Equipment.getSpriteName = function(kind) {
        var item = Equipment.getItem(kind);
        return item ? item.sprite : undefined;
    };
    Equipment.getItemSpriteName = function(kind) {
        var item = Equipment.getItem(kind);
        return item ? item.itemSprite : undefined;
    };
    /**
     * Sell value for a gear kind. Uses the data-driven `sellPrice` when present,
     * otherwise falls back to a rank-based default (5 gold per rank).
     */
    Equipment.getSellPrice = function(kind) {
        var item = Equipment.getItem(kind);
        if(!item) { return 0; }
        if(typeof item.sellPrice === 'number') { return item.sellPrice; }
        return (item.rank || 1) * 5;
    };

    var root = (typeof window !== 'undefined') ? window : (typeof global !== 'undefined' ? global : this);
    if(root) { root.Equipment = Equipment; }

    // Self-initialize when data is available (generated file in browser, JSON in
    // Node). Safe to call again later; load() is idempotent.
    try {
        if(typeof BQ_EQUIPMENT_DATA !== 'undefined' || isNode) {
            Equipment.load();
        }
    } catch(e) {
        // In the browser before equipment-data.js is loaded, defer until first use.
    }

    if(typeof module !== 'undefined' && module.exports) {
        module.exports = Equipment;
    } else if(typeof define === 'function' && define.amd) {
        // Ensure gametypes (global Types) and the generated inline data are both
        // loaded before the loader is used, then (re)initialize.
        define(['../../shared/js/gametypes', './equipment-data'], function() {
            try { Equipment.load(); } catch(e) { /* data unavailable */ }
            return Equipment;
        });
    }

})();
