
define(['player', 'entityfactory', 'lib/bison'], function(Player, EntityFactory, BISON) {

    var GameClient = Class.extend({
        init: function(host, port) {
            this.connection = null;
            this.host = host;
            this.port = port;
    
            this.connected_callback = null;
            this.spawn_callback = null;
            this.movement_callback = null;
        
            this.handlers = [];
            this.handlers[Types.Messages.WELCOME] = this.receiveWelcome;
            this.handlers[Types.Messages.MOVE] = this.receiveMove;
            this.handlers[Types.Messages.LOOTMOVE] = this.receiveLootMove;
            this.handlers[Types.Messages.ATTACK] = this.receiveAttack;
            this.handlers[Types.Messages.SPAWN] = this.receiveSpawn;
            this.handlers[Types.Messages.DESPAWN] = this.receiveDespawn;
            this.handlers[Types.Messages.SPAWN_BATCH] = this.receiveSpawnBatch;
            this.handlers[Types.Messages.HEALTH] = this.receiveHealth;
            this.handlers[Types.Messages.CHAT] = this.receiveChat;
            this.handlers[Types.Messages.EQUIP] = this.receiveEquipItem;
            this.handlers[Types.Messages.DROP] = this.receiveDrop;
            this.handlers[Types.Messages.TELEPORT] = this.receiveTeleport;
            this.handlers[Types.Messages.DAMAGE] = this.receiveDamage;
            this.handlers[Types.Messages.POPULATION] = this.receivePopulation;
            this.handlers[Types.Messages.LIST] = this.receiveList;
            this.handlers[Types.Messages.DESTROY] = this.receiveDestroy;
            this.handlers[Types.Messages.KILL] = this.receiveKill;
            this.handlers[Types.Messages.HP] = this.receiveHitPoints;
            this.handlers[Types.Messages.BLINK] = this.receiveBlink;
            this.handlers[Types.Messages.INVENTORY] = this.receiveInventory;
            this.handlers[Types.Messages.MOB_HEALTH] = this.receiveMobHealth;
            this.handlers[Types.Messages.PROGRESSION] = this.receiveProgression;
            this.handlers[Types.Messages.WARP] = this.receiveWarp;
        
            this.useBison = false;
            this.enable();
        },
    
        enable: function() {
            this.isListening = true;
        },
    
        disable: function() {
            this.isListening = false;
        },
        
        connect: function(dispatcherMode) {
            var url = "ws://"+ this.host +":"+ this.port +"/",
                self = this;
            
            log.info("Trying to connect to server : "+url);

            if(window.MozWebSocket) {
                this.connection = new MozWebSocket(url);
            } else {
                this.connection = new WebSocket(url);
            }
            
            if(dispatcherMode) {
                this.connection.onmessage = function(e) {
                    var reply = JSON.parse(e.data);

                    if(reply.status === 'OK') {
                        self.dispatched_callback(reply.host, reply.port);
                    } else if(reply.status === 'FULL') {
                        alert("BrowserQuest is currently at maximum player population. Please retry later.");
                    } else {
                        alert("Unknown error while connecting to BrowserQuest.");
                    }
                };
            } else {
                this.connection.onopen = function(e) {
                    log.info("Connected to server "+self.host+":"+self.port);
                };

                this.connection.onmessage = function(e) {
                    if(e.data === "go") {
                        if(self.connected_callback) {
                            self.connected_callback();
                        }
                        return;
                    }
                    if(e.data === 'timeout') {
                        self.isTimeout = true;
                        return;
                    }
                    
                    self.receiveMessage(e.data);
                };

                this.connection.onerror = function(e) {
                    log.error(e, true);
                };

                this.connection.onclose = function() {
                    log.debug("Connection closed");
                    $('#container').addClass('error');
                    
                    if(self.disconnected_callback) {
                        if(self.isTimeout) {
                            self.disconnected_callback("You have been disconnected for being inactive for too long");
                        } else {
                            self.disconnected_callback("The connection to BrowserQuest has been lost");
                        }
                    }
                };
            }
        },

        sendMessage: function(json) {
            var data;
            if(this.connection.readyState === 1) {
                if(this.useBison) {
                    data = BISON.encode(json);
                } else {
                    data = JSON.stringify(json);
                }
                this.connection.send(data);
            }
        },

        receiveMessage: function(message) {
            var data, action;
        
            if(this.isListening) {
                if(this.useBison) {
                    data = BISON.decode(message);
                } else {
                    data = JSON.parse(message);
                }

                log.debug("data: " + message);

                if(data instanceof Array) {
                    if(data[0] instanceof Array) {
                        // Multiple actions received
                        this.receiveActionBatch(data);
                    } else {
                        // Only one action received
                        this.receiveAction(data);
                    }
                }
            }
        },
    
        receiveAction: function(data) {
            var action = data[0];
            if(this.handlers[action] && _.isFunction(this.handlers[action])) {
                this.handlers[action].call(this, data);
            }
            else {
                log.error("Unknown action : " + action);
            }
        },
    
        receiveActionBatch: function(actions) {
            var self = this;

            _.each(actions, function(action) {
                self.receiveAction(action);
            });
        },
    
        receiveWelcome: function(data) {
            var id = data[1],
                name = data[2],
                x = data[3],
                y = data[4],
                hp = data[5];
        
            if(this.welcome_callback) {
                this.welcome_callback(id, name, x, y, hp);
            }
        },
    
        receiveMove: function(data) {
            var id = data[1],
                x = data[2],
                y = data[3];
        
            if(this.move_callback) {
                this.move_callback(id, x, y);
            }
        },
    
        receiveLootMove: function(data) {
            var id = data[1], 
                item = data[2];
        
            if(this.lootmove_callback) {
                this.lootmove_callback(id, item);
            }
        },
    
        receiveAttack: function(data) {
            var attacker = data[1], 
                target = data[2];
        
            if(this.attack_callback) {
                this.attack_callback(attacker, target);
            }
        },
    
        receiveSpawn: function(data) {
            var id = data[1],
                kind = data[2],
                x = data[3],
                y = data[4];
        
            if(Types.isItem(kind)) {
                var item = EntityFactory.createEntity(kind, id);
            
                if(this.spawn_item_callback) {
                    this.spawn_item_callback(item, x, y);
                }
            } else if(Types.isChest(kind)) {
                var item = EntityFactory.createEntity(kind, id);
            
                if(this.spawn_chest_callback) {
                    this.spawn_chest_callback(item, x, y);
                }
            } else {
                var name, orientation, target, weapon, armor, hitPoints, maxHitPoints;
            
                if(Types.isPlayer(kind)) {
                    name = data[5];
                    orientation = data[6];
                    armor = data[7];
                    weapon = data[8];
                    if(data.length > 9) {
                        target = data[9];
                    }
                }
                else if(Types.isMob(kind)) {
                    orientation = data[5];
                    if(data.length > 6) {
                        target = data[6];
                    }
                    if(data.length > 7) {
                        hitPoints = data[7];
                    }
                    if(data.length > 8) {
                        maxHitPoints = data[8];
                    }
                }

                var character = EntityFactory.createEntity(kind, id, name);
            
                if(character instanceof Player) {
                    character.weaponName = Types.getKindAsString(weapon);
                    character.spriteName = Types.getKindAsString(armor);
                }

                if(Types.isMob(kind)) {
                    if(typeof maxHitPoints === 'number') {
                        character.maxHitPoints = maxHitPoints;
                    }
                    if(typeof hitPoints === 'number') {
                        character.hitPoints = hitPoints;
                    }
                }
            
                if(this.spawn_character_callback) {
                    this.spawn_character_callback(character, x, y, orientation, target);
                }
            }
        },
    
        receiveDespawn: function(data) {
            var id = data[1];
        
            if(this.despawn_callback) {
                this.despawn_callback(id);
            }
        },
    
        receiveHealth: function(data) {
            var points = data[1],
                isRegen = false;
        
            if(data[2]) {
                isRegen = true;
            }
        
            if(this.health_callback) {
                this.health_callback(points, isRegen);
            }
        },
    
        receiveChat: function(data) {
            var id = data[1],
                text = data[2];
        
            if(this.chat_callback) {
                this.chat_callback(id, text);
            }
        },
    
        receiveEquipItem: function(data) {
            var id = data[1],
                itemKind = data[2];
        
            if(this.equip_callback) {
                this.equip_callback(id, itemKind);
            }
        },
    
        receiveDrop: function(data) {
            var mobId = data[1],
                id = data[2],
                kind = data[3];
        
            var item = EntityFactory.createEntity(kind, id);
            item.wasDropped = true;
            item.playersInvolved = data[4];
        
            if(this.drop_callback) {
                this.drop_callback(item, mobId);
            }
        },
    
        receiveTeleport: function(data) {
            var id = data[1],
                x = data[2],
                y = data[3];
        
            if(this.teleport_callback) {
                this.teleport_callback(id, x, y);
            }
        },

        receiveWarp: function(data) {
            var x = data[1],
                y = data[2];

            if(this.warp_callback) {
                this.warp_callback(x, y);
            }
        },
    
        receiveDamage: function(data) {
            var id = data[1],
                dmg = data[2],
                hitPoints = data[3],
                maxHitPoints = data[4];
        
            if(this.dmg_callback){
                this.dmg_callback(id, dmg, hitPoints, maxHitPoints);
            }
        },
    
        receiveMobHealth: function(data) {
            var id = data[1],
                hitPoints = data[2],
                maxHitPoints = data[3];

            if(this.mobhealth_callback) {
                this.mobhealth_callback(id, hitPoints, maxHitPoints);
            }
        },

        receiveProgression: function(data) {
            // [PROGRESSION, totalXp, level, xp, xpToNext, availablePoints, maxHitPoints, vigor, ...arcane]
            var prog = {
                totalXp: data[1],
                level: data[2],
                xp: data[3],
                xpToNext: data[4],
                availablePoints: data[5],
                maxHitPoints: data[6],
                stats: {}
            };
            var stats = Types.StatsOrder || ['vigor','mind','endurance','strength','dexterity','intelligence','faith','arcane'];
            for(var i = 0; i < stats.length; i++) {
                prog.stats[stats[i]] = data[7 + i];
            }
            if(this.progression_callback) {
                this.progression_callback(prog);
            }
        },
    
        receivePopulation: function(data) {
            var worldPlayers = data[1],
                totalPlayers = data[2];
        
            if(this.population_callback) {
                this.population_callback(worldPlayers, totalPlayers);
            }
        },
    
        receiveKill: function(data) {
            var mobKind = data[1];
        
            if(this.kill_callback) {
                this.kill_callback(mobKind);
            }
        },
    
        receiveList: function(data) {
            data.shift();
        
            if(this.list_callback) {
                this.list_callback(data);
            }
        },
    
        receiveDestroy: function(data) {
            var id = data[1];
        
            if(this.destroy_callback) {
                this.destroy_callback(id);
            }
        },
    
        receiveHitPoints: function(data) {
            var maxHp = data[1];
        
            if(this.hp_callback) {
                this.hp_callback(maxHp);
            }
        },
    
        receiveBlink: function(data) {
            var id = data[1];
        
            if(this.blink_callback) {
                this.blink_callback(id);
            }
        },

        receiveInventory: function(data) {
            var equipment = data[1] || [],
                weapon = data[2] || 0,
                armor = data[3] || 0,
                inventoryCounts = data[4] || {},
                gold = data[5] || 0;

            if(this.inventory_callback) {
                this.inventory_callback(equipment, weapon, armor, inventoryCounts, gold);
            }
        },
        
        onDispatched: function(callback) {
            this.dispatched_callback = callback;
        },

        onConnected: function(callback) {
            this.connected_callback = callback;
        },
        
        onDisconnected: function(callback) {
            this.disconnected_callback = callback;
        },

        onWelcome: function(callback) {
            this.welcome_callback = callback;
        },

        onSpawnCharacter: function(callback) {
            this.spawn_character_callback = callback;
        },
    
        onSpawnItem: function(callback) {
            this.spawn_item_callback = callback;
        },
    
        onSpawnChest: function(callback) {
            this.spawn_chest_callback = callback;
        },

        onDespawnEntity: function(callback) {
            this.despawn_callback = callback;
        },

        onEntityMove: function(callback) {
            this.move_callback = callback;
        },

        onEntityAttack: function(callback) {
            this.attack_callback = callback;
        },
    
        onPlayerChangeHealth: function(callback) {
            this.health_callback = callback;
        },
    
        onPlayerEquipItem: function(callback) {
            this.equip_callback = callback;
        },
    
        onPlayerMoveToItem: function(callback) {
            this.lootmove_callback = callback;
        },
    
        onPlayerTeleport: function(callback) {
            this.teleport_callback = callback;
        },

        onPlayerWarp: function(callback) {
            this.warp_callback = callback;
        },
    
        onChatMessage: function(callback) {
            this.chat_callback = callback;
        },
    
        onDropItem: function(callback) {
            this.drop_callback = callback;
        },
    
        onPlayerDamageMob: function(callback) {
            this.dmg_callback = callback;
        },

        onMobHealthChange: function(callback) {
            this.mobhealth_callback = callback;
        },

        onProgression: function(callback) {
            this.progression_callback = callback;
        },

        sendAllocateStat: function(statIndex, points) {
            this.sendMessage([Types.Messages.ALLOCATE_STAT,
                              statIndex,
                              points || 1]);
        },
    
        onPlayerKillMob: function(callback) {
            this.kill_callback = callback;
        },
    
        onPopulationChange: function(callback) {
            this.population_callback = callback;
        },
    
        onEntityList: function(callback) {
            this.list_callback = callback;
        },
    
        onEntityDestroy: function(callback) {
            this.destroy_callback = callback;
        },
    
        onPlayerChangeMaxHitPoints: function(callback) {
            this.hp_callback = callback;
        },
    
        onItemBlink: function(callback) {
            this.blink_callback = callback;
        },

        onInventory: function(callback) {
            this.inventory_callback = callback;
        },

        sendEquipItem: function(kind) {
            this.sendMessage([Types.Messages.EQUIP_ITEM,
                              kind]);
        },

        sendUnequip: function(kind) {
            this.sendMessage([Types.Messages.UNEQUIP,
                              kind]);
        },

        sendBuyItem: function(kind) {
            this.sendMessage([Types.Messages.BUY_ITEM,
                              kind]);
        },

        sendSellItem: function(kind) {
            this.sendMessage([Types.Messages.SELL_ITEM,
                              kind]);
        },

        sendUseItem: function(kind) {
            this.sendMessage([Types.Messages.USE_ITEM,
                              kind]);
        },

        sendHello: function(player, loadout, progression) {
            var msg = [Types.Messages.HELLO,
                       player.name,
                       Types.getKindFromString(player.getSpriteName()),
                       Types.getKindFromString(player.getWeaponName())];

            // Keep positions stable: the loadout ({equipment, inventory, gold})
            // is always the 4th field (empty if none), progression the optional 5th.
            msg.push(loadout || []);

            if(progression) {
                msg.push(progression);
            }

            this.sendMessage(msg);
        },

        sendMove: function(x, y) {
            this.sendMessage([Types.Messages.MOVE,
                              x,
                              y]);
        },
    
        sendLootMove: function(item, x, y) {
            this.sendMessage([Types.Messages.LOOTMOVE,
                              x,
                              y,
                              item.id]);
        },
    
        sendAggro: function(mob) {
            this.sendMessage([Types.Messages.AGGRO,
                              mob.id]);
        },
    
        sendAttack: function(mob) {
            this.sendMessage([Types.Messages.ATTACK,
                              mob.id]);
        },
    
        sendHit: function(mob) {
            this.sendMessage([Types.Messages.HIT,
                              mob.id]);
        },
    
        sendHurt: function(mob) {
            this.sendMessage([Types.Messages.HURT,
                              mob.id]);
        },
    
        sendChat: function(text) {
            this.sendMessage([Types.Messages.CHAT,
                              text]);
        },
    
        sendLoot: function(item) {
            this.sendMessage([Types.Messages.LOOT,
                              item.id]);
        },
    
        sendTeleport: function(x, y) {
            this.sendMessage([Types.Messages.TELEPORT,
                              x,
                              y]);
        },
    
        sendWho: function(ids) {
            ids.unshift(Types.Messages.WHO);
            this.sendMessage(ids);
        },
    
        sendZone: function() {
            this.sendMessage([Types.Messages.ZONE]);
        },
    
        sendOpen: function(chest) {
            this.sendMessage([Types.Messages.OPEN,
                              chest.id]);
        },
    
        sendCheck: function(id) {
            this.sendMessage([Types.Messages.CHECK,
                              id]);
        }
    });
    
    return GameClient;
});