
var cls = require("./lib/class"),
    _ = require("underscore"),
    Messages = require("./message"),
    Utils = require("./utils"),
    Properties = require("./properties"),
    Formulas = require("./formulas"),
    check = require("./format").check,
    Levels = require("../../shared/js/levels"),
    Types = require("../../shared/js/gametypes"),
    NPCData = require("../../shared/js/npcs");

// Safe check: Types.isArmor/isWeapon throw for unknown kinds (no entry in `kinds`).
var isArmorOrWeaponKind = function(kind) {
    if(typeof kind !== "number" || !Types.getKindAsString(kind)) {
        return false;
    }
    return Types.isArmor(kind) || Types.isWeapon(kind);
};

module.exports = Player = Character.extend({
    init: function(connection, worldServer) {
        var self = this;
        
        this.server = worldServer;
        this.connection = connection;

        this._super(this.connection.id, "player", Types.Entities.WARRIOR, 0, 0, "");

        this.hasEnteredGame = false;
        this.isDead = false;
        this.haters = {};
        this.lastCheckpoint = null;
        this.formatChecker = new FormatChecker();
        this.disconnectTimeout = null;
        // Two subsystems:
        //  - equipment: unique gear kinds the player owns (equippable), max one each.
        //  - inventoryCounts: stackable item counts (consumables, shop items, and
        //    duplicate gear that can only be sold).
        this.equipment = [];
        this.inventoryCounts = {};
        this.gold = 0;
        this.lastMoveTime = Date.now();

        // Progression (experience / level / stats)
        this.totalXp = 0;
        this.level = 1;
        this.allocated = {};          // manual stat points spent per stat
        this.stats = Levels.computeStats(1, this.allocated);
        
        this.connection.listen(function(message) {
            var action = parseInt(message[0]);
            
            log.debug("Received: "+message);
            if(!check(message)) {
                self.connection.close("Invalid "+Types.getMessageTypeAsString(action)+" message format: "+message);
                return;
            }
            
            if(!self.hasEnteredGame && action !== Types.Messages.HELLO) { // HELLO must be the first message
                self.connection.close("Invalid handshake message: "+message);
                return;
            }
            if(self.hasEnteredGame && !self.isDead && action === Types.Messages.HELLO) { // HELLO can be sent only once
                self.connection.close("Cannot initiate handshake twice: "+message);
                return;
            }
            
            self.resetTimeout();
            
            if(action === Types.Messages.HELLO) {
                var name = Utils.sanitize(message[1]);
                
                // If name was cleared by the sanitizer, give a default name.
                // Always ensure that the name is not longer than a maximum length.
                // (also enforced by the maxlength attribute of the name input element).
                self.name = (name === "") ? "lorem ipsum" : name.substr(0, 15);
                
                self.kind = Types.Entities.WARRIOR;
                self.equipArmor(message[2]);
                self.equipWeapon(message[3]);
                self.applyPersistedLoadout(message[4]);
                self.applyProgressionFromHello(message[5]);
                self.orientation = Utils.randomOrientation();
                self.updateHitPoints();
                self.updatePosition();
                
                self.server.addPlayer(self);
                self.server.enter_callback(self);

                self.send([Types.Messages.WELCOME, self.id, self.name, self.x, self.y, self.hitPoints]);
                self.sendInventory();
                self.sendProgression();
                self.hasEnteredGame = true;
                self.isDead = false;
            }
            else if(action === Types.Messages.WHO) {
                message.shift();
                self.server.pushSpawnsToPlayer(self, message);
            }
            else if(action === Types.Messages.ZONE) {
                self.zone_callback();
            }
            else if(action === Types.Messages.CHAT) {
                var msg = Utils.sanitize(message[1]);
                
                // Sanitized messages may become empty. No need to broadcast empty chat messages.
                if(msg && msg !== "") {
                    msg = msg.substr(0, 60); // Enforce maxlength of chat input
                    self.broadcastToZone(new Messages.Chat(self, msg), false);
                }
            }
            else if(action === Types.Messages.MOVE) {
                if(self.move_callback) {
                    var x = message[1],
                        y = message[2];
                    
                    if(self.server.isValidPosition(x, y)) {
                        self.setPosition(x, y);
                        self.clearTarget();
                        self.lastMoveTime = Date.now();
                        
                        self.broadcast(new Messages.Move(self));
                        self.move_callback(self.x, self.y);
                    }
                }
            }
            else if(action === Types.Messages.LOOTMOVE) {
                if(self.lootmove_callback) {
                    self.setPosition(message[1], message[2]);
                    
                    var item = self.server.getEntityById(message[3]);
                    if(item) {
                        self.clearTarget();
                        self.lastMoveTime = Date.now();

                        self.broadcast(new Messages.LootMove(self, item));
                        self.lootmove_callback(self.x, self.y);
                    }
                }
            }
            else if(action === Types.Messages.AGGRO) {
                if(self.move_callback) {
                    self.server.handleMobHate(message[1], self.id, 5);
                }
            }
            else if(action === Types.Messages.ATTACK) {
                var mob = self.server.getEntityById(message[1]);
                
                if(mob) {
                    self.setTarget(mob);
                    self.server.broadcastAttacker(self);
                }
            }
            else if(action === Types.Messages.HIT) {
                var mob = self.server.getEntityById(message[1]);
                if(mob) {
                    var dmg = Formulas.dmg(self.attackPower(), mob.armorLevel);
                    
                    if(dmg > 0) {
                        mob.receiveDamage(dmg, self.id);
                        self.server.handleMobHate(mob.id, self.id, dmg);
                        self.server.handleHurtEntity(mob, self, dmg);
                    }
                }
            }
            else if(action === Types.Messages.HURT) {
                var mob = self.server.getEntityById(message[1]);
                if(mob && self.hitPoints > 0) {
                    self.hitPoints -= Formulas.dmg(mob.weaponLevel, self.armorLevel);
                    self.server.handleHurtEntity(self);
                    
                    if(self.hitPoints <= 0) {
                        self.isDead = true;
                        if(self.firepotionTimeout) {
                            clearTimeout(self.firepotionTimeout);
                        }
                    }
                }
            }
            else if(action === Types.Messages.LOOT) {
                var item = self.server.getEntityById(message[1]);
                
                if(item) {
                    var kind = item.kind;
                    
                    if(Types.isItem(kind)) {
                        self.broadcast(item.despawn());
                        self.server.removeEntity(item);
                        
                        if(kind === Types.Entities.FIREPOTION) {
                            self.updateHitPoints();
                            self.broadcast(self.equip(Types.Entities.FIREFOX));
                            self.firepotionTimeout = setTimeout(function() {
                                self.broadcast(self.equip(self.armor)); // return to normal after 15 sec
                                self.firepotionTimeout = null;
                            }, 15000);
                            self.send(new Messages.HitPoints(self.maxHitPoints).serialize());
                        } else if(Types.isHealingItem(kind)) {
                            var amount;
                            
                            switch(kind) {
                                case Types.Entities.FLASK: 
                                    amount = 40;
                                    break;
                                case Types.Entities.BURGER: 
                                    amount = 100;
                                    break;
                            }
                            
                            if(!self.hasFullHealth()) {
                                self.regenHealthBy(amount);
                                self.server.pushToPlayer(self, self.health());
                            }
                        } else if(Types.isArmor(kind) || Types.isWeapon(kind)) {
                            self.addLootToInventory(kind);
                        }
                    }
                }
            }
            else if(action === Types.Messages.EQUIP_ITEM) {
                self.equipFromInventory(message[1]);
            }
            else if(action === Types.Messages.UNEQUIP) {
                self.unequipSlot(message[1]);
            }
            else if(action === Types.Messages.ALLOCATE_STAT) {
                // [ALLOCATE_STAT, statIndex(number), points(number)]
                self.allocateStatPoint(message[1], message[2]);
            }
            else if(action === Types.Messages.BUY_ITEM) {
                self.buyItem(message[1]);
            }
            else if(action === Types.Messages.SELL_ITEM) {
                self.sellItem(message[1]);
            }
            else if(action === Types.Messages.USE_ITEM) {
                self.useItem(message[1]);
            }
            else if(action === Types.Messages.TELEPORT) {
                var x = message[1],
                    y = message[2];
                
                if(self.server.isValidPosition(x, y)) {
                    self.setPosition(x, y);
                    self.clearTarget();
                    self.lastMoveTime = Date.now();
                    
                    self.broadcast(new Messages.Teleport(self));
                    
                    self.server.handlePlayerVanish(self);
                    self.server.pushRelevantEntityListTo(self);
                }
            }
            else if(action === Types.Messages.OPEN) {
                var chest = self.server.getEntityById(message[1]);
                if(chest && chest instanceof Chest) {
                    self.server.handleOpenedChest(chest, self);
                }
            }
            else if(action === Types.Messages.CHECK) {
                var checkpoint = self.server.map.getCheckpoint(message[1]);
                if(checkpoint) {
                    self.lastCheckpoint = checkpoint;
                }
            }
            else {
                if(self.message_callback) {
                    self.message_callback(message);
                }
            }
        });
        
        this.connection.onClose(function() {
            if(self.firepotionTimeout) {
                clearTimeout(self.firepotionTimeout);
            }
            clearTimeout(self.disconnectTimeout);
            if(self.exit_callback) {
                self.exit_callback();
            }
        });
        
        this.connection.sendUTF8("go"); // Notify client that the HELLO/WELCOME handshake can start
    },
    
    destroy: function() {
        var self = this;
        
        this.forEachAttacker(function(mob) {
            mob.clearTarget();
        });
        this.attackers = {};
        
        this.forEachHater(function(mob) {
            mob.forgetPlayer(self.id);
        });
        this.haters = {};
    },
    
    getState: function() {
        var basestate = this._getBaseState(),
            state = [this.name, this.orientation, this.armor, this.weapon];

        if(this.target) {
            state.push(this.target);
        }
        
        return basestate.concat(state);
    },
    
    send: function(message) {
        this.connection.send(message);
    },
    
    broadcast: function(message, ignoreSelf) {
        if(this.broadcast_callback) {
            this.broadcast_callback(message, ignoreSelf === undefined ? true : ignoreSelf);
        }
    },
    
    /**
     * Broadcasts an equipment change to everyone in the area, *including* the
     * player themselves. Regular broadcasts skip the sender; but an equipped
     * player also needs the update so their own sprite refreshes immediately.
     */
    broadcastEquip: function(kind) {
        this.broadcast(this.equip(kind), false);
    },
    
    broadcastToZone: function(message, ignoreSelf) {
        if(this.broadcastzone_callback) {
            this.broadcastzone_callback(message, ignoreSelf === undefined ? true : ignoreSelf);
        }
    },
    
    onExit: function(callback) {
        this.exit_callback = callback;
    },
    
    onMove: function(callback) {
        this.move_callback = callback;
    },
    
    onLootMove: function(callback) {
        this.lootmove_callback = callback;
    },
    
    onZone: function(callback) {
        this.zone_callback = callback;
    },
    
    onOrient: function(callback) {
        this.orient_callback = callback;
    },
    
    onMessage: function(callback) {
        this.message_callback = callback;
    },
    
    onBroadcast: function(callback) {
        this.broadcast_callback = callback;
    },
    
    onBroadcastToZone: function(callback) {
        this.broadcastzone_callback = callback;
    },
    
    equip: function(item) {
        return new Messages.EquipItem(this, item);
    },
    
    addHater: function(mob) {
        if(mob) {
            if(!(mob.id in this.haters)) {
                this.haters[mob.id] = mob;
            }
        }
    },
    
    removeHater: function(mob) {
        if(mob && mob.id in this.haters) {
            delete this.haters[mob.id];
        }
    },
    
    forEachHater: function(callback) {
        _.each(this.haters, function(mob) {
            callback(mob);
        });
    },
    
    equipArmor: function(kind) {
        this.armor = kind;
        this.armorLevel = Properties.getArmorLevel(kind);
    },
    
    equipWeapon: function(kind) {
        this.weapon = kind;
        this.weaponLevel = Properties.getWeaponLevel(kind);
    },
    
    equipItem: function(item) {
        if(item) {
            log.debug(this.name + " equips " + Types.getKindAsString(item.kind));
            
            if(Types.isArmor(item.kind)) {
                this.equipArmor(item.kind);
                this.updateMaxHitPoints();
            } else if(Types.isWeapon(item.kind)) {
                this.equipWeapon(item.kind);
            }
        }
    },
    
    /**
     * Restores the persisted loadout from the HELLO message.
     *
     * The 4th HELLO field may be:
     *  - an array of kind ids (legacy format: treated as equipment kinds), or
     *  - an object { equipment: [kinds], inventory: {kind: count}, gold: n }.
     *
     * Everything is validated: only known storable kinds survive; gear that is
     * equippable goes to `equipment` (unique), everything else to `inventoryCounts`.
     * The equipped armor/weapon are always owned.
     */
    applyPersistedLoadout: function(persisted) {
        var self = this,
            addEquip = function(kind) {
                if(isArmorOrWeaponKind(kind) && self.equipment.indexOf(kind) === -1) {
                    self.equipment.push(kind);
                }
            },
            addStack = function(kind, count) {
                if(!Types.isStorableInventoryKind(kind)) { return; }
                count = Math.max(0, Math.floor(count || 0));
                if(count <= 0) { return; }
                self.inventoryCounts[kind] = (self.inventoryCounts[kind] || 0) + count;
            };

        var equipmentList = [], inventoryMap = {}, gold = 0;

        if(_.isArray(persisted)) {
            equipmentList = persisted;
        } else if(_.isObject(persisted) && !_.isArray(persisted)) {
            equipmentList = _.isArray(persisted.equipment) ? persisted.equipment : [];
            inventoryMap = _.isObject(persisted.inventory) ? persisted.inventory : {};
            gold = persisted.gold;
        }

        _.each(equipmentList, function(kind) { addEquip(kind); });

        _.each(_.keys(inventoryMap), function(key) {
            var kind = parseInt(key, 10);
            if(!isNaN(kind)) {
                addStack(kind, inventoryMap[key]);
            }
        });

        // The equipped armor/weapon must always be owned in equipment.
        addEquip(this.armor);
        addEquip(this.weapon);

        this.gold = Math.max(0, Math.floor(Number(gold) || 0));
    },

    /**
     * Adds loot to the appropriate subsystem. The first copy of a gear kind goes
     * to `equipment` (and may auto-equip if better). A duplicate copy of a kind
     * already owned goes to the sellable inventory stack instead.
     */
    addLootToInventory: function(kind) {
        if(!isArmorOrWeaponKind(kind)) {
            return;
        }

        if(this.equipment.indexOf(kind) === -1) {
            // First copy: own + maybe equip.
            this.equipment.push(kind);
            if(Types.isArmor(kind)) {
                if(!this.armor || Types.getArmorRank(kind) > Types.getArmorRank(this.armor)) {
                    this.equipItem({ kind: kind });
                    this.broadcastEquip(kind);
                }
            } else if(Types.isWeapon(kind)) {
                if(!this.weapon || Types.getWeaponRank(kind) > Types.getWeaponRank(this.weapon)) {
                    this.equipItem({ kind: kind });
                    this.broadcastEquip(kind);
                }
            }
        } else {
            // Duplicate: sellable inventory stack.
            this.inventoryCounts[kind] = (this.inventoryCounts[kind] || 0) + 1;
        }

        this.sendInventory();
    },

    /** Adds a storable (non-gear-specific) item to the inventory stack. */
    addStackableItem: function(kind, n) {
        if(!Types.isStorableInventoryKind(kind)) {
            return false;
        }
        this.inventoryCounts[kind] = (this.inventoryCounts[kind] || 0) + Math.max(1, Math.floor(n || 1));
        return true;
    },

    /** Removes `n` of a stackable item. Returns true if anything was removed. */
    removeStackableItem: function(kind, n) {
        n = Math.max(1, Math.floor(n || 1));
        var have = this.inventoryCounts[kind] || 0;
        if(have <= 0) { return false; }
        var left = have - n;
        if(left > 0) {
            this.inventoryCounts[kind] = left;
        } else {
            delete this.inventoryCounts[kind];
        }
        return true;
    },

    hasInInventory: function(kind) {
        return (this.inventoryCounts[kind] || 0) > 0;
    },

    hasInEquipment: function(kind) {
        return this.equipment.indexOf(kind) !== -1;
    },

    /**
     * Equips a gear item already owned in the equipment subsystem
     * (client-initiated).
     */
    equipFromInventory: function(kind) {
        if(!this.hasInEquipment(kind)) {
            log.debug(this.name + " tried to equip " + Types.getKindAsString(kind) + " but does not own it.");
            return;
        }
        
        if(Types.isArmor(kind)) {
            this.equipArmor(kind);
            this.updateMaxHitPoints();
            this.broadcastEquip(kind);
        } else if(Types.isWeapon(kind)) {
            this.equipWeapon(kind);
            this.broadcastEquip(kind);
        } else {
            return;
        }
        
        this.sendInventory();
    },
    
    /**
     * Unequips the item in the given slot. The item stays owned in equipment.
     * A slot of "armor" removes the armor (falls back to cloth armor), and
     * "weapon" removes the weapon.
     */
    unequipSlot: function(slot) {
        if(!isArmorOrWeaponKind(slot)) {
            return;
        }

        if(Types.isArmor(slot)) {
            // Keep at least the base cloth armor to avoid a null sprite.
            this.equipArmor(Types.Entities.CLOTHARMOR);
            this.updateMaxHitPoints();
            this.broadcastEquip(Types.Entities.CLOTHARMOR);
        } else if(Types.isWeapon(slot)) {
            this.equipWeapon(Types.Entities.SWORD1);
            this.broadcastEquip(Types.Entities.SWORD1);
        } else {
            return;
        }
        
        this.sendInventory();
    },
    
    sendInventory: function() {
        this.send(new Messages.Inventory(this.equipment, this.weapon, this.armor,
                                         this.inventoryCounts, this.gold).serialize());
    },

    /**
     * Finds the shop NPC the player is currently standing next to (within a
     * small radius). Returns the NPC's config (with `events`) or null.
     */
    getAdjacentShopNpc: function() {
        var self = this,
            best = null,
            bestDist = Infinity,
            radius = 2;

        _.each(this.server.npcs, function(npc) {
            if(!npc || !npc.npcConfig) { return; }
            if(!NPCData.getShop(npc.npcConfig)) { return; }
            var dx = npc.x - self.x,
                dy = npc.y - self.y,
                dist = Math.max(Math.abs(dx), Math.abs(dy));
            if(dist <= radius && dist < bestDist) {
                best = npc.npcConfig;
                bestDist = dist;
            }
        });

        return best;
    },

    /** Sends a short notification to this player (uses the chat channel). */
    notify: function(msg) {
        this.send(new Messages.Chat(this, msg).serialize());
    },

    /**
     * Buys `kind` from the shop of the NPC the player is standing next to.
     * Validates the NPC sells it and the player has enough gold.
     */
    buyItem: function(kind) {
        var shopNpc = this.getAdjacentShopNpc();
        if(!shopNpc) { this.notify("There is no shop here."); return; }

        var shop = NPCData.getShop(shopNpc),
            entry = null;

        // Resolve the stock entry by kind id (config may store a name or an id).
        _.each(shop.items, function(it) {
            if(!it || it.kind === undefined) { return; }
            var resolved = (typeof it.kind === 'number') ? it.kind : Types.getKindFromString(it.kind);
            if(resolved === kind) { entry = it; }
        });

        if(!entry) { this.notify("That item is not sold here."); return; }

        var price = Math.max(0, Math.floor(entry.price || 0));
        if(this.gold < price) { this.notify("Not enough gold."); return; }
        if(!Types.isStorableInventoryKind(kind)) { this.notify("You cannot carry that."); return; }

        this.gold -= price;
        this.addStackableItem(kind, 1);
        this.sendInventory();
        log.debug(this.name + " bought " + Types.getKindAsString(kind) + " for " + price + " gold.");
    },

    /**
     * Sells one unit of `kind` from the inventory for gold. Only inventory
     * stacks are sellable (equipment cannot be sold).
     */
    sellItem: function(kind) {
        var shopNpc = this.getAdjacentShopNpc();
        if(!shopNpc) { this.notify("There is no shop here."); return; }

        if(!this.hasInInventory(kind)) { this.notify("You don't have that item."); return; }

        var price = Properties.getSellPrice(kind);
        if(this.removeStackableItem(kind, 1)) {
            this.gold += price;
            this.sendInventory();
            log.debug(this.name + " sold " + Types.getKindAsString(kind) + " for " + price + " gold.");
        }
    },

    /**
     * Consumes one unit of a usable item (e.g. a single-use warp scroll) and
     * applies its effect. Currently only the teleport scroll is usable: it warps
     * the player to the destination associated with its kind.
     */
    useItem: function(kind) {
        if(!Types.isUsableItem(kind)) {
            this.notify("You can't use that.");
            return;
        }
        if(!this.hasInInventory(kind)) {
            this.notify("You don't have that item.");
            return;
        }
        if(this.isDead) {
            return;
        }

        var dest = Types.warpDestinations[kind];
        if(!dest) {
            this.notify("This warp has no destination.");
            return;
        }

        // Consume the item first.
        this.removeStackableItem(kind, 1);

        // Reposition (validated), then notify the player's own client and the
        // surrounding players.
        var x = dest.x, y = dest.y;
        if(!this.server.isValidPosition(x, y)) {
            x = this.x; y = this.y;
        }

        this.setPosition(x, y);
        this.clearTarget();
        this.lastMoveTime = Date.now();

        // Let nearby players see the warp, then refresh this player's world view.
        this.broadcast(new Messages.Teleport(this));
        this.send(new Messages.Warp(this).serialize());

        this.server.handlePlayerVanish(this);
        this.server.pushRelevantEntityListTo(this);

        this.sendInventory();
        this.notify("You warped to " + (Types.getItemDisplayName(kind) || Types.getKindAsString(kind)) + ".");
        log.debug(this.name + " used " + Types.getKindAsString(kind) + " -> " + x + "," + y);
    },
    
    /**
     * Whether the player may regenerate health right now. Health only regenerates
     * when no enemy is currently targeting ("aggro'd on") the player and the player
     * has not moved for more than 2 seconds.
     */
    canRegen: function() {
        var now = Date.now(),
            hasAggro = false;
        
        this.forEachAttacker(function() {
            hasAggro = true;
        });
        
        return !hasAggro && (now - this.lastMoveTime) > 2000;
    },
    
    updateHitPoints: function() {
        this.resetHitPoints(this.computeMaxHitPoints());
    },

    /**
     * Max HP = (armor base + Vigor bonus) * multiplier. Multipliers (class/armor)
     * are not implemented yet (treated as 1).
     */
    computeMaxHitPoints: function() {
        return Levels.maxHitPoints(Properties.getMaxHitPoints(this.armor), this.stats, 1);
    },

    /** Attack power for the current weapon, scaled by Strength. */
    attackPower: function() {
        return Levels.attackPower(this.weaponLevel, this.stats, 1);
    },

    // ---- Progression ------------------------------------------------------

    /** Recomputes level/stats from total XP and the manual allocation. */
    recomputeProgression: function() {
        var progress = Levels.progressForXP(this.totalXp);
        this.level = progress.level;
        this.allocated = Levels.sanitizeAllocation(this.allocated, this.level);
        this.stats = Levels.computeStats(this.level, this.allocated);
        this.progression = {
            totalXp: this.totalXp,
            level: progress.level,
            xp: progress.xp,
            xpToNext: progress.xpToNext,
            availablePoints: Levels.availablePoints(this.level, Levels.totalAllocated(this.allocated)),
            stats: this.stats,
            maxHitPoints: this.computeMaxHitPoints()
        };
        return this.progression;
    },

    /** Applies persisted progression from the HELLO message (validated). */
    applyProgressionFromHello: function(prog) {
        var totalXp = 0, allocated = {};
        if(prog && typeof prog === 'object') {
            totalXp = Levels.sanitizeXP(prog.totalXp);
            allocated = prog.allocated || {};
        }
        this.totalXp = totalXp;
        var level = Levels.levelForXP(this.totalXp);
        this.allocated = Levels.sanitizeAllocation(allocated, level);
        this.recomputeProgression();
    },

    /** Sends the current progression snapshot to this player. */
    sendProgression: function() {
        if(!this.progression || !this.hasEnteredGame) {
            // compute even before enter (needed for initial send)
            this.recomputeProgression();
        }
        this.send(new Messages.Progression(this.progression).serialize());
    },

    /**
     * Awards XP, handles level-ups, recomputes derived stats/HP and notifies the
     * player. Returns the number of levels gained.
     */
    gainXP: function(amount) {
        amount = Math.max(0, Math.floor(amount || 0));
        if(amount === 0) { return 0; }

        var beforeLevel = Levels.levelForXP(this.totalXp);
        this.totalXp = Levels.sanitizeXP(this.totalXp + amount);
        this.recomputeProgression();
        var afterLevel = this.level;

        // Keep current HP within the (possibly increased) max; Vigor may raise max.
        var newMax = this.computeMaxHitPoints();
        if(this.hitPoints > newMax) { this.hitPoints = newMax; }
        this.maxHitPoints = newMax;

        if(afterLevel > beforeLevel) {
            // Level up: refill HP to the new maximum and notify.
            this.hitPoints = newMax;
            this.send(new Messages.HitPoints(this.maxHitPoints).serialize());
        }

        this.sendProgression();

        if(this.levelUp_callback) {
            this.levelUp_callback(afterLevel - beforeLevel);
        }
        return afterLevel - beforeLevel;
    },

    onLevelUp: function(callback) {
        this.levelUp_callback = callback;
    },

    /** Allocates one stat point into the stat at the given index. */
    allocateStatPoint: function(statIndex, points) {
        statIndex = statIndex | 0;
        points = (points === undefined) ? 1 : (points | 0);
        var stat = Levels.STATS[statIndex];
        if(!stat || points <= 0) { return; }

        var available = Levels.availablePoints(this.level, Levels.totalAllocated(this.allocated));
        points = Math.min(points, available);
        if(points <= 0) { return; }

        this.allocated[stat] = (this.allocated[stat] | 0) + points;
        this.recomputeProgression();

        // Vigor changes max HP; clamp current HP to the new max (no free heal).
        var newMax = this.computeMaxHitPoints();
        if(this.hitPoints > newMax) { this.hitPoints = newMax; }
        if(this.maxHitPoints !== newMax) {
            this.maxHitPoints = newMax;
            this.send(new Messages.HitPoints(this.maxHitPoints).serialize());
        }

        this.sendProgression();
    },
    
    /**
     * Recomputes the player's max HP from the current armor level *without*
     * healing. Used when gear changes after the player has entered the game, so
     * equipping/unequipping armor only adjusts the maximum and current HP is
     * carried over (clamped to the new maximum). Equipping a weapon never
     * affects HP.
     */
    updateMaxHitPoints: function() {
        var newMax = this.computeMaxHitPoints();
        
        this.maxHitPoints = newMax;
        
        // Carry the current hit points over, but never exceed the new maximum.
        // Do not heal on equip — current HP is preserved otherwise.
        if(typeof this.hitPoints !== 'number' || this.hitPoints > newMax) {
            this.hitPoints = newMax;
        }
        
        this.send(new Messages.HitPoints(this.maxHitPoints).serialize());
    },
    
    updatePosition: function() {
        if(this.requestpos_callback) {
            var pos = this.requestpos_callback();
            this.setPosition(pos.x, pos.y);
        }
    },
    
    onRequestPosition: function(callback) {
        this.requestpos_callback = callback;
    },
    
    resetTimeout: function() {
        clearTimeout(this.disconnectTimeout);
        this.disconnectTimeout = setTimeout(this.timeout.bind(this), 1000 * 60 * 15); // 15 min.
    },
    
    timeout: function() {
        this.connection.sendUTF8("timeout");
        this.connection.close("Player was idle for too long");
    }
});