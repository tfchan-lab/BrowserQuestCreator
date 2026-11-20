
var fs = require('fs'),
    os = require('os'),
    Metrics = require('./metrics');

/**
 * Returns the machine's IPv4 addresses that a normal device on the same LAN can
 * reach, ordered best-first (real Wi-Fi/Ethernet NICs before virtual adapters).
 *
 * Excluded: loopback, link-local (169.254.x), Tailscale/CGNAT (100.64.0.0/10),
 * and known virtual/WSL/Hyper-V/VPN adapter names - another LAN device cannot
 * reach those addresses.
 */
function getLanAddresses() {
    var candidates = [];
    var ifaces = os.networkInterfaces();
    var virtualName = /(tailscale|vEthernet|WSL|Hyper-V|VirtualBox|VMware|Loopback|VPN|Tunnel|vpn|docker|bridge)/i;

    Object.keys(ifaces).forEach(function(name) {
        (ifaces[name] || []).forEach(function(info) {
            if(!info || (info.family !== 'IPv4' && info.family !== 4)) { return; }
            if(info.internal) { return; }
            var addr = info.address;
            if(addr.indexOf('169.254.') === 0) { return; }              // link-local
            var o = addr.split('.').map(Number);
            if(o[0] === 100 && o[1] >= 64 && o[1] <= 127) { return; }   // Tailscale/CGNAT

            // Prefer real NICs: real-looking names (Wi-Fi, WLAN, Ethernet, eth, wlan, en) first.
            var looksReal = /(wi-?fi|wlan|wireless|ethernet|^eth|en\d|local area)/i.test(name) && !virtualName.test(name);
            candidates.push({ address: addr, real: looksReal ? 1 : 0 });
        });
    });

    candidates.sort(function(a, b) { return b.real - a.real; });
    return candidates.map(function(c) { return c.address; });
}



function main(config) {
    var ws = require("./ws"),
        WorldServer = require("./worldserver"),
        Log = require('log'),
        _ = require('underscore'),
        server = new ws.MultiVersionWebsocketServer(config.port, { editorEnabled: !!config.editor_enabled }),
        metrics = config.metrics_enabled ? new Metrics(config) : null;
        worlds = [],
        lastTotalPlayers = 0,
        checkPopulationInterval = setInterval(function() {
            if(metrics && metrics.isReady) {
                metrics.getTotalPlayers(function(totalPlayers) {
                    if(totalPlayers !== lastTotalPlayers) {
                        lastTotalPlayers = totalPlayers;
                        _.each(worlds, function(world) {
                            world.updatePopulation(totalPlayers);
                        });
                    }
                });
            }
        }, 1000);
    
    switch(config.debug_level) {
        case "error":
            log = new Log(Log.ERROR); break;
        case "debug":
            log = new Log(Log.DEBUG); break;
        case "info":
            log = new Log(Log.INFO); break;
    };
    
    log.info("Starting BrowserQuest game server...");

    // Advertise LAN play URLs so other devices on the same network can join.
    // The client derives its WebSocket host from the page it was served from, so
    // opening these URLs just works (no per-client config edit required).
    setTimeout(function() {
        var addrs = getLanAddresses();
        log.info("Play locally:  http://localhost:" + config.port + "/");
        if(addrs.length) {
            addrs.forEach(function(a) {
                log.info("Play on LAN:   http://" + a + ":" + config.port + "/");
            });
            log.info("(Allow Node.js through the firewall / open TCP " + config.port + " for LAN play.)");
        }
    }, 250);
    
    server.onConnect(function(connection) {
        var world, // the one in which the player will be spawned
            connect = function() {
                if(world) {
                    world.connect_callback(new Player(connection, world));
                }
            };
        
        if(metrics) {
            metrics.getOpenWorldCount(function(open_world_count) {
                // choose the least populated world among open worlds
                world = _.min(_.first(worlds, open_world_count), function(w) { return w.playerCount; });
                connect();
            });
        }
        else {
            // simply fill each world sequentially until they are full
            world = _.detect(worlds, function(world) {
                return world.playerCount < config.nb_players_per_world;
            });
            world.updatePopulation();
            connect();
        }
    });

    server.onError(function() {
        log.error(Array.prototype.join.call(arguments, ", "));
    });
    
    var onPopulationChange = function() {
        metrics.updatePlayerCounters(worlds, function(totalPlayers) {
            _.each(worlds, function(world) {
                world.updatePopulation(totalPlayers);
            });
        });
        metrics.updateWorldDistribution(getWorldDistribution(worlds));
    };

    _.each(_.range(config.nb_worlds), function(i) {
        var world = new WorldServer('world'+ (i+1), config.nb_players_per_world, server);
        world.run(config.map_filepath);
        worlds.push(world);
        if(metrics) {
            world.onPlayerAdded(onPopulationChange);
            world.onPlayerRemoved(onPopulationChange);
        }
    });
    
    server.onRequestStatus(function() {
        return JSON.stringify(getWorldDistribution(worlds));
    });
    
    if(config.metrics_enabled) {
        metrics.ready(function() {
            onPopulationChange(); // initialize all counters to 0 when the server starts
        });
    }
    
    process.on('uncaughtException', function (e) {
        log.error('uncaughtException: ' + e);
    });
}

function getWorldDistribution(worlds) {
    var distribution = [];
    
    _.each(worlds, function(world) {
        distribution.push(world.playerCount);
    });
    return distribution;
}

function getConfigFile(path, callback) {
    fs.readFile(path, 'utf8', function(err, json_string) {
        if(err) {
            console.error("Could not open config file:", err.path);
            callback(null);
        } else {
            callback(JSON.parse(json_string));
        }
    });
}

var defaultConfigPath = './server/config.json',
    customConfigPath = './server/config_local.json';

process.argv.forEach(function (val, index, array) {
    if(index === 2) {
        customConfigPath = val;
    }
});

getConfigFile(defaultConfigPath, function(defaultConfig) {
    getConfigFile(customConfigPath, function(localConfig) {
        if(localConfig) {
            main(localConfig);
        } else if(defaultConfig) {
            main(defaultConfig);
        } else {
            console.error("Server cannot start without any configuration file.");
            process.exit(1);
        }
    });
});
