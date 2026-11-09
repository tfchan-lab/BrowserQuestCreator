BrowserQuest client documentation
=================================

Running the client in development
---------------------------------

The client is a set of static files loaded with RequireJS, so it must be served
over HTTP. The game server serves the client itself: from the project root run

    npm start

and open:

    http://localhost:8000/

The server serves this `client/` directory at `/` and maps `/shared/*` to the
repository's `shared/` directory, which the client imports at runtime.

Fallback: you can instead run a standalone static file server with

    npm run client

and open `http://localhost:8080/client/index.html`. In that case serve from the
project root (not the `client/` directory) so that both `client/` and `shared/`
are reachable.

The WebSocket host/port used in development is read from
`client/config/config_local.json`. If that file is absent the client falls back
to `{ host: "localhost", port: 8000 }` (see `client/js/config.js`).


Production build (optional, Unix-like shell required)
-----------------------------------------------------

The `client-build` directory is generated with the RequireJS optimizer. The
provided `bin/build.sh` is a bash script and requires a Unix-like environment
(Git Bash / WSL on Windows).

1) Configure the websocket host/port:

In the client/config/ directory, copy config_build.json-dist to a new
config_build.json file. Edit the contents of this file to change host/port
settings.

2) Run the following commands from the project root:

(Note: nodejs is required to run the build script)

* cd bin
* ./build.sh

This will use the RequireJS optimizer tool to create a client-build/ directory
containing a production-ready version of BrowserQuest.

A build log file will also be created at bin/build.txt.

The client-build directory can be renamed and deployed anywhere. It has no
dependencies to any other file/folder in the repository.

Note: the build also bundles `shared/js/gametypes`, which is why the unbuilt
development client needs the project root served rather than just `client/`.
