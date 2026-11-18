// Unit tests for the client Character.canReachTarget() geometry (Euclidean).
// Covers AR3, AR7, AR8.
//
// The client modules are AMD `define(...)` scripts relying on a global `Class`.
// We load class.js + entity/transition/timer/character into ONE shared vm
// context (so the Resig Class's shared `initializing` flag works) with a tiny
// AMD shim, then exercise canReachTarget directly without a browser.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const Types = require(path.join(ROOT, 'shared/js/gametypes.js'));

// One shared sandbox for all client scripts.
const sandbox = {
    Math, Object, Array, JSON, Function,
    Types,
    log: { error() {}, debug() {}, info() {} }
};
sandbox.window = sandbox;
sandbox.self = sandbox;
vm.createContext(sandbox);

// A simple synchronous AMD shim: each module registers itself under its define.
const moduleCache = {};
sandbox.define = function (a, b) {
    let name, deps, factory;
    if (typeof a === 'function') { deps = []; factory = a; }
    else { deps = a; factory = b; }
    sandbox.__register(deps, factory);
};

// Provide an AMD loader: load(file, exportName) runs the file and captures the
// factory result, resolving string deps from a prior load.
function loadAmd(file, depMap) {
    let captured;
    sandbox.define = function (a, b) {
        if (typeof a === 'function') {
            captured = a();
        } else {
            captured = b.apply(null, a.map((d) => depMap[d]));
        }
    };
    sandbox.define.amd = {};
    vm.runInContext(read(file), sandbox, { filename: file });
    return captured;
}

// 1) real Class implementation
vm.runInContext(read('client/js/lib/class.js'), sandbox, { filename: 'class.js' });

// 2) base modules
const Entity = loadAmd('client/js/entity.js', {});
const Transition = loadAmd('client/js/transition.js', {});
const Timer = loadAmd('client/js/timer.js', {});
const Character = loadAmd('client/js/character.js', {
    entity: Entity,
    transition: Transition,
    timer: Timer
});

function mkChar(gridX, gridY, targetPos, range) {
    const c = new Character(1, Types.Entities.WARRIOR);
    c.gridX = gridX;
    c.gridY = gridY;
    c.attackRange = range;
    c.target = targetPos ? { gridX: targetPos.x, gridY: targetPos.y } : null;
    return c;
}

test('AR3/AR8: range 2 -> true at Euclidean distance 2', () => {
    assert.strictEqual(mkChar(0, 0, { x: 2, y: 0 }, 2).canReachTarget(), true);
});

test('AR3: range 2 -> false at Euclidean distance 3', () => {
    assert.strictEqual(mkChar(0, 0, { x: 3, y: 0 }, 2).canReachTarget(), false);
});

test('AR3/AR8: melee range 1 excludes diagonal (~1.414), allows orthogonal', () => {
    assert.strictEqual(mkChar(0, 0, { x: 1, y: 1 }, 1).canReachTarget(), false);
    assert.strictEqual(mkChar(0, 0, { x: 1, y: 0 }, 1).canReachTarget(), true);
});

test('AR7/AR8: sword range 1.5 includes orthogonal + diagonal, excludes dist 2', () => {
    assert.strictEqual(mkChar(0, 0, { x: 1, y: 1 }, 1.5).canReachTarget(), true);  // 1.414
    assert.strictEqual(mkChar(0, 0, { x: 1, y: 0 }, 1.5).canReachTarget(), true);  // 1
    assert.strictEqual(mkChar(0, 0, { x: 2, y: 0 }, 1.5).canReachTarget(), false); // 2
});

test('AR3: no target -> false', () => {
    assert.strictEqual(mkChar(0, 0, null, 2).canReachTarget(), false);
});
