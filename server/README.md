BrowserQuest server documentation
=================================

The game server was originally written for nodejs v0.4.7. It now runs on
current Node.js (tested with Node.js 25). The obsolete `websocket-server`
(miksago) dependency has been replaced by the `ws` package, and `path.exists`
has been replaced with `fs.existsSync`.

Dependencies (installed via `npm install` from the project root):

- underscore
- log
- bison
- ws
- sanitizer
- memcache (only if you want metrics)


Configuration
-------------

The server settings (number of worlds, number of players per world, etc.) can be configured.
Copy `config_local.json-dist` to a new `config_local.json` file, then edit it. The server will override default settings with this file.


Deployment
----------

In order to deploy the server, simply copy the `server` and `shared` directories to the staging/production server.

Then run `npm start` (or `node server/js/main.js`) from the project root in
order to start the server. The server must be started from the project root
because its default `map_filepath` is relative to it.

The server serves three things on the same port (default 8000):

- the game client static files (default: the repository `client/` directory,
  served at `/`)
- `/shared/*` mapped to the repository `shared/` directory (the client imports
  `shared/js/gametypes` at runtime)
- the WebSocket game endpoint and the `/status` monitoring endpoint

The static roots can be overridden by passing a `staticConfig` object
(`{ clientRoot, sharedRoot }`) as the second argument to
`MultiVersionWebsocketServer`; by default they are resolved relative to the
project root, so the whole project directory tree is used.


Note: the `shared` directory is the only one in the project which is a server dependency.


Monitoring
----------

The server has a status URL which can be used as a health check or simply as a way to monitor player population.

Send a GET request to: `http://[host]:[port]/status`

It will return a JSON array containing the number of players in all instanced worlds on this game server.
