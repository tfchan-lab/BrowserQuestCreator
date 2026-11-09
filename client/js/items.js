
// Consumable (non-equipment) item classes plus the generated equipment classes.
// Equipment classes/builder metadata come from items.generated.js (built from
// shared/data/equipment.json). EntityFactory registration happens in
// entityfactory.js to avoid a circular dependency.
define(['item', 'items.generated'], function(Item, GeneratedItems) {

    var Items = {};

    // Copy generated equipment classes onto this module.
    for(var key in GeneratedItems) {
        if(key !== '_builders' && GeneratedItems.hasOwnProperty(key)) {
            Items[key] = GeneratedItems[key];
        }
    }

    Items._builders = (GeneratedItems._builders || []).slice();

    // ---- Consumables (not part of the equipment data) ----

    Items.Flask = Item.extend({
        init: function(id) {
            this._super(id, Types.Entities.FLASK, "object");
            this.lootMessage = "You drink a health potion";
        },
    });

    Items.Cake = Item.extend({
        init: function(id) {
            this._super(id, Types.Entities.CAKE, "object");
            this.lootMessage = "You eat a cake";
        },
    });

    Items.Burger = Item.extend({
        init: function(id) {
            this._super(id, Types.Entities.BURGER, "object");
            this.lootMessage = "You can haz rat burger";
        },
    });

    Items.FirePotion = Item.extend({
        init: function(id) {
            this._super(id, Types.Entities.FIREPOTION, "object");
            this.lootMessage = "You feel the power of Firefox!";
        },

        onLoot: function(player) {
            player.startInvincibility();
        },
    });

    // Consumable builder metadata (equipment entries are already in _builders).
    Items._builders.push(
        { kind: "FLASK", className: "Flask" },
        { kind: "CAKE", className: "Cake" },
        { kind: "BURGER", className: "Burger" },
        { kind: "FIREPOTION", className: "FirePotion" }
    );

    return Items;
});
