
define(['jquery', 'storage', '../../shared/js/equipment'], function($, Storage, Equipment) {

    var App = Class.extend({
        init: function() {
            this.currentPage = 1;
            this.blinkInterval = null;
            this.previousState = null;
            this.isParchmentReady = true;
            this.ready = false;
            this.storage = new Storage();
            this.watchNameInputInterval = setInterval(this.toggleButton.bind(this), 100);
            this.$playButton = $('.play'),
            this.$playDiv = $('.play div');
        },
        
        setGame: function(game) {
            this.game = game;
            this.isMobile = this.game.renderer.mobile;
            this.isTablet = this.game.renderer.tablet;
            this.isDesktop = !(this.isMobile || this.isTablet);
            this.supportsWorkers = !!window.Worker;
            this.ready = true;
        },
    
        center: function() {
            window.scrollTo(0, 1);
        },
        
        canStartGame: function() {
            if(this.isDesktop) {
                return (this.game && this.game.map && this.game.map.isLoaded);
            } else {
                return this.game;
            }
        },
        
        tryStartingGame: function(username, starting_callback) {
            var self = this,
                $play = this.$playButton;
            
            if(username !== '') {
                if(!this.ready || !this.canStartGame()) {
                    if(!this.isMobile) {
                        // on desktop and tablets, add a spinner to the play button
                        $play.addClass('loading');
                    }
                    this.$playDiv.unbind('click');
                    var watchCanStart = setInterval(function() {
                        log.debug("waiting...");
                        if(self.canStartGame()) {
                            setTimeout(function() {
                                if(!self.isMobile) {
                                    $play.removeClass('loading');
                                }
                            }, 1500);
                            clearInterval(watchCanStart);
                            self.startGame(username, starting_callback);
                        }
                    }, 100);
                } else {
                    this.$playDiv.unbind('click');
                    this.startGame(username, starting_callback);
                }      
            }
        },
        
        startGame: function(username, starting_callback) {
            var self = this;
            
            if(starting_callback) {
                starting_callback();
            }
            this.hideIntro(function() {
                if(!self.isDesktop) {
                    // On mobile and tablet we load the map after the player has clicked
                    // on the PLAY button instead of loading it in a web worker.
                    self.game.loadMap();
                }
                self.start(username);
            });
        },

        start: function(username) {
            var self = this,
                firstTimePlaying = !self.storage.hasAlreadyPlayed();
            
            if(username && !this.game.started) {
                var optionsSet = false,
                    config = this.config;

                //>>includeStart("devHost", pragmas.devHost);
                if(config.local) {
                    log.debug("Starting game with local dev config.");
                    this.game.setServerOptions(config.local.host, config.local.port, username);
                } else {
                    log.debug("Starting game with default dev config.");
                    this.game.setServerOptions(config.dev.host, config.dev.port, username);
                }
                optionsSet = true;
                //>>includeEnd("devHost");
                
                //>>includeStart("prodHost", pragmas.prodHost);
                if(!optionsSet) {
                    log.debug("Starting game with build config.");
                    this.game.setServerOptions(config.build.host, config.build.port, username);
                }
                //>>includeEnd("prodHost");

                this.center();
                this.game.run(function() {
                    $('body').addClass('started');
                	if(firstTimePlaying) {
                	    self.toggleInstructions();
                	}
            	});
            }
        },

        setMouseCoordinates: function(event) {
            var gamePos = $('#container').offset(),
                scale = this.game.renderer.getScaleFactor(),
                width = this.game.renderer.getWidth(),
                height = this.game.renderer.getHeight(),
                mouse = this.game.mouse;

            mouse.x = event.pageX - gamePos.left - (this.isMobile ? 0 : 5 * scale);
        	mouse.y = event.pageY - gamePos.top - (this.isMobile ? 0 : 7 * scale);

        	if(mouse.x <= 0) {
        	    mouse.x = 0;
        	} else if(mouse.x >= width) {
        	    mouse.x = width - 1;
        	}

        	if(mouse.y <= 0) {
        	    mouse.y = 0;
        	} else if(mouse.y >= height) {
        	    mouse.y = height - 1;
        	}
        },

        initHealthBar: function() {
            var scale = this.game.renderer.getScaleFactor(),
                healthMaxWidth = $("#healthbar").width() - (12 * scale);

        	this.game.onPlayerHealthChange(function(hp, maxHp) {
        	    var barWidth = Math.round((healthMaxWidth / maxHp) * (hp > 0 ? hp : 0));
        	    $("#hitpoints").css('width', barWidth + "px");
        	    $("#hp-text").text((hp > 0 ? hp : 0) + "/" + maxHp);
        	});

        	this.game.onPlayerHurt(this.blinkHealthBar.bind(this));
        },

        blinkHealthBar: function() {
            var $hitpoints = $('#hitpoints');

            $hitpoints.addClass('white');
            setTimeout(function() {
                $hitpoints.removeClass('white');
            }, 500)
        },

        toggleButton: function() {
            var name = $('#parchment input').val(),
                $play = $('#createcharacter .play');
    
            if(name && name.length > 0) {
                $play.removeClass('disabled');
                $('#character').removeClass('disabled');
            } else {
                $play.addClass('disabled');
                $('#character').addClass('disabled');
            }
        },

        hideIntro: function(hidden_callback) {
            clearInterval(this.watchNameInputInterval);
            $('body').removeClass('intro');
            setTimeout(function() {
                $('body').addClass('game');
                hidden_callback();
            }, 1000);
        },

        showChat: function() {
            if(this.game.started) {
                $('#chatbox').addClass('active');
                $('#chatinput').focus();
                $('#chatbutton').addClass('active');
            }
        },

        hideChat: function() {
            if(this.game.started) {
                $('#chatbox').removeClass('active');
                $('#chatinput').blur();
                $('#chatbutton').removeClass('active');
            }
        },

        toggleInstructions: function() {
            if($('#achievements').hasClass('active')) {
        	    this.toggleAchievements();
        	    $('#achievementsbutton').removeClass('active');
        	}
            $('#instructions').toggleClass('active');
        },

        toggleAchievements: function() {
        	if($('#instructions').hasClass('active')) {
        	    this.toggleInstructions();
        	    $('#helpbutton').removeClass('active');
        	}
            this.resetPage();
            $('#achievements').toggleClass('active');
        },

        resetPage: function() {
            var self = this,
                $achievements = $('#achievements');

            if($achievements.hasClass('active')) {
                $achievements.bind(TRANSITIONEND, function() {
                    $achievements.removeClass('page' + self.currentPage).addClass('page1');
                    self.currentPage = 1;
                    $achievements.unbind(TRANSITIONEND);
                });
            }
        },

        initEquipmentIcons: function() {
            var scale = this.game.renderer.getScaleFactor();
            var getIconPath = function(spriteName) {
                    return 'img/'+ scale +'/item-' + spriteName + '.png';
                },
                weapon = this.game.player.getWeaponName(),
                armor = this.game.player.getSpriteName(),
                weaponPath = getIconPath(weapon),
                armorPath = getIconPath(armor);

            $('#weapon').css('background-image', 'url("' + weaponPath + '")');
            if(armor !== 'firefox') {
                $('#armor').css('background-image', 'url("' + armorPath + '")');
            }
        },

        getItemIconPath: function(kind) {
            var scale = this.game.renderer.getScaleFactor(),
                sprite = (Equipment && Equipment.getItemSpriteName(kind)) || ('item-' + Types.getKindAsString(kind));
            return 'img/' + scale + '/' + sprite + '.png';
        },

        /**
         * Updates the level text, XP bar and stat-point indicator.
         * @param {Object} prog progression snapshot from the server
         */
        updateProgression: function(prog) {
            if(!prog) { return; }

            this.progression = prog;

            $('#level-text').text('Lv ' + prog.level);

            var pct = 0;
            if(prog.xpToNext > 0) {
                pct = Math.max(0, Math.min(100, Math.round((prog.xp / prog.xpToNext) * 100)));
            } else {
                pct = 100; // max level
            }
            $('#xp-fill').css('width', pct + '%');
            $('#xp-text').text(prog.xpToNext > 0 ? (prog.xp + ' / ' + prog.xpToNext + ' XP') : 'MAX');

            var pts = prog.availablePoints | 0;
            if(pts > 0) {
                $('#stat-points').show();
                $('#stat-points-count').text(pts);
            } else {
                $('#stat-points').hide();
            }

            this.updateStatsPanel(prog);
        },

        /** Human-friendly full stat names. */
        statLabels: {
            vigor: 'Vigor',
            mind: 'Mind',
            endurance: 'Endurance',
            strength: 'Strength',
            dexterity: 'Dexterity',
            intelligence: 'Intelligence',
            faith: 'Faith',
            arcane: 'Arcane'
        },

        /** Short descriptions shown as tooltips. */
        statDescriptions: {
            vigor: 'Vigor — increases maximum health',
            mind: 'Mind — max mana (not yet implemented)',
            endurance: 'Endurance — stamina / equip weight (not yet implemented)',
            strength: 'Strength — weapon attack power',
            dexterity: 'Dexterity — attack & dodge (not yet implemented)',
            intelligence: 'Intelligence — magic attack (not yet implemented)',
            faith: 'Faith — reserved',
            arcane: 'Arcane — reserved'
        },

        /**
         * Renders the character/stats panel from a progression snapshot.
         * @param {Object} prog progression snapshot (level, availablePoints, stats)
         */
        updateStatsPanel: function(prog) {
            prog = prog || this.progression;
            if(!prog || !prog.stats) { return; }

            var self = this,
                stats = prog.stats,
                available = prog.availablePoints | 0,
                allocated = (this.game && this.game.allocated) || {};

            $('#stats-level').text('Level ' + prog.level);
            $('#stats-available').text(available + (available === 1 ? ' point' : ' points') + ' available');

            var $list = $('#stats-list').empty();
            _.each(Types.StatsOrder, function(stat, index) {
                var extra = allocated[stat] | 0,
                    $li = $('<li></li>'),
                    $name = $('<span class="stat-name"></span>').text(self.statLabels[stat] || stat)
                                .attr('title', self.statDescriptions[stat] || ''),
                    $value = $('<span class="stat-value"></span>').text(stats[stat]),
                    $alloc = $('<span class="stat-alloc"></span>').text(extra > 0 ? ('+' + extra) : ''),
                    $add = $('<button class="stat-add" type="button">+</button>');

                if(available <= 0) {
                    $add.addClass('disabled');
                }

                $add.click(function() {
                    if(!self.game) { return; }
                    self.game.allocateStat(index, 1);
                });

                $li.append($name).append($value).append($alloc).append($add);
                $list.append($li);
            });
        },

        toggleStats: function() {
            $('#stats-panel').toggleClass('active');
            if($('#stats-panel').hasClass('active')) {
                this.updateStatsPanel();
            }
        },

        /**
         * Human-readable display name for an item kind. Equipment names come from
         * the equipment data; other kinds fall back to the kind name.
         */
        getItemDisplayName: function(kind) {
            // Explicit display-name override (e.g. warp item "[★ Initial Town]").
            var override = Types.getItemDisplayName && Types.getItemDisplayName(kind);
            if(override) { return override; }

            var item = Equipment && Equipment.getItem(kind);
            var raw = item ? item.name : Types.getKindAsString(kind);
            if(!raw) { return ''; }
            // Turn "Steel_Sword" / "steelSword" into "Steel Sword".
            return String(raw)
                .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
                .replace(/[_-]+/g, ' ')
                .replace(/\b\w/g, function(c) { return c.toUpperCase(); });
        },

        updateInventory: function(equipment, weaponKind, armorKind, inventoryCounts, gold) {
            var self = this,
                $equip = $('#inventory-equipment').empty(),
                $items = $('#inventory-items').empty();

            equipment = equipment || [];
            inventoryCounts = inventoryCounts || {};

            $('#gold-amount').text(gold || 0);

            $('#equipped-weapon').css('background-image', weaponKind ? 'url("' + this.getItemIconPath(weaponKind) + '")' : 'none');
            $('#equipped-armor').css('background-image', armorKind ? 'url("' + this.getItemIconPath(armorKind) + '")' : 'none');

            var addEquipment = function(kind) {
                var name = self.getItemDisplayName(kind),
                    isEquipped = (kind === weaponKind || kind === armorKind),
                    $li = $('<li class="inv-item clickable"></li>').attr('data-kind', kind),
                    $icon = $('<div class="inv-icon"></div>').css('background-image', 'url("' + self.getItemIconPath(kind) + '")'),
                    $name = $('<span class="inv-name"></span>').text(name);

                if(isEquipped) {
                    $li.addClass('equipped');
                }

                $li.append($icon).append($name);
                $li.click(function() {
                    self.game.equipItem(kind);
                });
                $equip.append($li);
            };

            // Equipment: unique gear kinds, grouped by type, sorted by rank.
            var types = Equipment.getTypes();
            _.each(types, function(cfg, typeName) {
                var kinds = _.filter(equipment, function(kind) {
                    return Types.getTypeOf(kind) === typeName;
                });
                kinds.sort(function(a, b) {
                    return (Equipment.getRank(a) || 0) - (Equipment.getRank(b) || 0);
                });
                _.each(kinds, addEquipment);
            });

            if(equipment.length === 0) {
                $equip.append('<li class="empty">(empty)</li>');
            }

            // Items: stackable inventory (consumables, shop items, duplicate gear).
            var addStackItem = function(kind, count) {
                var name = self.getItemDisplayName(kind),
                    usable = Types.isUsableItem && Types.isUsableItem(kind),
                    $li = $('<li class="inv-item"></li>').attr('data-kind', kind),
                    $icon = $('<div class="inv-icon"></div>').css('background-image', 'url("' + self.getItemIconPath(kind) + '")'),
                    $name = $('<span class="inv-name"></span>').text(name),
                    $count = $('<span class="inv-count"></span>').text('x' + count);

                if(usable) {
                    $li.addClass('usable').attr('title', 'Click to use');
                    $li.click(function() {
                        self.game.useItem(kind);
                    });
                }

                $li.append($icon).append($name).append($count);
                $items.append($li);
            };

            var itemCount = 0;
            _.each(inventoryCounts, function(count, key) {
                var kind = parseInt(key, 10);
                if(isNaN(kind) || !count || count <= 0) { return; }
                addStackItem(kind, count);
                itemCount++;
            });

            if(itemCount === 0) {
                $items.append('<li class="empty">(empty)</li>');
            }
        },

        toggleInventory: function() {
            var $inv = $('#inventory');
            $inv.toggleClass('active');
        },

        /**
         * Opens the shop HUD for the given NPC and updates its contents.
         * @param {Object} npc   the NPC entity (has getShopConfig()).
         * @param {Object} shop  the shop config ({ items: [{kind, price}] }).
         */
        openShop: function(npc, shop) {
            this.currentShopNpc = npc;
            this.currentShop = shop || (npc && npc.getShopConfig && npc.getShopConfig());
            $('#shop-title').text((npc && npc.getDisplayName && npc.getDisplayName()) || 'Shop');
            this.updateShop();
            $('#shop').addClass('active');
        },

        closeShop: function() {
            $('#shop').removeClass('active');
            this.currentShop = null;
            this.currentShopNpc = null;
        },

        updateShop: function() {
            var self = this,
                shop = this.currentShop,
                gold = this.game.getGold(),
                $buy = $('#shop-buy').empty(),
                $sell = $('#shop-sell').empty();

            $('#shop-gold-amount').text(gold);

            // Buy list: the NPC's stock.
            var items = (shop && shop.items) || [];
            if(items.length === 0) {
                $buy.append('<li class="empty">(nothing for sale)</li>');
            } else {
                _.each(items, function(entry) {
                    var kind = (typeof entry.kind === 'number') ? entry.kind : Types.getKindFromString(entry.kind),
                        price = entry.price || 0,
                        canAfford = gold >= price,
                        $li = $('<li class="shop-item"></li>'),
                        $icon = $('<div class="inv-icon"></div>').css('background-image', 'url("' + self.getItemIconPath(kind) + '")'),
                        $name = $('<span class="inv-name"></span>').text(self.getItemDisplayName(kind)),
                        $price = $('<span class="shop-price"></span>').text(price + 'g'),
                        $btn = $('<button type="button" class="shop-buy-btn">Buy</button>');

                    if(!canAfford) { $btn.prop('disabled', true); }
                    $btn.click(function() { self.game.buyItem(kind); });

                    $li.append($icon).append($name).append($price).append($btn);
                    $buy.append($li);
                });
            }

            // Sell list: stackable items the player carries.
            var counts = this.game.getInventoryCounts(),
                sellCount = 0;
            _.each(counts, function(count, key) {
                var kind = parseInt(key, 10);
                if(isNaN(kind) || !count || count <= 0) { return; }
                var value = self.getSellValue(kind),
                    $li = $('<li class="shop-item"></li>'),
                    $icon = $('<div class="inv-icon"></div>').css('background-image', 'url("' + self.getItemIconPath(kind) + '")'),
                    $name = $('<span class="inv-name"></span>').text(self.getItemDisplayName(kind) + ' x' + count),
                    $price = $('<span class="shop-price"></span>').text('+' + value + 'g'),
                    $btn = $('<button type="button" class="shop-sell-btn">Sell</button>');

                $btn.click(function() { self.game.sellItem(kind); });

                $li.append($icon).append($name).append($price).append($btn);
                $sell.append($li);
                sellCount++;
            });
            if(sellCount === 0) {
                $sell.append('<li class="empty">(nothing to sell)</li>');
            }
        },

        /** Client-side sell value estimate (server is authoritative). */
        getSellValue: function(kind) {
            if((Types.isArmor(kind) || Types.isWeapon(kind)) && Equipment.getSellPrice) {
                return Equipment.getSellPrice(kind);
            }
            var fallback = { flask: 3, burger: 5, cake: 8, firepotion: 10, teleportscroll: 15 };
            var name = Types.getKindAsString(kind);
            return fallback[name] || 1;
        },

        /**
         * Updates the full-sized "targeted mob" HP bar shown above the player's
         * HP bar. Pass null (or a non-mob / dead entity) to hide it.
         */
        updateTargetBar: function(mob) {
            var $bar = $('#target-bar');

            if(!mob || Types.isPlayer(mob.kind) || mob.isDead || !(mob.hitPoints > 0 && mob.maxHitPoints > 0)) {
                $bar.removeClass('visible');
                return;
            }

            var max = mob.maxHitPoints,
                hp = Math.max(0, Math.min(mob.hitPoints, max)),
                pct = Math.round((hp / max) * 100),
                name = Types.getKindAsString(mob.kind);

            $('#target-name').text(name ? (name.charAt(0).toUpperCase() + name.slice(1)) : '');
            $('#target-hp-fill').css('width', pct + '%');
            $('#target-hp-text').text(hp + '/' + max);
            $bar.addClass('visible');
        },

        hideWindows: function() {
            if($('#inventory').hasClass('active')) {
                $('#inventory').removeClass('active');
            }
            if($('#shop').hasClass('active')) {
                $('#shop').removeClass('active');
                this.currentShop = null;
                this.currentShopNpc = null;
            }
            if($('#stats-panel').hasClass('active')) {
                $('#stats-panel').removeClass('active');
            }
            if($('#achievements').hasClass('active')) {
        	    this.toggleAchievements();
        	    $('#achievementsbutton').removeClass('active');
        	}
        	if($('#instructions').hasClass('active')) {
        	    this.toggleInstructions();
        	    $('#helpbutton').removeClass('active');
        	}
        	if($('body').hasClass('credits')) {
        	    this.closeInGameCredits();
        	}
        	if($('body').hasClass('about')) {
        	    this.closeInGameAbout();
        	}
        },

        showAchievementNotification: function(id, name) {
            var $notif = $('#achievement-notification'),
                $name = $notif.find('.name'),
                $button = $('#achievementsbutton');

            $notif.removeClass().addClass('active achievement' + id);
            $name.text(name);
            if(this.game.storage.getAchievementCount() === 1) {
                this.blinkInterval = setInterval(function() {
                    $button.toggleClass('blink');
                }, 500);
            }
            setTimeout(function() {
                $notif.removeClass('active');
                $button.removeClass('blink');
            }, 5000);
        },

        displayUnlockedAchievement: function(id) {
            var $achievement = $('#achievements li.achievement' + id);

            var achievement = this.game.getAchievementById(id);
            if(achievement && achievement.hidden) {
                this.setAchievementData($achievement, achievement.name, achievement.desc);
            }
            $achievement.addClass('unlocked');
        },

        unlockAchievement: function(id, name) {
            this.showAchievementNotification(id, name);
            this.displayUnlockedAchievement(id);

            var nb = parseInt($('#unlocked-achievements').text());
            $('#unlocked-achievements').text(nb + 1);
        },

        initAchievementList: function(achievements) {
            var self = this,
                $lists = $('#lists'),
                $page = $('#page-tmpl'),
                $achievement = $('#achievement-tmpl'),
                page = 0,
                count = 0,
                $p = null;

            _.each(achievements, function(achievement) {
                count++;
    
                var $a = $achievement.clone();
                $a.removeAttr('id');
                $a.addClass('achievement'+count);
                if(!achievement.hidden) {
                    self.setAchievementData($a, achievement.name, achievement.desc);
                }
                $a.find('.twitter').attr('href', 'http://twitter.com/share?url=http%3A%2F%2Fbrowserquest.mozilla.org&text=I%20unlocked%20the%20%27'+ achievement.name +'%27%20achievement%20on%20Mozilla%27s%20%23BrowserQuest%21&related=glecollinet:Creators%20of%20BrowserQuest%2Cwhatthefranck');
                $a.show();
                $a.find('a').click(function() {
                     var url = $(this).attr('href');

                    self.openPopup('twitter', url);
                    return false;
                });
    
                if((count - 1) % 4 === 0) {
                    page++;
                    $p = $page.clone();
                    $p.attr('id', 'page'+page);
                    $p.show();
                    $lists.append($p);
                }
                $p.append($a);
            });

            $('#total-achievements').text($('#achievements').find('li').length);
        },

        initUnlockedAchievements: function(ids) {
            var self = this;
            
            _.each(ids, function(id) {
                self.displayUnlockedAchievement(id);
            });
            $('#unlocked-achievements').text(ids.length);
        },

        setAchievementData: function($el, name, desc) {
            $el.find('.achievement-name').html(name);
            $el.find('.achievement-description').html(desc);
        },

        toggleCredits: function() {
            var currentState = $('#parchment').attr('class');

            if(this.game.started) {
                $('#parchment').removeClass().addClass('credits');
                
                $('body').toggleClass('credits');
                    
                if(!this.game.player) {
                    $('body').toggleClass('death');
                }
                if($('body').hasClass('about')) {
                    this.closeInGameAbout();
                    $('#helpbutton').removeClass('active');
                }
            } else {
                if(currentState !== 'animate') {
                    if(currentState === 'credits') {
                        this.animateParchment(currentState, this.previousState);
                    } else {
            	        this.animateParchment(currentState, 'credits');
            	        this.previousState = currentState;
            	    }
                }
            }
        },
        
        toggleAbout: function() {
            var currentState = $('#parchment').attr('class');

            if(this.game.started) {
                $('#parchment').removeClass().addClass('about');
                $('body').toggleClass('about');
                if(!this.game.player) {
                    $('body').toggleClass('death');
                }
                if($('body').hasClass('credits')) {
                    this.closeInGameCredits();
                }
            } else {
                if(currentState !== 'animate') {
                    if(currentState === 'about') {
                        if(localStorage && localStorage.data) {
                            this.animateParchment(currentState, 'loadcharacter');
                        } else {
                            this.animateParchment(currentState, 'createcharacter');
                        }
                    } else {
            	        this.animateParchment(currentState, 'about');
            	        this.previousState = currentState;
            	    }
                }
            }
        },

        closeInGameCredits: function() {
            $('body').removeClass('credits');
            $('#parchment').removeClass('credits');
            if(!this.game.player) {
                $('body').addClass('death');
            }
        },
        
        closeInGameAbout: function() {
            $('body').removeClass('about');
            $('#parchment').removeClass('about');
            if(!this.game.player) {
                $('body').addClass('death');
            }
            $('#helpbutton').removeClass('active');
        },
        
        togglePopulationInfo: function() {
            $('#population').toggleClass('visible');
        },

        openPopup: function(type, url) {
            var h = $(window).height(),
                w = $(window).width(),
                popupHeight,
                popupWidth,
                top,
                left;

            switch(type) {
                case 'twitter':
                    popupHeight = 450;
                    popupWidth = 550;
                    break;
                case 'facebook':
                    popupHeight = 400;
                    popupWidth = 580;
                    break;
            }

            top = (h / 2) - (popupHeight / 2);
            left = (w / 2) - (popupWidth / 2);

        	newwindow = window.open(url,'name','height=' + popupHeight + ',width=' + popupWidth + ',top=' + top + ',left=' + left);
        	if (window.focus) {newwindow.focus()}
        },

        animateParchment: function(origin, destination) {
            var self = this,
                $parchment = $('#parchment'),
                duration = 1;

            if(this.isMobile) {
                $parchment.removeClass(origin).addClass(destination);
            } else {
                if(this.isParchmentReady) {
                    if(this.isTablet) {
                        duration = 0;
                    }
                    this.isParchmentReady = !this.isParchmentReady;
        
                    $parchment.toggleClass('animate');
                    $parchment.removeClass(origin);

                    setTimeout(function() {
                        $('#parchment').toggleClass('animate');
                        $parchment.addClass(destination);
                    }, duration * 1000);
        
                    setTimeout(function() {
                        self.isParchmentReady = !self.isParchmentReady;
                    }, duration * 1000);
        	    }
            }
        },

        animateMessages: function() {
            var $messages = $('#notifications div');

            $messages.addClass('top');
        },

        resetMessagesPosition: function() {
            var message = $('#message2').text();

            $('#notifications div').removeClass('top');
            $('#message2').text('');
            $('#message1').text(message);
        },

        showMessage: function(message) {
            var $wrapper = $('#notifications div'),
                $message = $('#notifications #message2');

            this.animateMessages();
            $message.text(message);
            if(this.messageTimer) {
                this.resetMessageTimer();
            }

            this.messageTimer = setTimeout(function() {
                    $wrapper.addClass('top');
            }, 5000);
        },

        resetMessageTimer: function() {
            clearTimeout(this.messageTimer);
        },
        
        resizeUi: function() {
            if(this.game) {
                if(this.game.started) {
                    this.game.resize();
                    this.initHealthBar();
                    this.game.updateBars();
                } else {
                    var newScale = this.game.renderer.getScaleFactor();
                    this.game.renderer.rescale(newScale);
                }
            } 
        }
    });

    return App;
});