
var Utils = require("./utils");

var Formulas = {};

Formulas.dmg = function(attackPower, armorLevel) {
    var dealt = attackPower * Utils.randomInt(5, 10),
        absorbed = armorLevel * Utils.randomInt(1, 3),
        dmg =  dealt - absorbed;
    
    //console.log("abs: "+absorbed+"   dealt: "+ dealt+"   dmg: "+ (dealt - absorbed));
    if(dmg <= 0) {
        return Utils.randomInt(0, 3);
    } else {
        return Math.round(dmg);
    }
};

Formulas.hp = function(armorLevel) {
    var hp = 80 + ((armorLevel - 1) * 30);
    return hp;
};

if(!(typeof exports === 'undefined')) {
    module.exports = Formulas;
}