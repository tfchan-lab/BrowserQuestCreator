// LAN diagnostics for the BrowserQuest server.
//
//   npm run lan:check
//
// Prints the candidate LAN URLs and runs local checks that commonly explain why
// another device on the same subnet cannot connect:
//   1. Is the server listening on 0.0.0.0:<port>?
//   2. Does the machine answer on its own LAN IP? (proxy for "the listener is up")
//   3. Windows firewall: does an inbound allow rule cover the running node.exe
//      (or TCP <port>) on the current network profile?
//   4. Network profile: a "Public" campus/guest network often enforces client
//      isolation, which blocks device-to-device traffic no matter the firewall.
//
// This is read-only; it does not change any settings.

const os = require('os');
const net = require('net');
const http = require('http');
const { execFileSync } = require('child_process');

const PORT = (() => {
    try {
        const raw = require('../../server/config_local.json');
        return raw.port || 8000;
    } catch (e) {
        return 8000;
    }
})();

function lanCandidates() {
    const out = [];
    const ifaces = os.networkInterfaces();
    const virtualName = /(tailscale|vEthernet|WSL|Hyper-V|VirtualBox|VMware|Loopback|VPN|Tunnel|docker|bridge)/i;
    Object.keys(ifaces).forEach((name) => {
        (ifaces[name] || []).forEach((info) => {
            if (!info || (info.family !== 'IPv4' && info.family !== 4) || info.internal) return;
            const a = info.address;
            if (a.indexOf('169.254.') === 0) return;
            const o = a.split('.').map(Number);
            if (o[0] === 100 && o[1] >= 64 && o[1] <= 127) return; // Tailscale/CGNAT
            const real = /(wi-?fi|wlan|wireless|ethernet|^eth|en\d|local area)/i.test(name) && !virtualName.test(name);
            out.push({ name, address: a, real: real ? 1 : 0 });
        });
    });
    out.sort((x, y) => y.real - x.real);
    return out;
}

function checkListening() {
    return new Promise((resolve) => {
        const srv = net.connect({ port: PORT, host: '127.0.0.1' }, () => {
            srv.end();
            resolve(true);
        });
        srv.on('error', () => resolve(false));
        srv.setTimeout(1500, () => { srv.destroy(); resolve(false); });
    });
}

function checkLanIp(ip) {
    return new Promise((resolve) => {
        const req = http.get({ host: ip, port: PORT, path: '/status', timeout: 2500 }, (res) => {
            res.resume();
            resolve(res.statusCode === 200);
        });
        req.on('error', () => resolve(false));
        req.on('timeout', () => { req.destroy(); resolve(false); });
    });
}

function psJson(cmd) {
    try {
        const out = execFileSync('powershell', ['-NoProfile', '-Command', cmd], { encoding: 'utf8' });
        return JSON.parse(out);
    } catch (e) {
        return null;
    }
}

function firewallInfo() {
    // Does any inbound allow rule cover TCP <PORT> or the current node path?
    const script = `
        $port = ${PORT};
        $nodePath = (Get-Command node -ErrorAction SilentlyContinue).Source;
        $rules = @();
        Get-NetFirewallPortFilter -ErrorAction SilentlyContinue | ForEach-Object {
            $p = $_; $r = $p | Get-NetFirewallRule;
            if ($r.Direction -eq 'Inbound' -and $r.Action -eq 'Allow' -and $r.Enabled -eq 'True' -and ($p.LocalPort -eq $port -or $p.LocalPort -eq 'Any')) {
                $rules += [pscustomobject]@{ Name=$r.DisplayName; Profile=[string]$r.Profile; Port=[string]$p.LocalPort; Program='' }
            }
        }
        Get-NetFirewallApplicationFilter -ErrorAction SilentlyContinue | ForEach-Object {
            if ($nodePath -and $_.Program -eq $nodePath) {
                $r = $_ | Get-NetFirewallRule;
                if ($r.Direction -eq 'Inbound' -and $r.Action -eq 'Allow' -and $r.Enabled -eq 'True') {
                    $rules += [pscustomobject]@{ Name=$r.DisplayName; Profile=[string]$r.Profile; Port='Any(node)'; Program=$_.Program }
                }
            }
        }
        $profiles = @();
        Get-NetConnectionProfile -ErrorAction SilentlyContinue | ForEach-Object {
            $profiles += [pscustomobject]@{ Name=$_.Name; Category=[string]$_.NetworkCategory }
        }
        [pscustomobject]@{ NodePath=$nodePath; Rules=@($rules | Sort-Object Name -Unique); Profiles=@($profiles) } | ConvertTo-Json -Depth 5
    `;
    return psJson(script);
}

(async () => {
    console.log('BrowserQuest LAN diagnostics (port ' + PORT + ')\n');

    const cands = lanCandidates();
    console.log('Candidate LAN addresses (best first):');
    if (!cands.length) {
        console.log('  (none found - are you connected to Wi-Fi/Ethernet?)');
    } else {
        cands.forEach((c) => console.log('  ' + c.address + '  (' + c.name + ')' + (c.real ? '  <-- most likely' : '')));
    }
    console.log('');

    const listening = await checkListening();
    console.log('1) Server listening on localhost:' + PORT + ' : ' + (listening ? 'YES' : 'NO (start it with `npm start`)'));

    if (cands.length) {
        for (const c of cands.slice(0, 3)) {
            const ok = await checkLanIp(c.address);
            console.log('2) Reachable on ' + c.address + ':' + PORT + ' : ' + (ok ? 'YES (locally)' : 'NO'));
            if (!ok) console.log('     (if localhost works but this fails, the listener may be bound wrong)');
        }
    }

    const fw = firewallInfo();
    if (!fw) {
        console.log('3) Firewall: could not query (Windows-only check).');
    } else {
        const hasRule = fw.Rules && fw.Rules.length > 0;
        console.log('3) Firewall inbound-allow for node/port ' + PORT + ' : ' + (hasRule ? 'YES' : 'NO  <-- likely the blocker'));
        if (fw.Rules) fw.Rules.forEach((r) => console.log('     - "' + r.Name + '" profiles=' + r.Profile + ' port=' + r.Port));
        if (!hasRule) {
            console.log('     Fix: run this in an ADMIN PowerShell:');
            console.log('       powershell -ExecutionPolicy Bypass -File tools\\lan\\setup-firewall.ps1');
        }
        if (fw.Profiles) {
            const pub = fw.Profiles.filter((p) => /Public/i.test(p.Category));
            console.log('4) Network profile: ' + fw.Profiles.map((p) => p.Name + '=' + p.Category).join(', '));
            if (pub.length) {
                console.log('   WARNING: a Public network is often a campus/guest Wi-Fi that enforces');
                console.log('   client isolation (blocks device-to-device traffic). If steps 1-3 are OK');
                console.log('   and the other device still cannot connect, use a home Wi-Fi or phone hotspot.');
            }
        }
    }

    console.log('\nIf all checks pass locally but another device still cannot connect, the');
    console.log('network itself is blocking peer traffic (AP/client isolation).');
})();
