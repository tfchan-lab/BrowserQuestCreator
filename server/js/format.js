
var _ = require('underscore'),
    Types = require("../../shared/js/gametypes");

(function() {
    FormatChecker = Class.extend({
        init: function() {
            this.formats = [];
            this.formats[Types.Messages.HELLO] = ['s', 'n', 'n'],
            this.formats[Types.Messages.MOVE] = ['n', 'n'],
            this.formats[Types.Messages.LOOTMOVE] = ['n', 'n', 'n'],
            this.formats[Types.Messages.AGGRO] = ['n'],
            this.formats[Types.Messages.ATTACK] = ['n'],
            this.formats[Types.Messages.HIT] = ['n'],
            this.formats[Types.Messages.HURT] = ['n'],
            this.formats[Types.Messages.CHAT] = ['s'],
            this.formats[Types.Messages.LOOT] = ['n'],
            this.formats[Types.Messages.TELEPORT] = ['n', 'n'],
            this.formats[Types.Messages.ZONE] = [],
            this.formats[Types.Messages.OPEN] = ['n'],
            this.formats[Types.Messages.CHECK] = ['n'],
            this.formats[Types.Messages.EQUIP_ITEM] = ['n'],
            this.formats[Types.Messages.UNEQUIP] = ['n'],
            this.formats[Types.Messages.ALLOCATE_STAT] = ['n', 'n']
            this.formats[Types.Messages.BUY_ITEM] = ['n'];
            this.formats[Types.Messages.SELL_ITEM] = ['n'];
            this.formats[Types.Messages.USE_ITEM] = ['n'];
        },
        
        check: function(msg) {
            var message = msg.slice(0),
                type = message[0],
                format = this.formats[type];
            
            message.shift();
            
            if(format) {    
                // HELLO may carry an optional 4th param: an array of owned item kinds.
                if(type === Types.Messages.HELLO) {
                    return this.checkHello(message);
                }
                if(message.length !== format.length) {
                    return false;
                }
                for(var i = 0, n = message.length; i < n; i += 1) {
                    if(format[i] === 'n' && !_.isNumber(message[i])) {
                        return false;
                    }
                    if(format[i] === 's' && !_.isString(message[i])) {
                        return false;
                    }
                }
                return true;
            }
            else if(type === Types.Messages.WHO) {
                // WHO messages have a variable amount of params, all of which must be numbers.
                return message.length > 0 && _.all(message, function(param) { return _.isNumber(param) });
            }
            else {
                log.error("Unknown message type: "+type);
                return false;
            }
        },

        /**
         * HELLO: [name(string), armor(number), weapon(number), inventory?(array),
         *         progression?(object)]
         *
         * The inventory contents are sanitized later (unknown kinds are dropped),
         * so here we only require it to be an array; this avoids kicking a player
         * whose saved inventory contains stale/foreign kinds. Progression is also
         * sanitized later, so we only require it to be an object.
         */
        checkHello: function(message) {
            if(message.length < 3 || message.length > 5) {
                return false;
            }
            if(!_.isString(message[0]) || !_.isNumber(message[1]) || !_.isNumber(message[2])) {
                return false;
            }
            if(message.length >= 4 && message[3] !== undefined && !_.isArray(message[3]) && !_.isObject(message[3])) {
                return false;
            }
            if(message.length === 5 && !_.isObject(message[4])) {
                return false;
            }
            return true;
        }
    });

    var checker = new FormatChecker;
    
    exports.check = checker.check.bind(checker);
})();