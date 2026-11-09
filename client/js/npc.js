
define(['character', '../../shared/js/npcs'], function(Character, NPCData) {

    var Npc = Character.extend({
        init: function(id, kind) {
            this._super(id, kind, 1);
            this.itemKind = Types.getKindAsString(this.kind);
            this.talkIndex = 0;
        },

        /**
         * Finds this NPC's configuration (name, conversations, events) by its grid
         * position first, then falls back to matching by kind.
         */
        getConfig: function() {
            var cfg = null;
            if(this.gridX !== undefined && this.gridY !== undefined) {
                cfg = NPCData.getAt(this.gridX, this.gridY);
            }
            if(!cfg) {
                // Fallback: first NPC of the same kind.
                var list = NPCData.getAll();
                for(var i = 0; i < list.length; i++) {
                    if(list[i].kind === this.itemKind) { cfg = list[i]; break; }
                }
            }
            return cfg;
        },

        getDisplayName: function() {
            var cfg = this.getConfig();
            return (cfg && cfg.name) || this.itemKind;
        },

        getEvents: function() {
            var cfg = this.getConfig();
            return (cfg && cfg.events) || [];
        },

        getShopConfig: function() {
            if(typeof NPCData.getShop === 'function') {
                return NPCData.getShop(this.getConfig());
            }
            var events = this.getEvents();
            for(var i = 0; i < events.length; i++) {
                if(events[i] && events[i].type === 'shop') { return events[i]; }
            }
            return null;
        },

        talk: function() {
            var cfg = this.getConfig(),
                lines = (cfg && cfg.conversations) || [],
                count = lines.length,
                msg = null;

            if(count === 0) {
                this.talkIndex = 0;
                return null;
            }

            if(this.talkIndex >= count) {
                this.talkIndex = 0;
            }
            msg = lines[this.talkIndex];
            this.talkIndex += 1;

            return msg;
        }
    });
    
    return Npc;
});
