// Unit tests for multiplayer mob combat fixes:
//   1. handleHurtEntity broadcasts the mob's new HP (MobHealth) to nearby players,
//      not just the attacker (so other clients don't show the mob as full HP).
//   2. A second player can damage a mob that is already engaged with (targeting)
//      another player.

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
const Mob = req('server/js/mob.js');
const World = req('server/js/worldserver.js');

function makeWorld() {
    const entities = {};
    const world = {
        entities,
        outgoingQueues: {},
        groups: { g1: { players: [], entities: {} } },
        map: {
            forEachAdjacentGroup(groupId, cb) { cb(groupId); },
            forEachGroup() {}
        },
        getEntityById(id) { return entities[id] || null; },
        isValidPosition() { return true; }
    };
    [
        'handleMobHate', 'chooseMobTarget', 'clearMobAggroLink', 'clearMobHateLinks',
        'broadcastAttacker', 'handleHurtEntity', 'pushToPlayer', 'pushToAdjacentGroups',
        'pushToGroup', 'getDroppedItem', 'handleItemDespawn', 'removeEntity',
        'handlePlayerVanish', 'awardKillXP'
    ].forEach((m) => { if (World.prototype[m]) world[m] = World.prototype[m].bind(world); });
    return world;
}

function makePlayer(world, group, x, y) {
    const id = String(Math.floor(Math.random() * 1e6));
    const conn = { id, sendUTF8() {}, send() {}, close() {}, onClose() {}, listen() {} };
    const p = new Player(conn, world);
    p.equipArmor(Types.Entities.CLOTHARMOR);
    p.equipWeapon(Types.Entities.SWORD1);
    p.updateHitPoints();
    p.setPosition(x, y);
    p.group = group;
    p.sent = [];
    p.send = (m) => p.sent.push(m);
    world.entities[id] = p;
    world.outgoingQueues[id] = [];
    world.groups[group].players.push(id);
    return p;
}

test('handleHurtEntity broadcasts mob HP to nearby players (not only the attacker)', () => {
    const world = makeWorld();
    const A = makePlayer(world, 'g1', 5, 5);
    const B = makePlayer(world, 'g1', 6, 5);
    const mob = new Mob('9001', Types.Entities.RAT, 5, 6);
    mob.group = 'g1';
    mob.hitPoints = 25; mob.maxHitPoints = 25;
    world.entities['9001'] = mob;

    // A takes first hit.
    mob.receiveDamage(5, A.id);
    world.handleMobHate(mob.id, A.id, 5);
    world.handleHurtEntity(mob, A, 5);

    // Clear queues; now B hits.
    world.outgoingQueues[A.id] = [];
    world.outgoingQueues[B.id] = [];

    const before = mob.hitPoints;
    mob.receiveDamage(3, B.id);
    world.handleMobHate(mob.id, B.id, 3);
    world.handleHurtEntity(mob, B, 3);

    // B (attacker) gets the Damage message.
    const bHasDamage = world.outgoingQueues[B.id].some((m) => m[0] === Types.Messages.DAMAGE);
    assert.ok(bHasDamage, 'attacker should receive DAMAGE');

    // A (other nearby player) must receive the mob HP update so it does not show full HP.
    const aHasMobHealth = world.outgoingQueues[A.id].some((m) => m[0] === Types.Messages.MOB_HEALTH);
    assert.ok(aHasMobHealth, 'other nearby player should receive MOB_HEALTH');
    const healthMsg = world.outgoingQueues[A.id].find((m) => m[0] === Types.Messages.MOB_HEALTH);
    assert.strictEqual(healthMsg[2], mob.hitPoints); // hp
    assert.strictEqual(healthMsg[3], mob.maxHitPoints);
});

test('second player damages a mob already engaged with (targeting) another player', () => {
    const world = makeWorld();
    const A = makePlayer(world, 'g1', 5, 5);
    const B = makePlayer(world, 'g1', 6, 5);
    const mob = new Mob('9001', Types.Entities.RAT, 5, 6);
    mob.group = 'g1';
    mob.hitPoints = 25; mob.maxHitPoints = 25;
    world.entities['9001'] = mob;

    // A hits first so the mob targets A.
    mob.receiveDamage(5, A.id);
    world.handleMobHate(mob.id, A.id, 5);
    world.handleHurtEntity(mob, A, 5);
    assert.strictEqual(mob.target, A.id, 'mob should target A');

    // Now simulate B's HIT as the server HIT handler would resolve it.
    // The range guard is skipped while the mob has ANY target, so B's hit lands
    // even though the server's mob position is only meaningful near A.
    const before = mob.hitPoints;
    const dmg = 4;
    assert.ok(mob.hasTarget(), 'mob is engaged');
    mob.receiveDamage(dmg, B.id);
    world.handleMobHate(mob.id, B.id, dmg);
    world.handleHurtEntity(mob, B, dmg);

    assert.strictEqual(mob.hitPoints, before - dmg, 'B must be able to damage the engaged mob');
});
