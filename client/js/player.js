
define(['character', 'exceptions'], function(Character, Exceptions) {

    var Player = Character.extend({
        MAX_LEVEL: 10,
    
        init: function(id, name, kind) {
            this._super(id, kind);
        
            this.name = name;
        
            // Renderer
     		this.nameOffsetY = -10;
        
            // sprites
            this.spriteName = "clotharmor";
            this.weaponName = "sword1";
        
            // modes
            this.isLootMoving = false;
            this.isSwitchingWeapon = true;
        },
    
        loot: function(item) {
            if(item) {
                // No tier comparison / auto-equip: the server adds looted gear to
                // the inventory; equipping is always an explicit player action.
                log.info('Player '+this.id+' has looted '+item.id);
                item.onLoot(this);
            }
        },
    
        /**
         * Returns true if the character is currently walking towards an item in order to loot it.
         */
        isMovingToLoot: function() {
            return this.isLootMoving;
        },
    
        getSpriteName: function() {
            return this.spriteName;
        },
    
        setSpriteName: function(name) {
            this.spriteName = name;
        },
        
        getArmorName: function() {
            var sprite = this.getArmorSprite();
            return sprite.id;
        },
        
        getArmorSprite: function() {
            if(this.invincible) {
                return this.currentArmorSprite;
            } else {
                return this.sprite;
            }
        },
    
        getWeaponName: function() {
            return this.weaponName;
        },
    
        setWeaponName: function(name) {
            this.weaponName = name;
        },
    
        hasWeapon: function() {
            return this.weaponName !== null;
        },
    
        switchWeapon: function(newWeaponName) {
            var self = this;

            if(newWeaponName !== this.getWeaponName()) {
                // Cancel any in-flight weapon switch (stored on the instance so it
                // can actually be cleared; a local var could never cancel a prior
                // interval).
                if(this._switchWeaponInterval) {
                    clearInterval(this._switchWeaponInterval);
                    this._switchWeaponInterval = null;
                }

                var count = 14,
                    value = false;

                this._switchWeaponInterval = setInterval(function() {
                    value = !value;
                    self.setWeaponName(value ? newWeaponName : null);

                    count -= 1;
                    if(count === 1) {
                        clearInterval(self._switchWeaponInterval);
                        self._switchWeaponInterval = null;
                        self.setWeaponName(newWeaponName); // ensure final state
                        if(self.switch_callback) {
                            self.switch_callback();
                        }
                    }
                }, 90);
            }
        },

        switchArmor: function(newArmorSprite) {
            var self = this;

            if(newArmorSprite && newArmorSprite.id !== this.getSpriteName()) {
                if(this._switchArmorInterval) {
                    clearInterval(this._switchArmorInterval);
                    this._switchArmorInterval = null;
                }

                self.setSprite(newArmorSprite);
                self.setSpriteName(newArmorSprite.id);
                // setSprite rebuilds the animation set, but setAnimation() returns
                // early when the animation name is unchanged, so the old frames
                // would keep rendering. Clear the current animation to force it to
                // be re-derived from the new sprite.
                self.currentAnimation = null;
                self.idle();
                self.setVisible(true);

                var count = 14,
                    value = false;

                this._switchArmorInterval = setInterval(function() {
                    value = !value;
                    self.setVisible(value);

                    count -= 1;
                    if(count === 1) {
                        clearInterval(self._switchArmorInterval);
                        self._switchArmorInterval = null;
                        self.setVisible(true); // never leave the player invisible
                        if(self.switch_callback) {
                            self.switch_callback();
                        }
                    }
                }, 90);
            }
        },
        
        onArmorLoot: function(callback) {
            this.armorloot_callback = callback;
        },
    
        onSwitchItem: function(callback) {
            this.switch_callback = callback;
        },
        
        onInvincible: function(callback) {
            this.invincible_callback = callback;
        },

        startInvincibility: function() {
            var self = this;
        
            if(!this.invincible) {
                this.currentArmorSprite = this.getSprite();
                this.invincible = true;
                this.invincible_callback();      
            } else {
                // If the player already has invincibility, just reset its duration.
                if(this.invincibleTimeout) {
                    clearTimeout(this.invincibleTimeout);
                }
            }
        
            this.invincibleTimeout = setTimeout(function() {
                self.stopInvincibility();
                self.idle();
            }, 15000);
        },
    
        stopInvincibility: function() {
            this.invincible_callback();
            this.invincible = false;
        
            if(this.currentArmorSprite) {
                this.setSprite(this.currentArmorSprite);
                this.setSpriteName(this.currentArmorSprite.id);
                this.currentArmorSprite = null;
            }
            if(this.invincibleTimeout) {
                clearTimeout(this.invincibleTimeout);
            }
        }
    });

    return Player;
});