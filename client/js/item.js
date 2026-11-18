
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

        /**
         * Called when the player picks the item up. The base implementation does
         * nothing: equipment is never auto-equipped based on tier. Only actual
         * equip actions (inventory click -> server EQUIP) change gear. Consumable
         * subclasses (e.g. FirePotion) override this.
         */
        onLoot: function(player) {
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
