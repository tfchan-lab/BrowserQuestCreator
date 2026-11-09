// Passive regen test suite -- runs against real Player objects and the exact
// worldserver regen-tick body. Prints one line per test with expected/actual.
process.chdir(__dirname);
global.log = { info(){}, debug(){}, error(...a){ console.log('LOGERR', ...a); } };
global.Class = require('./server/js/lib/class').Class;
global._ = require('underscore');
require('./server/js/format');
require('./server/js/entity');
require('./server/js/character');
global.Types = require('./shared/js/gametypes');
const Player = require('./server/js/player');
const T = global.Types;

let pass = 0, fail = 0;
function test(name, fn) {
    try {
        const r = fn(); // { expected, actual }
        const ok = JSON.stringify(r.expected) === JSON.stringify(r.actual);
        if (ok) { pass++; console.log(`PASS | ${name} | expected=${JSON.stringify(r.expected)} | actual=${JSON.stringify(r.actual)}`); }
        else { fail++; console.log(`FAIL | ${name} | expected=${JSON.stringify(r.expected)} | actual=${JSON.stringify(r.actual)}`); }
    } catch (e) {
        fail++; console.log(`FAIL | ${name} | threw ${e && e.stack ? e.stack.split('\n')[0] : e}`);
    }
}

function mkPlayer() {
    const conn = { id: Math.floor(Math.random()*1e6), sendUTF8(){}, send(){}, close(){}, onClose(){}, listen(){} };
    const world = { addPlayer(){}, enter_callback(){}, getEntityById(){return null;}, removeEntity(){}, pushToPlayer(){} };
    const p = new Player(conn, world);
    p.equipArmor(T.Entities.CLOTHARMOR); p.equipWeapon(T.Entities.SWORD1);
    p.updateHitPoints();
    p.sent = []; p.send = m => p.sent.push(m);
    return p;
}

// exact regen-tick body from worldserver.js
function regenTick(characters, pushToPlayer) {
    characters.forEach(function(character) {
        if(character.hasFullHealth()) return;
        if(character.type === 'player') {
            if(!character.canRegen()) return;
            character.regenHealthBy(Math.floor(character.maxHitPoints / 25));
            pushToPlayer(character, character.regen());
        } else {
            character.regenHealthBy(Math.floor(character.maxHitPoints / 25));
        }
    });
}
const push = (c,m)=>c.sent.push(m);

// ---- canRegen: base healing rate is 0 / conditions ----

test('R1 canRegen immediately after spawn (no idle time)', () => {
    const p = mkPlayer(); // lastMoveTime = now
    return { expected: false, actual: p.canRegen() };
});

test('R2 canRegen after standing still > 2s, no aggro', () => {
    const p = mkPlayer(); p.lastMoveTime = Date.now() - 2500;
    return { expected: true, actual: p.canRegen() };
});

test('R3 moving resets the idle timer (cannot regen right after move)', () => {
    const p = mkPlayer(); p.lastMoveTime = Date.now() - 5000;
    if(!p.canRegen()) throw new Error('precondition failed');
    p.lastMoveTime = Date.now(); // simulate a MOVE
    return { expected: false, actual: p.canRegen() };
});

test('R4 cannot regen while an enemy is aggroed even if idle > 2s', () => {
    const p = mkPlayer(); p.lastMoveTime = Date.now() - 5000; p.addAttacker({ id: 999 });
    return { expected: false, actual: p.canRegen() };
});

test('R5 can regen again after aggro is cleared', () => {
    const p = mkPlayer(); p.lastMoveTime = Date.now() - 5000; p.addAttacker({ id: 999 }); p.removeAttacker({ id: 999 });
    return { expected: true, actual: p.canRegen() };
});

test('R6 boundary: exactly 2000ms is NOT enough (needs > 2s)', () => {
    const p = mkPlayer(); p.lastMoveTime = Date.now() - 2000;
    return { expected: false, actual: p.canRegen() };
});

test('R7 boundary: 2001ms is enough', () => {
    const p = mkPlayer(); p.lastMoveTime = Date.now() - 2001;
    return { expected: true, actual: p.canRegen() };
});

// ---- regen tick: healing applies only when eligible, at maxHp/25 ----

test('R8 idle & safe player heals by floor(maxHp/25)', () => {
    const p = mkPlayer(); p.hitPoints = 10; p.lastMoveTime = Date.now() - 5000;
    regenTick([p], push);
    return { expected: 10 + Math.floor(p.maxHitPoints/25), actual: p.hitPoints };
});

test('R9 idle & safe player receives a HEALTH(regen) update', () => {
    const p = mkPlayer(); p.hitPoints = 10; p.lastMoveTime = Date.now() - 5000;
    regenTick([p], push);
    const hasRegenMsg = p.sent.some(m => m.serialize && m.serialize()[0] === T.Messages.HEALTH && m.serialize()[2] === 1);
    return { expected: true, actual: hasRegenMsg };
});

test('R10 aggroed player does NOT heal (base rate 0)', () => {
    const p = mkPlayer(); p.hitPoints = 10; p.lastMoveTime = Date.now() - 5000; p.addAttacker({id:1});
    regenTick([p], push);
    return { expected: 10, actual: p.hitPoints };
});

test('R11 aggroed player receives NO regen message', () => {
    const p = mkPlayer(); p.hitPoints = 10; p.lastMoveTime = Date.now() - 5000; p.addAttacker({id:1});
    regenTick([p], push);
    const hasRegenMsg = p.sent.some(m => m.serialize && m.serialize()[0] === T.Messages.HEALTH);
    return { expected: false, actual: hasRegenMsg };
});

test('R12 player that just moved does NOT heal', () => {
    const p = mkPlayer(); p.hitPoints = 10; p.lastMoveTime = Date.now();
    regenTick([p], push);
    return { expected: 10, actual: p.hitPoints };
});

test('R13 full-health player is untouched', () => {
    const p = mkPlayer(); p.hitPoints = p.maxHitPoints;
    regenTick([p], push);
    return { expected: p.maxHitPoints, actual: p.hitPoints };
});

test('R14 repeated idle ticks accumulate heals', () => {
    const p = mkPlayer(); p.hitPoints = 1; p.lastMoveTime = Date.now() - 5000;
    for(let i=0;i<3;i++) regenTick([p], push);
    return { expected: 1 + 3*Math.floor(p.maxHitPoints/25), actual: p.hitPoints };
});

test('R15 regen never exceeds max HP', () => {
    const p = mkPlayer(); p.hitPoints = p.maxHitPoints - 1; p.lastMoveTime = Date.now() - 5000;
    for(let i=0;i<5;i++) regenTick([p], push);
    return { expected: p.maxHitPoints, actual: p.hitPoints };
});

test('R16 mobs keep original regen (unaffected by player rule)', () => {
    const mob = { type:'mob', hitPoints: 5, maxHitPoints: 100,
                  hasFullHealth(){ return this.hitPoints === this.maxHitPoints; },
                  canRegen(){ return false; }, // mobs must not be gated by player canRegen
                  regenHealthBy(v){ this.hitPoints = Math.min(this.maxHitPoints, this.hitPoints+v); } };
    regenTick([mob], push);
    return { expected: 5 + Math.floor(100/25), actual: mob.hitPoints };
});

test('R17 heals by current-level rate matches floor(maxHp/25) for maxHp=80', () => {
    const p = mkPlayer(); // cloth armor => 80
    p.hitPoints = 10; p.lastMoveTime = Date.now() - 5000;
    regenTick([p], push);
    return { expected: 10 + 3, actual: p.hitPoints }; // floor(80/25)=3
});

console.log(`\nSUMMARY ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
