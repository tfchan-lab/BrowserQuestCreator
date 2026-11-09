
define(['npc', '../../shared/js/npcs'], function(Npc, NPCData) {

    // Looks up the first configured idleSpeed for a given kind (if any).
    function idleSpeedForKind(kindName) {
        var list = NPCData.getAll();
        for(var i = 0; i < list.length; i++) {
            if(list[i].kind === kindName && typeof list[i].idleSpeed === 'number') {
                return list[i].idleSpeed;
            }
        }
        return null;
    }

    function makeNpcClass(enumName) {
        return Npc.extend({
            init: function(id) {
                this._super(id, Types.Entities[enumName], 1);
                var speed = idleSpeedForKind(Types.getKindAsString(Types.Entities[enumName]));
                if(speed !== null) { this.idleSpeed = speed; }
            }
        });
    }

    var NPCs = {
        Guard: makeNpcClass('GUARD'),
        King: makeNpcClass('KING'),
        Agent: makeNpcClass('AGENT'),
        Rick: makeNpcClass('RICK'),
        VillageGirl: makeNpcClass('VILLAGEGIRL'),
        Villager: makeNpcClass('VILLAGER'),
        Coder: makeNpcClass('CODER'),
        Scientist: makeNpcClass('SCIENTIST'),
        Nyan: makeNpcClass('NYAN'),
        Sorcerer: makeNpcClass('SORCERER'),
        Priest: makeNpcClass('PRIEST'),
        BeachNpc: makeNpcClass('BEACHNPC'),
        ForestNpc: makeNpcClass('FORESTNPC'),
        DesertNpc: makeNpcClass('DESERTNPC'),
        LavaNpc: makeNpcClass('LAVANPC'),
        Octocat: makeNpcClass('OCTOCAT')
    };
    
    return NPCs;
});
