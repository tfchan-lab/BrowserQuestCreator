
var Types = require("../../shared/js/gametypes"),
    Equipment = require("../../shared/js/equipment");

var Properties = {
    rat: {
        drops: {
            flask: 40,
            burger: 10,
            firepotion: 5
        },
        hp: 25,
        xp: 8,
        armor: 1,
        weapon: 1
    },
    
    skeleton: {
        drops: {
            flask: 40,
            mailarmor: 10,
            axe: 20,
            firepotion: 5
        },
        hp: 110,
        xp: 45,
        armor: 2,
        weapon: 2
    },
    
    goblin: {
        drops: {
            flask: 50,
            leatherarmor: 20,
            axe: 10,
            firepotion: 5
        },
        hp: 90,
        xp: 20,
        armor: 2,
        weapon: 1
    },
    
    ogre: {
        drops: {
            burger: 10,
            flask: 50,
            platearmor: 20,
            morningstar: 20,
            firepotion: 5
        },
        hp: 200,
        xp: 90,
        armor: 3,
        weapon: 2
    },
    
    spectre: {
        drops: {
            flask: 30,
            redarmor: 40,
            redsword: 30,
            firepotion: 5
        },
        hp: 250,
        xp: 150,
        armor: 2,
        weapon: 4
    },
    
    deathknight: {
        drops: {
            burger: 95,
            firepotion: 5
        },
        hp: 250,
        xp: 160,
        armor: 3,
        weapon: 3
    },
    
    crab: {
        drops: {
            flask: 50,
            axe: 20,
            leatherarmor: 10,
            firepotion: 5
        },
        hp: 60,
        xp: 14,
        armor: 2,
        weapon: 1
    },
    
    snake: {
        drops: {
            flask: 50,
            mailarmor: 10,
            morningstar: 10,
            firepotion: 5
        },
        hp: 150,
        xp: 60,
        armor: 3,
        weapon: 2
    },
    
    skeleton2: {
        drops: {
            flask: 60,
            platearmor: 15,
            bluesword: 15,
            firepotion: 5
        },
        hp: 200,
        xp: 100,
        armor: 3,
        weapon: 3
    },
    
    eye: {
        drops: {
            flask: 50,
            redarmor: 20,
            redsword: 10,
            firepotion: 5
        },
        hp: 200,
        xp: 100,
        armor: 3,
        weapon: 3
    },
    
    bat: {
        drops: {
            flask: 50,
            axe: 10,
            firepotion: 5
        },
        hp: 80,
        xp: 16,
        armor: 2,
        weapon: 1
    },
    
    wizard: {
        drops: {
            flask: 50,
            platearmor: 20,
            firepotion: 5
        },
        hp: 100,
        xp: 70,
        armor: 2,
        weapon: 6
    },
    
    boss: {
        drops: {
            goldensword: 100
        },
        hp: 700,
        xp: 600,
        armor: 6,
        weapon: 7
    }
};

Properties.getArmorLevel = function(kind) {
    try {
        if(Types.isMob(kind)) {
            return Properties[Types.getKindAsString(kind)].armor;
        } else {
            var level = Equipment.getLevel(kind);
            return (typeof level === 'number') ? level : (Types.getArmorRank(kind) + 1);
        }
    } catch(e) {
        log.error("No level found for armor: "+Types.getKindAsString(kind));
    }
};

Properties.getWeaponLevel = function(kind) {
    try {
        if(Types.isMob(kind)) {
            return Properties[Types.getKindAsString(kind)].weapon;
        } else {
            var level = Equipment.getLevel(kind);
            return (typeof level === 'number') ? level : (Types.getWeaponRank(kind) + 1);
        }
    } catch(e) {
        log.error("No level found for weapon: "+Types.getKindAsString(kind));
    }
};

/**
 * Maximum hit points granted by an armor. Prefers the explicit `maxHp` from the
 * equipment data, falling back to the legacy rank-based formula.
 */
Properties.getMaxHitPoints = function(armorKind) {
    var maxHp = Equipment.getMaxHitPoints(armorKind);
    if(typeof maxHp === 'number') {
        return maxHp;
    }
    return 80 + ((Properties.getArmorLevel(armorKind) - 1) * 30);
};

Properties.getHitPoints = function(kind) {
    return Properties[Types.getKindAsString(kind)].hp;
};

/**
 * Sell value (in gold) of a storable item kind. Gear uses the data-driven
 * `sellPrice` from equipment.json; objects/consumables use this table.
 */
Properties.itemSellPrices = {
    flask: 3,
    burger: 5,
    cake: 8,
    firepotion: 10,
    teleportscroll: 15
};

Properties.getSellPrice = function(kind) {
    if(Types.isArmor(kind) || Types.isWeapon(kind)) {
        return Equipment.getSellPrice(kind);
    }
    var name = Types.getKindAsString(kind);
    return (name && Properties.itemSellPrices[name]) || 1;
};

module.exports = Properties;