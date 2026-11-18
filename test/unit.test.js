// Unit tests for pure, single-function logic.
// Run with: npm run test   (node --test)
//
// These cover the deterministic helpers whose behaviour can be verified by
// calling one function with known inputs. Anything that needs a live client,
// browser, or websocket is intentionally excluded (those are integration tests).

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const req = (p) => require(path.join(ROOT, p));

// Some shared modules touch a global `log`; provide a no-op.
global.log = global.log || { error() {}, debug() {}, info() {} };

const Formulas = req('server/js/formulas.js');
const Equipment = req('shared/js/equipment.js');
const Types = req('shared/js/gametypes.js');
const Levels = req('shared/js/levels.js');

const kindOf = (name) => Types.getKindFromString(name);

// ---------------------------------------------------------------------------
// server/js/formulas.js
// ---------------------------------------------------------------------------
test('Formulas.hp: 80 + (armorLevel-1)*30', () => {
    assert.strictEqual(Formulas.hp(1), 80);
    assert.strictEqual(Formulas.hp(2), 110);
    assert.strictEqual(Formulas.hp(3), 140);
    assert.strictEqual(Formulas.hp(5), 200);
});

test('Formulas.dmg: always a non-negative integer within plausible bounds', () => {
    for (let i = 0; i < 500; i++) {
        const d = Formulas.dmg(5, 2); // attackPower 5, armor 2
        assert.ok(Number.isInteger(d), 'dmg must be an integer, got ' + d);
        assert.ok(d >= 0, 'dmg must be >= 0, got ' + d);
        // Max possible: 5*10 = 50; min floor path returns 0..3.
        assert.ok(d <= 50, 'dmg must be <= attackPower*10, got ' + d);
    }
});

test('Formulas.dmg: low attack vs high armor floors to 0..3', () => {
    for (let i = 0; i < 200; i++) {
        const d = Formulas.dmg(1, 100); // guaranteed <= 0 before the floor branch
        assert.ok(d >= 0 && d <= 3, 'expected 0..3, got ' + d);
    }
});

// ---------------------------------------------------------------------------
// shared/js/gametypes.js (pure lookups)
// ---------------------------------------------------------------------------
test('Types.getKindFromString / getKindAsString round-trip', () => {
    ['rat', 'skeleton', 'boss', 'bat', 'sword1', 'axe'].forEach((name) => {
        const kind = Types.getKindFromString(name);
        assert.strictEqual(typeof kind, 'number', name + ' should map to a number');
        assert.strictEqual(Types.getKindAsString(kind), name);
    });
});

test('Types.getMobAttackRange / getMobAttackInterval defaults', () => {
    const rat = kindOf('rat');
    assert.strictEqual(Types.getMobAttackRange(rat), Types.DEFAULT_MOB_ATTACK_RANGE);
    assert.strictEqual(Types.getMobAttackInterval(rat), Types.DEFAULT_MOB_ATTACK_INTERVAL);
    // Unknown kind falls back to defaults.
    assert.strictEqual(Types.getMobAttackRange(999999), Types.DEFAULT_MOB_ATTACK_RANGE);
    assert.strictEqual(Types.getMobAttackInterval(999999), Types.DEFAULT_MOB_ATTACK_INTERVAL);
});

// ---------------------------------------------------------------------------
// shared/js/equipment.js (pure combat/price lookups)
// ---------------------------------------------------------------------------
test('Equipment.getAttackRange by subtype (sword 1.5, club 1, axe 2)', () => {
    assert.strictEqual(Equipment.getAttackRange(kindOf('sword1')), 1.5);
    assert.strictEqual(Equipment.getAttackRange(kindOf('axe')), 2);
    // morningstar is a club subtype -> 1
    assert.strictEqual(Equipment.getAttackRange(kindOf('morningstar')), 1);
});

test('Equipment.getAttackInterval by subtype (sword 800, club 600, axe 1100)', () => {
    assert.strictEqual(Equipment.getAttackInterval(kindOf('sword1')), 800);
    assert.strictEqual(Equipment.getAttackInterval(kindOf('morningstar')), 600);
    assert.strictEqual(Equipment.getAttackInterval(kindOf('axe')), 1100);
});

test('Equipment.getAttackRange/Interval: unknown kind -> defaults', () => {
    assert.strictEqual(Equipment.getAttackRange(999999), Equipment.DEFAULT_COMBAT.range);
    assert.strictEqual(Equipment.getAttackInterval(999999), Equipment.DEFAULT_COMBAT.interval);
});

test('Equipment.getSellPrice: explicit value, fallback rank*5, unknown -> 0', () => {
    assert.strictEqual(Equipment.getSellPrice(kindOf('sword1')), 5); // rank 1 * 5
    assert.strictEqual(Equipment.getSellPrice(999999), 0);
});

// ---------------------------------------------------------------------------
// shared/js/levels.js (level curve, stats, XP)
// ---------------------------------------------------------------------------
test('Levels.xpToNextFrom: BASE + (level-1)*STEP', () => {
    assert.strictEqual(Levels.xpToNextFrom(1), Levels.XP_BASE);
    assert.strictEqual(Levels.xpToNextFrom(2), Levels.XP_BASE + Levels.XP_STEP);
    assert.strictEqual(Levels.xpToNextFrom(5), Levels.XP_BASE + 4 * Levels.XP_STEP);
});

test('Levels.totalXPForLevel: level 1 is 0, cumulative sums', () => {
    assert.strictEqual(Levels.totalXPForLevel(1), 0);
    assert.strictEqual(Levels.totalXPForLevel(2), Levels.xpToNextFrom(1));
    assert.strictEqual(Levels.totalXPForLevel(3), Levels.xpToNextFrom(1) + Levels.xpToNextFrom(2));
});

test('Levels.progressForXP: level/xp/xpToNext consistency', () => {
    const p0 = Levels.progressForXP(0);
    assert.deepStrictEqual({ level: p0.level, xp: p0.xp }, { level: 1, xp: 0 });

    const needForL2 = Levels.xpToNextFrom(1);
    const justLevel2 = Levels.progressForXP(needForL2);
    assert.strictEqual(justLevel2.level, 2);
    assert.strictEqual(justLevel2.xp, 0);

    const almostL2 = Levels.progressForXP(needForL2 - 1);
    assert.strictEqual(almostL2.level, 1);
    assert.strictEqual(almostL2.xp, needForL2 - 1);
});

test('Levels.levelForXP agrees with progressForXP().level', () => {
    [0, 49, 50, 149, 500, 5000].forEach((xp) => {
        assert.strictEqual(Levels.levelForXP(xp), Levels.progressForXP(xp).level);
    });
});

test('Levels.autoStatValue and computeStats: baseline + growth + allocation', () => {
    assert.strictEqual(Levels.autoStatValue('vigor', 1), Levels.BASE_STAT);
    assert.strictEqual(Levels.autoStatValue('vigor', 2), Levels.BASE_STAT + Levels.STAT_GROWTH.vigor);

    const stats = Levels.computeStats(1, {});
    Levels.STATS.forEach((s) => assert.strictEqual(stats[s], Levels.BASE_STAT));

    const stats2 = Levels.computeStats(1, { vigor: 3 });
    assert.strictEqual(stats2.vigor, Levels.BASE_STAT + 3);
});

test('Levels.availablePoints / totalAllocated', () => {
    assert.strictEqual(Levels.availablePoints(1, 0), 0);
    assert.strictEqual(Levels.availablePoints(3, 0), 2 * Levels.STAT_POINTS_PER_LEVEL);
    assert.strictEqual(Levels.availablePoints(3, 1), 2 * Levels.STAT_POINTS_PER_LEVEL - 1);
    assert.strictEqual(Levels.totalAllocated({ vigor: 2, mind: 1 }), 3);
});

test('Levels.maxHitPoints: base + vigor bonus, min 1', () => {
    const stats = { vigor: Levels.BASE_STAT };
    assert.strictEqual(Levels.maxHitPoints(80, stats), 80);
    const stronger = { vigor: Levels.BASE_STAT + 5 };
    assert.strictEqual(Levels.maxHitPoints(80, stronger), 80 + 5 * Levels.HP_PER_VIGOR);
    assert.ok(Levels.maxHitPoints(0, { vigor: 0 }) >= 1);
});

test('Levels.attackPower: weaponLevel scaled by strength', () => {
    const base = { strength: Levels.BASE_STAT };
    assert.strictEqual(Levels.attackPower(10, base), 10);
    const stronger = { strength: Levels.BASE_STAT + 10 };
    const expected = 10 * (1 + 10 * Levels.ATK_PER_STRENGTH);
    assert.strictEqual(Levels.attackPower(10, stronger), expected);
});

test('Levels.splitKillXP: empty/no base -> [], total never exceeds base', () => {
    assert.deepStrictEqual(Levels.splitKillXP(0, [{ id: 1, level: 1 }]), []);
    assert.deepStrictEqual(Levels.splitKillXP(100, []), []);
    const shares = Levels.splitKillXP(100, [{ id: 1, level: 1 }, { id: 2, level: 5 }]);
    assert.strictEqual(shares.length, 2);
    shares.forEach((s) => {
        assert.ok(s.xp >= 0);
        assert.ok(s.xp <= 100);
    });
    // Lower level gets the larger share.
    assert.ok(shares[0].xp >= shares[1].xp);
});

test('Levels.sanitizeXP: clamps invalid/negative/oversized', () => {
    assert.strictEqual(Levels.sanitizeXP(-5), 0);
    assert.strictEqual(Levels.sanitizeXP('abc'), 0);
    assert.strictEqual(Levels.sanitizeXP(NaN), 0);
    assert.strictEqual(Levels.sanitizeXP(12.9), 12);
    const max = Levels.totalXPForLevel(Levels.MAX_LEVEL);
    assert.strictEqual(Levels.sanitizeXP(max + 1000), max);
});

test('Levels.sanitizeAllocation: known stats only, non-negative ints, within budget', () => {
    const out = Levels.sanitizeAllocation({ vigor: 2, bogus: 5, mind: -3 }, 5);
    Levels.STATS.forEach((s) => assert.ok(out[s] >= 0));
    assert.strictEqual(out.bogus, undefined);
    assert.strictEqual(out.mind, 0); // negative dropped
    const budget = Math.max(0, 5 - 1) * Levels.STAT_POINTS_PER_LEVEL;
    assert.ok(Levels.totalAllocated(out) <= budget);
});

// ---------------------------------------------------------------------------
// server/js/properties.js (S3: sell prices for gear + consumables)
// ---------------------------------------------------------------------------
const Properties = req('server/js/properties.js');

test('S3: sell prices (sword1=5, teleportscroll=15, flask=3)', () => {
    assert.strictEqual(Properties.getSellPrice(kindOf('sword1')), 5);
    assert.strictEqual(Properties.getSellPrice(kindOf('teleportscroll')), 15);
    assert.strictEqual(Properties.getSellPrice(kindOf('flask')), 3);
});

// ---------------------------------------------------------------------------
// shared/js/gametypes.js (S2: scroll kind/storable/chest; W1: usable/warp/name)
// ---------------------------------------------------------------------------
test('S2: teleportscroll kind=56, storable, chests not storable', () => {
    const scroll = kindOf('teleportscroll');
    assert.strictEqual(scroll, 56);
    assert.strictEqual(Types.isStorableInventoryKind(scroll), true);
    assert.strictEqual(Types.isStorableInventoryKind(Types.Entities.CHEST), false);
});

test('W1: isUsableItem / warpDestinations / display name', () => {
    assert.strictEqual(Types.isUsableItem(kindOf('teleportscroll')), true);
    assert.strictEqual(Types.isUsableItem(kindOf('volcanoscroll')), true);
    assert.strictEqual(Types.isUsableItem(kindOf('flask')), false);

    assert.deepStrictEqual(Types.warpDestinations[56], { x: 16, y: 223 });
    assert.deepStrictEqual(Types.warpDestinations[57], { x: 48, y: 59 });

    assert.strictEqual(Types.getItemDisplayName(56), '[\u2605 Initial Town]');
    assert.strictEqual(Types.getItemDisplayName(57), '[\u2605 Volcano Entrance]');
});

// ---------------------------------------------------------------------------
// D1: Formulas.dmg always returns an integer (many float rolls)
// ---------------------------------------------------------------------------
test('D1: Formulas.dmg returns an integer for 20000 rolls', () => {
    let nonInt = 0;
    for (let i = 0; i < 20000; i++) {
        const d = Formulas.dmg((i % 10) + 1, (i % 5));
        if (!Number.isInteger(d)) nonInt++;
    }
    assert.strictEqual(nonInt, 0);
});

// ---------------------------------------------------------------------------
// D2: HP stays integral after repeated damage rolls
// ---------------------------------------------------------------------------
test('D2: HP stays integral after 1000 damage rolls', () => {
    let hp = 5000;
    for (let i = 0; i < 1000; i++) {
        hp -= Formulas.dmg(6, 2);
        if (hp <= 0) hp = 5000; // respawn to keep exercising
        assert.ok(Number.isInteger(hp), 'HP must stay integral, got ' + hp);
    }
});
