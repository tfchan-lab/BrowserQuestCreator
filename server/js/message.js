
var cls = require("./lib/class"),
    _ = require("underscore"),
    Utils = require("./utils"),
    Types = require("../../shared/js/gametypes");

var Messages = {};
module.exports = Messages;

var Message = cls.Class.extend({
});

Messages.Spawn = Message.extend({
    init: function(entity) {
        this.entity = entity;
    },
    serialize: function() {
        var spawn = [Types.Messages.SPAWN];
        return spawn.concat(this.entity.getState());
    }
});

Messages.Despawn = Message.extend({
    init: function(entityId) {
        this.entityId = entityId;
    },
    serialize: function() {
        return [Types.Messages.DESPAWN, this.entityId];
    }
});

Messages.Move = Message.extend({
    init: function(entity) {
        this.entity = entity;
    },
    serialize: function() {
        return [Types.Messages.MOVE,
                this.entity.id,
                this.entity.x,
                this.entity.y];
    }
});

Messages.LootMove = Message.extend({
    init: function(entity, item) {
        this.entity = entity;
        this.item = item;
    },
    serialize: function() {
        return [Types.Messages.LOOTMOVE,
                this.entity.id,
                this.item.id];
    }
});

Messages.Attack = Message.extend({
    init: function(attackerId, targetId) {
        this.attackerId = attackerId;
        this.targetId = targetId;
    },
    serialize: function() {
        return [Types.Messages.ATTACK,
                this.attackerId,
                this.targetId];
    }
});

Messages.Health = Message.extend({
    init: function(points, isRegen) {
        this.points = points;
        this.isRegen = isRegen;
    },
    serialize: function() {
        var health = [Types.Messages.HEALTH,
                      this.points];
        
        if(this.isRegen) {
            health.push(1);
        }
        return health;
    }
});

Messages.HitPoints = Message.extend({
    init: function(maxHitPoints) {
        this.maxHitPoints = maxHitPoints;
    },
    serialize: function() {
        return [Types.Messages.HP,
                this.maxHitPoints];
    }
});

Messages.EquipItem = Message.extend({
    init: function(player, itemKind) {
        this.playerId = player.id;
        this.itemKind = itemKind;
    },
    serialize: function() {
        return [Types.Messages.EQUIP,
                this.playerId,
                this.itemKind];
    }
});

Messages.Drop = Message.extend({
    init: function(mob, item) {
        this.mob = mob;
        this.item = item;
    },
    serialize: function() {
        var drop = [Types.Messages.DROP,
                    this.mob.id,
                    this.item.id,
                    this.item.kind,
                    _.pluck(this.mob.hatelist, "id")];

        return drop;
    }
});

Messages.Chat = Message.extend({
    init: function(player, message) {
        this.playerId = player.id;
        this.message = message;
    },
    serialize: function() {
        return [Types.Messages.CHAT,
                this.playerId,
                this.message];
    }
});

Messages.Teleport = Message.extend({
    init: function(entity) {
        this.entity = entity;
    },
    serialize: function() {
        return [Types.Messages.TELEPORT,
                this.entity.id,
                this.entity.x,
                this.entity.y];
    }
});

/**
 * Self-targeted warp (server -> the warping player). Unlike TELEPORT (which is
 * broadcast to nearby players and skips the sender), WARP is sent directly to
 * the player so their own client can reposition the camera immediately.
 * Layout: [WARP, x, y]
 */
Messages.Warp = Message.extend({
    init: function(entity) {
        this.entity = entity;
    },
    serialize: function() {
        return [Types.Messages.WARP,
                this.entity.x,
                this.entity.y];
    }
});

Messages.Damage = Message.extend({
    init: function(entity, points) {
        this.entity = entity;
        this.points = points;
    },
    serialize: function() {
        // [DAMAGE, entityId, points, currentHitPoints, maxHitPoints]
        // The hit point values let the attacker's client draw a mob HP bar.
        return [Types.Messages.DAMAGE,
                this.entity.id,
                this.points,
                this.entity.hitPoints,
                this.entity.maxHitPoints];
    }
});

/**
 * Broadcasts a mob's current/max hit points so nearby clients can update its
 * HP bar. Used, for example, when a mob heals back to full after its last
 * attacker vanishes (death/logout/room change).
 * Layout: [MOB_HEALTH, entityId, currentHitPoints, maxHitPoints]
 */
Messages.MobHealth = Message.extend({
    init: function(entity) {
        this.entity = entity;
    },
    serialize: function() {
        return [Types.Messages.MOB_HEALTH,
                this.entity.id,
                this.entity.hitPoints,
                this.entity.maxHitPoints];
    }
});

/**
 * Player progression snapshot (server -> client).
 * Layout: [PROGRESSION, totalXp, level, xpIntoLevel, xpToNext, availablePoints, maxHitPoints, vigor, mind, endurance, strength, dexterity, intelligence, faith, arcane]
 */
Messages.Progression = Message.extend({
    init: function(data) {
        this.data = data;
    },
    serialize: function() {
        var d = this.data;
        return [Types.Messages.PROGRESSION,
                d.totalXp,
                d.level,
                d.xp,
                d.xpToNext,
                d.availablePoints,
                d.maxHitPoints,
                d.stats.vigor,
                d.stats.mind,
                d.stats.endurance,
                d.stats.strength,
                d.stats.dexterity,
                d.stats.intelligence,
                d.stats.faith,
                d.stats.arcane];
    }
});

Messages.Population = Message.extend({
    init: function(world, total) {
        this.world = world;
        this.total = total;
    },
    serialize: function() {
        return [Types.Messages.POPULATION,
                this.world,
                this.total];
    }
});

Messages.Kill = Message.extend({
    init: function(mob) {
        this.mob = mob;
    },
    serialize: function() {
        return [Types.Messages.KILL,
                this.mob.kind];
    }
});

Messages.List = Message.extend({
    init: function(ids) {
        this.ids = ids;
    },
    serialize: function() {
        var list = this.ids;
        
        list.unshift(Types.Messages.LIST);
        return list;
    }
});

Messages.Destroy = Message.extend({
    init: function(entity) {
        this.entity = entity;
    },
    serialize: function() {
        return [Types.Messages.DESTROY,
                this.entity.id];
    }
});

Messages.Blink = Message.extend({
    init: function(item) {
        this.item = item;
    },
    serialize: function() {
        return [Types.Messages.BLINK,
                this.item.id];
    }
});

/**
 * Sent to a player whenever their inventory or equipped gear changes.
 * Layout: [INVENTORY, [equipmentKinds...], equippedWeaponKind, equippedArmorKind,
 *          {inventoryKind: count, ...}, gold]
 * An equipped slot of 0 means "nothing equipped".
 * `equipment` is the set of unique gear kinds the player owns (equippable).
 * `inventoryCounts` holds stackable item counts (consumables, shop items and
 * duplicate gear that can only be sold). Older clients that only read indices
 * 1-3 still work.
 */
Messages.Inventory = Message.extend({
    init: function(equipment, weapon, armor, inventoryCounts, gold) {
        this.equipment = equipment;
        this.weapon = weapon;
        this.armor = armor;
        this.inventoryCounts = inventoryCounts || {};
        this.gold = gold || 0;
    },
    serialize: function() {
        return [Types.Messages.INVENTORY,
                this.equipment,
                this.weapon || 0,
                this.armor || 0,
                this.inventoryCounts,
                this.gold];
    }
});
