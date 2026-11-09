
var cls = require("./lib/class"),
    WebSocket = require('ws'),
    http = require('http'),
    path = require('path'),
    StaticServer = require('./static'),
    Editor = require('./editor'),
    Utils = require('./utils'),
    _ = require('underscore'),
    WS = {};

module.exports = WS;


/**
 * Abstract Server and Connection classes
 */
var Server = cls.Class.extend({
    init: function(port) {
        this.port = port;
    },
    
    onConnect: function(callback) {
        this.connection_callback = callback;
    },
    
    onError: function(callback) {
        this.error_callback = callback;
    },
    
    broadcast: function(message) {
        throw "Not implemented";
    },
    
    forEachConnection: function(callback) {
        _.each(this._connections, callback);
    },
    
    addConnection: function(connection) {
        this._connections[connection.id] = connection;
    },
    
    removeConnection: function(id) {
        delete this._connections[id];
    },
    
    getConnection: function(id) {
        return this._connections[id];
    }
});


var Connection = cls.Class.extend({
    init: function(id, connection, server) {
        this._connection = connection;
        this._server = server;
        this.id = id;
    },
    
    onClose: function(callback) {
        this.close_callback = callback;
    },
    
    listen: function(callback) {
        this.listen_callback = callback;
    },
    
    broadcast: function(message) {
        throw "Not implemented";
    },
    
    send: function(message) {
        throw "Not implemented";
    },
    
    sendUTF8: function(data) {
        throw "Not implemented";
    },
    
    close: function(logError) {
        log.info("Closing connection to "+this._connection.remoteAddress+". Error: "+logError);
        this._connection.close();
    }
});



/**
 * WebsocketServer
 * 
 * Modern (RFC 6455) websocket server built on the `ws` package.
 * The same HTTP server also:
 *   - exposes a /status endpoint for monitoring
 *   - serves the game client (static files) from the client directory,
 *     with /shared/* mapped to the repository's shared directory.
 */
WS.MultiVersionWebsocketServer = Server.extend({
    _connections: {},
    _counter: 0,
    
    init: function(port, staticConfig) {
        var self = this;
        
        this._super(port);
        
        this._connections = {};
        this._counter = 0;
        
        this._staticConfig = staticConfig || {};
        this._clientRoot = this._staticConfig.clientRoot || path.resolve(__dirname, '../../client');
        this._sharedRoot = this._staticConfig.sharedRoot || path.resolve(__dirname, '../../shared');
        this._editorRoot = path.resolve(__dirname, '../../editor');
        this._editorEnabled = !!this._staticConfig.editorEnabled;
        
        this._httpServer = http.createServer(function(request, response) {
            var pathname = new URL(request.url, 'http://localhost').pathname;

            // Editor write/load API (POST). Only when the editor is enabled.
            if(self._editorEnabled
               && (pathname === '/editor/api/save'
                   || pathname === '/editor/api/asset'
                   || pathname === '/editor/api/load'
                   || pathname === '/editor/api/sprites'
                   || pathname === '/editor/api/import-sprite'
                   || pathname === '/editor/api/import-tile')) {
                if(Editor.handleRequest(request, response, pathname)) { return; }
            }

            if(request.method !== 'GET' && request.method !== 'HEAD') {
                response.writeHead(405, {'Allow': 'GET, HEAD'});
                response.end();
                return;
            }
            
            // In-app map editor (static UI) at /editor.
            if(self._editorEnabled && (pathname === '/editor' || pathname.indexOf('/editor/') === 0)) {
                var editorPath = pathname === '/editor' ? '/index.html'
                               : pathname.slice('/editor'.length);
                StaticServer.serve(self._editorRoot, response, editorPath);
                return;
            }
            
            if(pathname === '/status') {
                if(self.status_callback) {
                    response.writeHead(200, {'Content-Type': 'application/json'});
                    response.end(self.status_callback());
                    return;
                }
            }
            
            // The client imports shared/js/gametypes at runtime.
            if(pathname === '/shared' || pathname.indexOf('/shared/') === 0) {
                StaticServer.serve(self._sharedRoot, response, pathname.slice('/shared'.length) || '/');
                return;
            }
            
            StaticServer.serve(self._clientRoot, response, pathname);
        });
        
        this._wsServer = new WebSocket.Server({
            server: this._httpServer,
            maxPayload: 0x100000,
            perMessageDeflate: false
        });
        
        this._wsServer.on('connection', function(socket, req) {
            socket.remoteAddress = req.socket.remoteAddress;
            
            var c = new WS.WebSocketConnection(self._createId(), socket, self);
            
            if(self.connection_callback) {
                self.connection_callback(c);
            }
            self.addConnection(c);
        });
        
        this._wsServer.on('error', function(err) {
            if(self.error_callback) {
                self.error_callback(err);
            } else {
                console.error("WebSocket server error: " + err);
            }
        });
        
        this._httpServer.on('error', function(err) {
            if(self.error_callback) {
                self.error_callback(err);
            } else {
                console.error("HTTP server error: " + err);
            }
        });
        
        this._httpServer.listen(port, function() {
            log.info("Server is listening on port "+port);
        });
    },
    
    _createId: function() {
        return '5' + Utils.random(99) + '' + (this._counter++);
    },
    
    broadcast: function(message) {
        this.forEachConnection(function(connection) {
            connection.send(message);
        });
    },
    
    onRequestStatus: function(status_callback) {
        this.status_callback = status_callback;
    }
});


/**
 * Connection class for `ws` (https://github.com/websockets/ws)
 */
WS.WebSocketConnection = Connection.extend({
    init: function(id, connection, server) {
        var self = this;
        
        this._super(id, connection, server);
        
        this._connection.on('message', function(data) {
            if(self.listen_callback && !self._closed) {
                var text = data.toString();
                try {
                    self.listen_callback(JSON.parse(text));
                } catch(e) {
                    if(e instanceof SyntaxError) {
                        self.close("Received message was not valid JSON.");
                    } else {
                        throw e;
                    }
                }
            }
        });
        
        this._connection.on('close', function() {
            self._closed = true;
            if(self.close_callback) {
                self.close_callback();
            }
            self._server.removeConnection(self.id);
        });
        
        this._connection.on('error', function(err) {
            log.error("WebSocket error on connection "+self.id+": "+err);
        });
    },
    
    send: function(message) {
        this.sendUTF8(JSON.stringify(message));
    },
    
    sendUTF8: function(data) {
        if(this._connection.readyState === WebSocket.OPEN) {
            this._connection.send(data);
        }
    },
    
    close: function(logError) {
        if(this._connection.readyState === WebSocket.CLOSED) {
            return;
        }
        log.info("Closing connection to "+this._connection.remoteAddress+". Error: "+logError);
        this._connection.close();
    }
});
