
define(['entity', '../../shared/js/equipment'], function(Entity, Equipment) {

    var Item = Entity.extend({
        init: function(id, kind, type) {
    	    this._super(id, kind);

            this.itemKind = Types.getKindAsString(kind);
    	    this.type = type;
    	    this.wasDropped = false;
        },

        hasShadow: function() {
            return true;
        },

        isBetterThanEquipped: function(player) {
            var rank = Equipment.getRank(this.kind);

            if(this.type === "weapon") {
                var current = Types.getKindFromString(player.getWeaponName());
                return current === undefined || rank > Equipment.getRank(current);
            } else if(this.type === "armor") {
                var currentArmor = Types.getKindFromString(player.getArmorName());
                return currentArmor === undefined || rank > Equipment.getRank(currentArmor);
            }
            return false;
        },

        onLoot: function(player) {
            // Optimistically apply only the auto-equip the server will perform
            // (items strictly better than what is currently equipped).
            if(!this.isBetterThanEquipped(player)) {
                return;
            }

            if(this.type === "weapon") {
                player.switchWeapon(this.itemKind);
            }
            else if(this.type === "armor") {
                player.armorloot_callback(this.itemKind);
            }
        },

        getSpriteName: function() {
            return Equipment.getItemSpriteName(this.kind) || ("item-" + this.itemKind);
        },

        getLootMessage: function() {
            return this.lootMessage || Equipment.getLootMessage(this.kind);
        }
    });
    
    return Item;
});
