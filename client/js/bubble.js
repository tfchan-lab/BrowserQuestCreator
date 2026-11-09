
define(['jquery', 'timer'], function($, Timer) {

    var Bubble = Class.extend({
        init: function(id, element, time) {
            this.id = id;
            this.element = element;
            this.timer = new Timer(5000, time);
        },
    
        isOver: function(time) {
            if(this.timer.isOver(time)) {
                return true;
            }
            return false;
        },
    
        destroy: function() {
            $(this.element).remove();
        },
    
        reset: function(time) {
            this.timer.lastTime = time;
        }
    });

    var BubbleManager = Class.extend({
        init: function(container) {
            this.container = container;
            this.bubbles = {};
        },
    
        getBubbleById: function(id) {
            if(id in this.bubbles) {
                return this.bubbles[id];
            }
            return null;
        },
    
        create: function(id, message, time) {
            if(this.bubbles[id]) {
                this.bubbles[id].reset(time);
                $("#"+id+" p").html(message);
            }
            else {
                var el = $("<div id=\""+id+"\" class=\"bubble\"><p>"+message+"</p><div class=\"thingy\"></div></div>"); //.attr('id', id);
                $(el).appendTo(this.container);
            
                this.bubbles[id] = new Bubble(id, el, time);
            }
        },

        /**
         * Creates (or refreshes) an interactive "conversation option" bubble.
         * Unlike normal chat bubbles, option bubbles accept pointer events and
         * invoke `onClick` when the player clicks them. `id` should be unique
         * per NPC (e.g. `<npcId>-opt`).
         */
        createOption: function(id, html, time, onClick) {
            var self = this;
            if(this.bubbles[id]) {
                this.bubbles[id].reset(time);
                var $existing = $("#"+id);
                $existing.html(html);
                $existing.unbind('click.option').bind('click.option', function(e) {
                    e.stopPropagation();
                    if(onClick) { onClick(); }
                });
            }
            else {
                var el = $("<div id=\""+id+"\" class=\"bubble option\">"+html+"</div>");
                el.css('pointer-events', 'auto');
                el.bind('click.option', function(e) {
                    e.stopPropagation();
                    if(onClick) { onClick(); }
                });
                $(el).appendTo(this.container);
                this.bubbles[id] = new Bubble(id, el, time);
            }
        },

        getOptionBubbleById: function(id) {
            return this.getBubbleById(id);
        },
    
        update: function(time) {
            var self = this,
                bubblesToDelete = [];
        
            _.each(this.bubbles, function(bubble) {
                if(bubble.isOver(time)) {
                    bubble.destroy();
                    bubblesToDelete.push(bubble.id);
                }
            });
        
            _.each(bubblesToDelete, function(id) {
                delete self.bubbles[id];
            });
        },
    
        clean: function() {
            var self = this,
                bubblesToDelete = [];
        
            _.each(this.bubbles, function(bubble) {
                bubble.destroy();
                bubblesToDelete.push(bubble.id);
            });
        
            _.each(bubblesToDelete, function(id) {
                delete self.bubbles[id];
            });
        
            this.bubbles = {};
        },
    
        destroyBubble: function(id) {
            var bubble = this.getBubbleById(id);
        
            if(bubble) {
                bubble.destroy();
                delete this.bubbles[id];
            }
        },
        
        forEachBubble: function(callback) {
            _.each(this.bubbles, function(bubble) {
                callback(bubble);
            });
        }
    });
    
    return BubbleManager;
});
