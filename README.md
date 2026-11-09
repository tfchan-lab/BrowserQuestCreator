BrowserQuest
============

BrowserQuest is a HTML5/JavaScript multiplayer game experiment.


Running locally (modern Node.js)
--------------------------------

BrowserQuest was originally written in 2012 for Node.js 0.4. It has been
updated to run on current Node.js (tested with Node.js 25) and current
browsers. The ancient `websocket-server` package has been replaced by `ws`.

Requirements: Node.js 18 or newer (for the built-in `WebSocket` client) and npm.

1) Install dependencies:

        npm install

2) Start the game server. It serves the game client, the WebSocket game
   endpoint, and the /status endpoint all on port 8000:

        npm start

3) Open the game in your browser:

        http://localhost:8000/

The client must be served over HTTP (not opened via `file://`) because it loads
sprites and configuration with XHR. The server serves the `client/` directory at
`/` and maps `/shared/*` to the repository's `shared/` directory, which the
client imports at runtime.

Fallback: if you prefer to run a separate static file server instead, start
`npm run client` in a second terminal and open
`http://localhost:8080/client/index.html`.

Server health check (returns per-world player counts as JSON):

        http://localhost:8000/status

Optional configuration:

- Server settings: copy `server/config_local.json-dist` to
  `server/config_local.json` and edit it.
- Client WebSocket host/port: edit `client/config/config_local.json`
  (used in development) or `client/config/config_build.json` (used in the
  production build).


Documentation
-------------

Additional documentation is located in the client and server directories.

Weapons, armors and other equipment are data-driven. Edit
`shared/data/equipment.json`, then run `npm run equipment:build`. See
`tools/equipment/README.md` for the full equipment editor guide.


License
-------

Code is licensed under MPL 2.0. Content is licensed under CC-BY-SA 3.0.
See the LICENSE file for details.


Credits
-------
Created by [Little Workshop](http://www.littleworkshop.fr):

* Franck Lecollinet - [@whatthefranck](http://twitter.com/whatthefranck)
* Guillaume Lecollinet - [@glecollinet](http://twitter.com/glecollinet)
