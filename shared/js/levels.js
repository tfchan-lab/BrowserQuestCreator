
/**
 * Experience / level / stat system (shared between server and client).
 *
 * All curves are LINEAR for now. Values are intentionally simple and centralized
 * here so they can be tuned or replaced (e.g. non-linear curves, per-class
 * modifiers) without touching gameplay code.
 *
 * Works as a Node module and as a browser global/module (like gametypes.js).
 */

(function() {

    var isNode = (typeof module !== 'undefined' && typeof require === 'function');

    var Levels = {};

    // -----------------------------------------------------------------------
    // Tunables (linear)
    // -----------------------------------------------------------------------

    Levels.MAX_LEVEL = 255;

    // Stats. Order matters for the protocol array encoding.
    Levels.STATS = ['vigor', 'mind', 'endurance', 'strength', 'dexterity', 'intelligence', 'faith', 'arcane'];

    // Level-1 baseline for every stat.
    Levels.BASE_STAT = 10;

    // Linear per-level growth while levelling (auto stat curve). Players also get
    // Levels.STAT_POINTS_PER_LEVEL points to allocate manually on top of this.
    Levels.STAT_GROWTH = {
        vigor: 2,
        mind: 1,
        endurance: 1,
        strength: 2,
        dexterity: 1,
        intelligence: 1,
        faith: 1,
        arcane: 1
    };

    Levels.STAT_POINTS_PER_LEVEL = 1;

    // XP required to go from level n to n+1: BASE + (n-1)*STEP (linear).
    Levels.XP_BASE = 50;
    Levels.XP_STEP = 50;

    // Party discount: perMemberXP = round(baseXP / partySize) — but higher-level
    // players get proportionally less (their level share of the discount).
    // (See Levels.splitKillXP.)

    // -----------------------------------------------------------------------
    // Level curve
    // -----------------------------------------------------------------------

    /** XP needed to advance FROM `level` to `level+1`. */
    Levels.xpToNextFrom = function(level) {
        return Levels.XP_BASE + (level - 1) * Levels.XP_STEP;
    };

    /** Total cumulative XP required to reach `level` (level 1 => 0). */
    Levels.totalXPForLevel = function(level) {
        var total = 0;
        for(var n = 1; n < level && n < Levels.MAX_LEVEL; n++) {
            total += Levels.xpToNextFrom(n);
        }
        return total;
    };

    /** Returns { level, xp (into current level), xpToNext } for a total XP amount. */
    Levels.progressForXP = function(totalXp) {
        var level = 1, remaining = Math.max(0, totalXp | 0);
        while(level < Levels.MAX_LEVEL) {
            var need = Levels.xpToNextFrom(level);
            if(remaining < need) { break; }
            remaining -= need;
            level += 1;
        }
        return {
            level: level,
            xp: remaining,
            xpToNext: (level >= Levels.MAX_LEVEL) ? 0 : Levels.xpToNextFrom(level)
        };
    };

    Levels.levelForXP = function(totalXp) {
        return Levels.progressForXP(totalXp).level;
    };

    // -----------------------------------------------------------------------
    // Stat curves
    // -----------------------------------------------------------------------

    /** Auto (level-derived) value of a single stat at a given level. */
    Levels.autoStatValue = function(stat, level) {
        var growth = Levels.STAT_GROWTH[stat] || 0;
        return Levels.BASE_STAT + Math.max(0, level - 1) * growth;
    };

    /**
     * Computes the player's stat totals.
     * @param {number} level
     * @param {Object} allocated  optional manual allocation per stat (extra points)
     * @returns {Object} { vigor: n, mind: n, ... }
     */
    Levels.computeStats = function(level, allocated) {
        allocated = allocated || {};
        var out = {};
        Levels.STATS.forEach(function(stat) {
            out[stat] = Levels.autoStatValue(stat, level) + (allocated[stat] | 0);
        });
        return out;
    };

    /** Points available to allocate given level and how many were already spent. */
    Levels.availablePoints = function(level, spent) {
        var earned = Math.max(0, level - 1) * Levels.STAT_POINTS_PER_LEVEL;
        return Math.max(0, earned - (spent | 0));
    };

    Levels.totalAllocated = function(allocated) {
        var sum = 0;
        allocated = allocated || {};
        Levels.STATS.forEach(function(stat) { sum += (allocated[stat] | 0); });
        return sum;
    };

    // -----------------------------------------------------------------------
    // Combat integration
    // -----------------------------------------------------------------------

    /** Max HP = (armorBase + vigorBonus) * multipliers. */
    Levels.maxHitPoints = function(armorMaxHp, stats, multiplier) {
        var vigor = (stats && stats.vigor) || Levels.BASE_STAT;
        var base = (armorMaxHp | 0) + (vigor - Levels.BASE_STAT) * Levels.HP_PER_VIGOR;
        return Math.max(1, Math.round(base * (multiplier || 1)));
    };

    Levels.HP_PER_VIGOR = 2;

    /** Attack power for a weapon level scaled by Strength. */
    Levels.attackPower = function(weaponLevel, stats, multiplier) {
        var strength = (stats && stats.strength) || Levels.BASE_STAT;
        var scaled = (weaponLevel | 0) * (1 + (strength - Levels.BASE_STAT) * Levels.ATK_PER_STRENGTH);
        return scaled * (multiplier || 1);
    };

    Levels.ATK_PER_STRENGTH = 0.05;

    // -----------------------------------------------------------------------
    // Cooperative XP split
    // -----------------------------------------------------------------------

    /**
     * Splits a mob's base XP among contributing players.
     *
     * Base rule: each member gets baseXP / partySize (linear discount).
     * Higher-level players get a proportionally larger discount; lower-level
     * players get a smaller discount and thus a larger share.
     *
     * Concretely, weight_i = 1 / level_i (lower level -> higher weight), and each
     * member's share = partyTotal * weight_i / sum(weights), where partyTotal is
     * the base XP divided by the number of members (so total awarded ≈ baseXP,
     * just redistributed toward lower-level players).
     *
     * @param {number} baseXP
     * @param {Array<{id:number, level:number}>} members
     * @returns {Array<{id:number, xp:number}>}
     */
    Levels.splitKillXP = function(baseXP, members) {
        members = members || [];
        if(members.length === 0 || baseXP <= 0) { return []; }

        var n = members.length,
            partyTotal = baseXP / n,
            weightSum = 0;

        members.forEach(function(m) {
            var lvl = Math.max(1, m.level | 0);
            m._w = 1 / lvl;
            weightSum += m._w;
        });

        return members.map(function(m) {
            var share = Math.round(partyTotal * (m._w / weightSum) * n);
            // Guard: never award more than the full base XP to a single member.
            if(share > baseXP) { share = baseXP; }
            return { id: m.id, xp: share };
        });
    };

    // -----------------------------------------------------------------------
    // Validation (for client-persisted progression)
    // -----------------------------------------------------------------------

    /**
     * Sanitizes a total XP value from the client. Clamps to the max reachable XP.
     */
    Levels.sanitizeXP = function(totalXp) {
        if(typeof totalXp !== 'number' || !isFinite(totalXp) || totalXp < 0) { return 0; }
        return Math.min(Math.floor(totalXp), Levels.totalXPForLevel(Levels.MAX_LEVEL));
    };

    /**
     * Sanitizes a stat allocation object: only known stats, non-negative ints,
     * and total spent cannot exceed the points earned at the given level.
     */
    Levels.sanitizeAllocation = function(allocated, level) {
        var out = {};
        Levels.STATS.forEach(function(stat) { out[stat] = 0; });
        if(!allocated || typeof allocated !== 'object') { return out; }

        var budget = Math.max(0, level - 1) * Levels.STAT_POINTS_PER_LEVEL;

        // Copy non-negative ints first.
        Levels.STATS.forEach(function(stat) {
            var v = allocated[stat];
            if(typeof v === 'number' && isFinite(v) && v > 0) {
                out[stat] = Math.floor(v);
            }
        });

        // If over budget, scale down deterministically.
        var total = Levels.totalAllocated(out);
        if(total > budget) {
            Levels.STATS.forEach(function(stat) {
                out[stat] = budget > 0 ? Math.floor(out[stat] * budget / total) : 0;
            });
            // Distribute any rounding remainder up to the budget.
            var used = Levels.totalAllocated(out), i = 0;
            while(used < budget) {
                out[Levels.STATS[i % Levels.STATS.length]] += 1;
                used += 1;
                i += 1;
            }
        }

        return out;
    };

    // -----------------------------------------------------------------------
    // Export
    // -----------------------------------------------------------------------

    var root = (typeof window !== 'undefined') ? window : (typeof global !== 'undefined' ? global : this);
    if(root) { root.Levels = Levels; }

    if(typeof module !== 'undefined' && module.exports) {
        module.exports = Levels;
    } else if(typeof define === 'function' && define.amd) {
        define(function() { return Levels; });
    }

})();
