// Unit tests for Player inventory subsystem functions (pure given a constructed
// Player with stubbed connection/world). Covers:
//   - AR26: applyPersistedLoadout is idempotent (no duplication on re-apply)
//   - duplicate routing (first gear copy -> equipment, dup -> inventory stack)
//   - addStackableItem / removeStackableItem / hasInInventory / hasInEquipment

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const req = (p) => require(path.join(ROOT, p));

global.log = global.log || { error() {}, debug() {}, info() {} };
global.Class = global.Class || req('server/js/lib/class.js').Class;
global._ = global._ || require('underscore');

const Types = req('shared/js/gametypes.js');
global.Types = Types;
req('server/js/format.js');
req('server/js/entity.js');
req('server/js/character.js');
const Player = req('server/js/player.js');

function makePlayer() {
    const conn = {
        id: Math.floor(Math.random() * 1e6),
        sendUTF8() {}, send() {}, close() {}, onClose() {}, listen() {}
    };
    const world = {
        addPlayer() {}, enter_callback() {}, getEntityById() { return null; },
        removeEntity() {}, pushToPlayer() {}, isValidPosition() { return true; },
        handlePlayerVanish() {}, pushRelevantEntityListTo() {}
    };
    const p = new Player(conn, world);
    p.equipArmor(Types.Entities.CLOTHARMOR);
    p.equipWeapon(Types.Entities.SWORD1);
    p.updateHitPoints();
    p.sent = [];
    p.send = (m) => p.sent.push(m);
    return p;
}

test('AR26: applyPersistedLoadout is idempotent (no inventory duplication)', () => {
    const p = makePlayer();
    const flask = Types.Entities.FLASK;
    const scroll = Types.Entities.TELEPORTSCROLL;
    const persisted = {
        equipment: [Types.Entities.SWORD2, Types.Entities.CLOTHARMOR],
        inventory: { [flask]: 2, [scroll]: 1 },
        gold: 42
    };
    p.applyPersistedLoadout(persisted);
    p.applyPersistedLoadout(persisted); // respawn re-sends HELLO
    assert.strictEqual(p.inventoryCounts[flask], 2, 'flask must not duplicate');
    assert.strictEqual(p.inventoryCounts[scroll], 1, 'scroll must not duplicate');
    assert.strictEqual(p.gold, 42);
});

test('applyPersistedLoadout: resets prior inventory before applying', () => {
    const p = makePlayer();
    p.inventoryCounts[Types.Entities.FLASK] = 9; // stale junk from a previous life
    p.applyPersistedLoadout({ equipment: [], inventory: {}, gold: 0 });
    assert.strictEqual(p.inventoryCounts[Types.Entities.FLASK], undefined);
});

test('addLootToInventory: first gear copy -> equipment, duplicate -> stack', () => {
    const p = makePlayer();
    const sword2 = Types.Entities.SWORD2;
    p.addLootToInventory(sword2);
    assert.ok(p.equipment.indexOf(sword2) !== -1, 'first copy owned in equipment');
    assert.strictEqual(p.inventoryCounts[sword2] || 0, 0, 'first copy not stacked');

    p.addLootToInventory(sword2);
    assert.strictEqual(p.inventoryCounts[sword2], 1, 'duplicate goes to stack');
});

test('addStackableItem / removeStackableItem / hasInInventory', () => {
    const p = makePlayer();
    const scroll = Types.Entities.TELEPORTSCROLL;
    assert.strictEqual(p.hasInInventory(scroll), false);

    p.addStackableItem(scroll, 2);
    assert.strictEqual(p.inventoryCounts[scroll], 2);
    assert.strictEqual(p.hasInInventory(scroll), true);

    assert.strictEqual(p.removeStackableItem(scroll, 1), true);
    assert.strictEqual(p.inventoryCounts[scroll], 1);

    assert.strictEqual(p.removeStackableItem(scroll, 5), true); // clamped, last one removed
    assert.strictEqual(p.inventoryCounts[scroll], undefined);

    assert.strictEqual(p.removeStackableItem(scroll, 1), false); // nothing left
});

test('addStackableItem rejects non-storable kinds (e.g. chests)', () => {
    const p = makePlayer();
    assert.strictEqual(p.addStackableItem(Types.Entities.CHEST, 1), false);
    assert.strictEqual(Types.isStorableInventoryKind(Types.Entities.CHEST), false);
});

test('hasInEquipment reflects owned gear only', () => {
    const p = makePlayer();
    assert.strictEqual(p.hasInEquipment(Types.Entities.SWORD2), false);
    p.addLootToInventory(Types.Entities.SWORD2);
    assert.strictEqual(p.hasInEquipment(Types.Entities.SWORD2), true);
});

test('W2: useItem teleportscroll warps to (16,223) and consumes 1', () => {
    const p = makePlayer();
    const scroll = Types.Entities.TELEPORTSCROLL;
    p.addStackableItem(scroll, 1);
    p.broadcast = function () {};
    p.useItem(scroll);
    assert.strictEqual(p.x, 16);
    assert.strictEqual(p.y, 223);
    assert.strictEqual(p.inventoryCounts[scroll], undefined); // consumed
});

test('W2: useItem with none in inventory does nothing (no warp)', () => {
    const p = makePlayer();
    const before = { x: p.x, y: p.y };
    p.broadcast = function () {};
    p.useItem(Types.Entities.TELEPORTSCROLL); // not owned
    assert.strictEqual(p.x, before.x);
    assert.strictEqual(p.y, before.y);
});
