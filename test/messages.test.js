// Unit tests for server message serializers (Messages.*.serialize()).
// These are pure: given an entity/stub, the output array is fully determined.
// Covers M1, M2, M3, M8, M9, S4 (and the Mob HP state used by spawn).

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const req = (p) => require(path.join(ROOT, p));

global.log = global.log || { error() {}, debug() {}, info() {} };

const Types = req('shared/js/gametypes.js');
const Messages = req('server/js/message.js');

test('M3: Damage layout is [type,id,dmg,hp,maxHp]', () => {
    const entity = { id: 77, hitPoints: 12, maxHitPoints: 50 };
    const msg = new Messages.Damage(entity, 8).serialize();
    assert.deepStrictEqual(msg, [Types.Messages.DAMAGE, 77, 8, 12, 50]);
});

test('M1: Damage carries current HP at index 3', () => {
    const msg = new Messages.Damage({ id: 1, hitPoints: 12, maxHitPoints: 50 }, 5).serialize();
    assert.strictEqual(msg[3], 12);
});

test('M2: Damage carries max HP at index 4', () => {
    const msg = new Messages.Damage({ id: 1, hitPoints: 12, maxHitPoints: 50 }, 5).serialize();
    assert.strictEqual(msg[4], 50);
});

test('S4: Inventory serialization (equipment/weapon/armor/counts/gold)', () => {
    const msg = new Messages.Inventory([60, 21], 60, 21, { 35: 1, 56: 2 }, 40).serialize();
    assert.deepStrictEqual(msg, [
        Types.Messages.INVENTORY,
        [60, 21], 60, 21,
        { '35': 1, '56': 2 },
        40
    ]);
});

test('S4: Inventory defaults weapon/armor to 0 and counts to {}', () => {
    const msg = new Messages.Inventory([], undefined, undefined, undefined, undefined).serialize();
    assert.strictEqual(msg[2], 0);
    assert.strictEqual(msg[3], 0);
    assert.deepStrictEqual(msg[4], {});
    assert.strictEqual(msg[5], 0);
});

test('M9: Spawn message carries HP at index 7 and max at index 8', () => {
    // A spawn message is [SPAWN].concat(entity.getState()); getState for a mob is
    // [id,kind,x,y,orientation,target,hp,maxHp], so hp -> idx 7, maxHp -> idx 8.
    const stub = {
        id: 7001,
        getState() { return [7001, 2, 10, 20, 3, 0, 12, 50]; }
    };
    const msg = new Messages.Spawn(stub).serialize();
    assert.strictEqual(msg[0], Types.Messages.SPAWN);
    assert.strictEqual(msg[7], 12);  // hp
    assert.strictEqual(msg[8], 50);  // maxHp
});

test('M8: server Mob.getState() returns [id,kind,x,y,orient,target,hp,maxHp]', () => {
    // Bootstrap the minimal server globals the Mob/Character classes expect.
    global.Class = global.Class || req('server/js/lib/class.js').Class;
    global._ = global._ || require('underscore');
    global.Types = Types;
    req('server/js/entity.js');
    req('server/js/character.js');
    const Mob = req('server/js/mob.js');

    const mob = new Mob('7001', Types.Entities.RAT, 10, 20);
    const state = mob.getState();
    assert.strictEqual(state[0], 7001);           // id (parseInt)
    assert.strictEqual(state[1], Types.Entities.RAT);
    assert.strictEqual(state[2], 10);
    assert.strictEqual(state[3], 20);
    assert.strictEqual(state[6], mob.hitPoints);  // hp
    assert.strictEqual(state[7], mob.maxHitPoints);
    assert.ok(mob.hitPoints > 0, 'mob should have positive HP');
});
