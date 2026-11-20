
define(function() {
    var config = {
        dev: { host: "localhost", port: 8000, dispatcher: false },
        build: { host: "localhost", port: 8000 }
    };
    
    // config_build.json is only needed for the production build; load it if present.
    require(['text!../config/config_build.json'], function(build) {
        try {
            config.build = JSON.parse(build);
        } catch(e) {
            // Exception triggered when config_build.json does not exist. Nothing to do here.
        }
    });
    
    //>>excludeStart("prodHost", pragmas.prodHost);
    require(['text!../config/config_local.json'], function(local) {
        try {
            config.local = JSON.parse(local);
        } catch(e) {
            // Exception triggered when config_local.json does not exist. Nothing to do here.
        }
    });
    //>>excludeEnd("prodHost");
    
    /**
     * Resolves the WebSocket host for the given config section so the game works
     * over a LAN (not just localhost).
     *
     * Precedence:
     *   1. An explicitly configured, non-placeholder host that is not "localhost"
     *      (and not the "-dist" placeholder text) is honored as-is.
     *   2. Otherwise the host is derived from the page the client was served from
     *      (`window.location.hostname`). Since the game server serves both the
     *      client and the WebSocket on the same port, this is exactly the LAN host
     *      a remote browser used to reach us (e.g. http://192.168.1.50:8000/).
     *   3. Falls back to "localhost" (e.g. file:// or non-browser contexts).
     */
    config.resolveHost = function(section) {
        var explicit = section && section.host;

        var isExplicit = typeof explicit === 'string'
            && explicit.length > 0
            && explicit !== 'localhost'
            && explicit !== '127.0.0.1'
            && explicit.indexOf('Set ') !== 0; // config_local.json-dist placeholder

        if (isExplicit) {
            return explicit;
        }

        if (typeof window !== 'undefined' && window.location
            && typeof window.location.hostname === 'string'
            && window.location.hostname.length > 0) {
            return window.location.hostname;
        }

        return 'localhost';
    };
    
    return config;
});
