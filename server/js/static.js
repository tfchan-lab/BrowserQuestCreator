
var fs = require('fs'),
    path = require('path');

var StaticServer = {},
    MIME_TYPES = {
        '.html': 'text/html; charset=utf-8',
        '.htm':  'text/html; charset=utf-8',
        '.js':   'application/javascript; charset=utf-8',
        '.json': 'application/json; charset=utf-8',
        '.css':  'text/css; charset=utf-8',
        '.png':  'image/png',
        '.gif':  'image/gif',
        '.jpg':  'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.ico':  'image/x-icon',
        '.cur':  'image/x-icon',
        '.svg':  'image/svg+xml',
        '.mp3':  'audio/mpeg',
        '.ogg':  'audio/ogg',
        '.wav':  'audio/wav',
        '.woff': 'font/woff',
        '.woff2': 'font/woff2',
        '.ttf':  'font/ttf',
        '.otf':  'font/otf',
        '.eot':  'application/vnd.ms-fontobject',
        '.map':  'application/json; charset=utf-8'
    };

module.exports = StaticServer;

StaticServer.getMimeType = function(filepath) {
    return MIME_TYPES[path.extname(filepath).toLowerCase()] || 'application/octet-stream';
};

/**
 * Resolves a URL pathname to a file path inside `rootDir`.
 * Returns null if the resolved path would escape the root (path traversal).
 */
StaticServer.resolvePath = function(rootDir, urlPath) {
    var decoded;

    try {
        decoded = decodeURIComponent(urlPath);
    } catch(e) {
        // Malformed percent-encoding
        return null;
    }

    var relative = decoded.replace(/^\/+/, ''),
        resolved = path.resolve(rootDir, relative),
        rootResolved = path.resolve(rootDir);

    if(resolved !== rootResolved && resolved.indexOf(rootResolved + path.sep) !== 0) {
        return null;
    }
    return resolved;
};

/**
 * Serves a file from disk.
 *
 * options:
 *   - rootDir: base directory for static files
 *   - res: the http.ServerResponse
 *   - urlPath: the request pathname
 */
StaticServer.serve = function(rootDir, res, urlPath) {
    var filepath = StaticServer.resolvePath(rootDir, urlPath);

    if(filepath === null) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
    }

    fs.stat(filepath, function(err, stats) {
        if(!err && stats.isDirectory()) {
            filepath = path.join(filepath, 'index.html');
        }

        fs.readFile(filepath, function(err2, data) {
            if(err2) {
                res.writeHead(404, {'Content-Type': 'text/plain; charset=utf-8'});
                res.end('Not Found');
                return;
            }

            res.writeHead(200, {
                'Content-Type': StaticServer.getMimeType(filepath),
                'Content-Length': data.length,
                'Cache-Control': 'no-cache'
            });
            res.end(data);
        });
    });
};
