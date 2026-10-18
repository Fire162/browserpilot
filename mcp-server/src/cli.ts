#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import readline from 'readline';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import { DaemonClient } from './daemon-client.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const client = new DaemonClient();

// ANSI color helpers
const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  underline: '\x1b[4m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  bgCyan: '\x1b[46m',
  bgBlue: '\x1b[44m'
};

function formatHeader(title: string) {
  console.log(`\n${colors.bold}${colors.cyan}=== ${title} ===${colors.reset}\n`);
}

function printHelp() {
  console.log(`
${colors.bold}${colors.cyan}BrowserPilot CLI (bp)${colors.reset}
${colors.dim}Fast terminal control & diagnostics for BrowserPilot remote browser bridge${colors.reset}

${colors.bold}USAGE:${colors.reset}
  bp <command> [options]

${colors.bold}COMMANDS:${colors.reset}
  ${colors.green}start [options]${colors.reset}         Start BrowserPilot daemon (${colors.dim}--port=<n> --tunnel${colors.reset})
  ${colors.green}stop${colors.reset}                    Stop BrowserPilot daemon and close tunnels
  ${colors.green}restart [options]${colors.reset}       Restart daemon and refresh tunnel
  ${colors.green}logs [-f]${colors.reset}               View daemon service logs
  ${colors.green}doctor${colors.reset}                  Run end-to-end environment & connectivity diagnostics
  ${colors.green}status${colors.reset}                  Show current bridge, extension, and active tab status
  ${colors.green}tabs [list]${colors.reset}             List open browser tabs (${colors.dim}--filter=<keyword>${colors.reset})
  ${colors.green}tabs close <ids...>${colors.reset}     Close one or more tabs by ID (${colors.dim}--match=<pattern>${colors.reset})
  ${colors.green}nav <url>${colors.reset}               Navigate active tab to URL (${colors.dim}--new-tab${colors.reset})
  ${colors.green}snap [file.png]${colors.reset}         Take screenshot of active tab and save to disk
  ${colors.green}tunnel [url|open|close]${colors.reset} Manage/view Fire PM reverse proxy tunnel
  ${colors.green}help${colors.reset}                    Show this help message

${colors.bold}EXAMPLES:${colors.reset}
  bp start --tunnel
  bp start --port=8770 --tunnel
  bp stop
  bp restart --tunnel
  bp logs -f
  bp doctor
  bp status
  bp tabs list
  bp nav https://github.com --new-tab
  bp snap /tmp/screenshot.png
  bp tunnel url
`);
}

async function runDoctor() {
  formatHeader('🔍 BrowserPilot Environment Diagnostics');

  let hasErrors = false;

  // 1. Node Runtime
  const nodeVer = process.version;
  console.log(`  ${colors.green}✔${colors.reset} Node.js runtime: ${colors.bold}${nodeVer}${colors.reset}`);

  // 2. Daemon Service (systemd/fire-pm)
  let daemonActive = false;
  try {
    const res = execSync('systemctl is-active fire-browserpilot 2>/dev/null', { encoding: 'utf8' }).trim();
    if (res === 'active') {
      daemonActive = true;
      console.log(`  ${colors.green}✔${colors.reset} Systemd Service: ${colors.green}active${colors.reset} (fire-browserpilot.service)`);
    } else {
      console.log(`  ${colors.yellow}⚠${colors.reset} Systemd Service: ${colors.yellow}${res}${colors.reset}`);
    }
  } catch {
    console.log(`  ${colors.yellow}⚠${colors.reset} Systemd Service: not running or not registered as fire-browserpilot`);
  }

  // 3. Resolve reachable base URL
  let resolvedUrl = '';
  try {
    resolvedUrl = await client.resolveBaseUrl(true);
    console.log(`  ${colors.green}✔${colors.reset} Resolved Daemon Endpoint: ${colors.cyan}${resolvedUrl}${colors.reset}`);
  } catch (e: any) {
    hasErrors = true;
    console.log(`  ${colors.red}✖${colors.reset} Failed to resolve daemon endpoint: ${e.message}`);
  }

  // 4. Reverse Proxy Tunnel (Fire PM)
  const tunnelFile = `/tmp/fire-tunnels/8770.env`;
  let tunnelUrl = '';
  if (fs.existsSync(tunnelFile)) {
    try {
      const content = fs.readFileSync(tunnelFile, 'utf8');
      const m = content.match(/URL=(https?:\/\/[^\s]+)/);
      if (m && m[1]) {
        tunnelUrl = m[1];
        console.log(`  ${colors.green}✔${colors.reset} Active Fire PM Tunnel: ${colors.cyan}${tunnelUrl}${colors.reset}`);
      }
    } catch {
      // Ignore
    }
  } else {
    console.log(`  ${colors.dim}ℹ${colors.reset} No Fire PM tunnel descriptor found at ${tunnelFile}`);
  }

  // 5. Query Daemon Health & Status
  let statusData: any = null;
  try {
    const res = await client.ping();
    if (res.ok) {
      statusData = res.status;
      console.log(`  ${colors.green}✔${colors.reset} Daemon HTTP API: ${colors.green}online${colors.reset} (${res.latencyMs}ms latency)`);
    } else {
      hasErrors = true;
      console.log(`  ${colors.red}✖${colors.reset} Daemon HTTP API: ${colors.red}offline${colors.reset} (${res.error})`);
    }
  } catch (e: any) {
    hasErrors = true;
    console.log(`  ${colors.red}✖${colors.reset} Daemon HTTP API unreachable: ${e.message}`);
  }

  // 6. Connected Chrome Extension
  if (statusData && statusData.hub) {
    if (statusData.hub.connected) {
      console.log(`  ${colors.green}✔${colors.reset} Chrome Extension: ${colors.green}${colors.bold}CONNECTED${colors.reset} (last seen: ${statusData.hub.lastSeen || 'active'})`);

      // Try RPC ping to active extension
      try {
        const pingStart = Date.now();
        const rpcRes = await client.dispatch('status', {}, 4000);
        const rpcLatency = Date.now() - pingStart;
        console.log(`  ${colors.green}✔${colors.reset} Extension WebSocket RPC: ${colors.green}responsive${colors.reset} (${rpcLatency}ms roundtrip)`);
        if (rpcRes.activeTab) {
          console.log(`  ${colors.dim}ℹ${colors.reset} Active Tab: "${rpcRes.activeTab.title || 'Untitled'}" (${rpcRes.activeTab.url})`);
        }
        console.log(`  ${colors.dim}ℹ${colors.reset} Total Open Tabs: ${rpcRes.totalTabs ?? 'N/A'}`);
      } catch (err: any) {
        console.log(`  ${colors.yellow}⚠${colors.reset} Extension RPC check: ${err.message}`);
      }
    } else {
      console.log(`  ${colors.yellow}⚠${colors.reset} Chrome Extension: ${colors.yellow}DISCONNECTED${colors.reset}`);
      console.log(`    ${colors.dim}To connect: Open extension in Chrome, enter WS URL (${tunnelUrl ? 'wss://' + tunnelUrl.replace(/^https?:\/\//, '') : 'ws://<your-vps-ip>:8770'}), and click Connect.${colors.reset}`);
    }
  }

  console.log('');
  if (hasErrors) {
    console.log(`${colors.red}${colors.bold}Result: Issues detected.${colors.reset} Review above logs to troubleshoot.\n`);
    process.exit(1);
  } else {
    console.log(`${colors.green}${colors.bold}Result: All core checks passed successfully!${colors.reset}\n`);
  }
}

async function runStatus() {
  try {
    const baseUrl = await client.resolveBaseUrl();
    const status = await client.getStatus();
    console.log(`\n${colors.bold}BrowserPilot Daemon:${colors.reset} ${colors.cyan}${baseUrl}${colors.reset}`);
    console.log(`${colors.bold}Extension Status:${colors.reset}    ${status.connected ? `${colors.green}● Connected${colors.reset}` : `${colors.red}○ Disconnected${colors.reset}`}`);
    if (status.lastSeen) {
      console.log(`${colors.bold}Last Ping Received:${colors.reset}  ${status.lastSeen}`);
    }

    if (status.connected) {
      try {
        const extStatus = await client.dispatch('status', {}, 5000);
        if (extStatus.activeTab) {
          console.log(`${colors.bold}Focused Tab:${colors.reset}        [#${extStatus.activeTab.id}] ${extStatus.activeTab.title || 'Untitled'}`);
          console.log(`${colors.bold}Focused URL:${colors.reset}        ${colors.dim}${extStatus.activeTab.url}${colors.reset}`);
        }
        console.log(`${colors.bold}Total Open Tabs:${colors.reset}    ${extStatus.totalTabs ?? 'N/A'}`);
      } catch {
        // Fallback
      }
    }
    console.log('');
  } catch (err: any) {
    console.error(`\n${colors.red}Error fetching status:${colors.reset} ${err.message}\n`);
    process.exit(1);
  }
}

async function runTabs(args: string[]) {
  const sub = args[0];

  if (sub === 'close') {
    // Handling bp tabs close
    let matchPattern = '';
    const ids: number[] = [];

    for (let i = 1; i < args.length; i++) {
      const a = args[i];
      if (a.startsWith('--match=')) {
        matchPattern = a.slice(8);
      } else if (!isNaN(Number(a))) {
        ids.push(Number(a));
      }
    }

    if (ids.length === 0 && !matchPattern) {
      console.error(`\n${colors.red}Error:${colors.reset} Please specify tab IDs to close or use --match=<pattern>\n`);
      process.exit(1);
    }

    try {
      console.log(`${colors.dim}Closing tabs...${colors.reset}`);
      let res: any;
      try {
        res = await client.dispatch('close_tabs', {
          tabIds: ids.length > 0 ? ids : undefined,
          match: matchPattern || undefined
        });
      } catch (dispatchErr: any) {
        if (dispatchErr.message?.includes('Unsupported action: close_tabs')) {
          let idsToClose = ids;
          if (matchPattern) {
            const allTabs: any[] = await client.dispatch('list_tabs', {});
            const regex = new RegExp(matchPattern, 'i');
            idsToClose = allTabs
              .filter((t) => regex.test(t.url || '') || regex.test(t.title || ''))
              .map((t) => t.id);
          }
          let closed = 0;
          for (const id of idsToClose) {
            try {
              await client.dispatch('close_tab', { tabId: id });
              closed++;
            } catch {}
          }
          res = { message: `Closed ${closed} tab(s) via fallback.` };
        } else {
          throw dispatchErr;
        }
      }
      console.log(`${colors.green}✔ ${res.message || 'Tabs closed successfully.'}${colors.reset}\n`);
    } catch (err: any) {
      console.error(`\n${colors.red}Error closing tabs:${colors.reset} ${err.message}\n`);
      process.exit(1);
    }
    return;
  }

  // Listing tabs (bp tabs or bp tabs list)
  let filterStr = '';
  for (const a of args) {
    if (a.startsWith('--filter=')) {
      filterStr = a.slice(9).toLowerCase();
    }
  }

  try {
    const tabs: any[] = await client.dispatch('list_tabs', {});
    if (!Array.isArray(tabs) || tabs.length === 0) {
      console.log('\nNo open tabs found in connected browser.\n');
      return;
    }

    const filtered = filterStr
      ? tabs.filter((t) => (t.title || '').toLowerCase().includes(filterStr) || (t.url || '').toLowerCase().includes(filterStr))
      : tabs;

    console.log(`\n${colors.bold}Open Browser Tabs (${filtered.length}/${tabs.length}):${colors.reset}\n`);
    console.log(`  ${'ID'.padEnd(12)} ${'ACT'.padEnd(5)} ${'TITLE'.padEnd(45)} URL`);
    console.log(`  ${'-'.repeat(12)} ${'-'.repeat(5)} ${'-'.repeat(45)} ${'-'.repeat(30)}`);

    for (const t of filtered) {
      const idStr = String(t.id).padEnd(12);
      const actStr = t.active ? `${colors.green}*${colors.reset}`.padEnd(14) : ' '.padEnd(5);
      const titleStr = ((t.title || 'Untitled').slice(0, 42) + ((t.title || '').length > 42 ? '...' : '')).padEnd(45);
      const urlStr = colors.dim + (t.url || '') + colors.reset;
      console.log(`  ${idStr} ${actStr} ${titleStr} ${urlStr}`);
    }
    console.log('');
  } catch (err: any) {
    console.error(`\n${colors.red}Error fetching tabs:${colors.reset} ${err.message}\n`);
    process.exit(1);
  }
}

async function runNav(url: string, newTab = false) {
  if (!url) {
    console.error(`\n${colors.red}Error:${colors.reset} Please provide a URL to navigate to.\n`);
    process.exit(1);
  }

  let targetUrl = url;
  if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
    targetUrl = 'https://' + targetUrl;
  }

  try {
    console.log(`${colors.dim}Navigating ${newTab ? 'new tab' : 'current tab'} to ${targetUrl}...${colors.reset}`);
    const res = await client.dispatch('navigate', { url: targetUrl, newTab });
    console.log(`${colors.green}✔ Navigated to Tab #${res.tabId}: "${res.title || 'Untitled'}"${colors.reset}\n`);
  } catch (err: any) {
    console.error(`\n${colors.red}Navigation error:${colors.reset} ${err.message}\n`);
    process.exit(1);
  }
}

async function runSnap(outputFile?: string) {
  try {
    console.log(`${colors.dim}Capturing visible tab screenshot...${colors.reset}`);
    const res = await client.dispatch('screenshot', {});
    if (!res.dataUrl) {
      throw new Error('No image data returned from browser.');
    }

    const isJpeg = res.dataUrl.startsWith('data:image/jpeg');
    const defaultExt = isJpeg ? '.jpg' : '.png';
    const targetPath = outputFile || `/tmp/browserpilot-snap-${Date.now()}${defaultExt}`;
    const base64Data = res.dataUrl.replace(/^data:image\/\w+;base64,/, '');
    fs.writeFileSync(targetPath, Buffer.from(base64Data, 'base64'));
    console.log(`${colors.green}✔ Screenshot saved to ${targetPath}${colors.reset}\n`);
  } catch (err: any) {
    console.error(`\n${colors.red}Screenshot error:${colors.reset} ${err.message}\n`);
    process.exit(1);
  }
}

function askQuestion(query: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  return new Promise((resolve) => {
    rl.question(query, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function resolveEnvFilePath(): string {
  // Check local project .env, else check ~/.browserpilot/.env
  const localEnv = path.resolve(__dirname, '..', '.env');
  if (fs.existsSync(localEnv)) return localEnv;

  const projectRootEnv = path.resolve(__dirname, '..', '..', '.env');
  if (fs.existsSync(projectRootEnv)) return projectRootEnv;

  const userConfigDir = path.join(process.env.HOME || '/root', '.browserpilot');
  if (!fs.existsSync(userConfigDir)) {
    try { fs.mkdirSync(userConfigDir, { recursive: true }); } catch {}
  }
  return path.join(userConfigDir, '.env');
}

async function ensureSecretToken(interactive = true): Promise<string> {
  const envPath = resolveEnvFilePath();
  let existingToken = '';

  if (fs.existsSync(envPath)) {
    try {
      const content = fs.readFileSync(envPath, 'utf8');
      const m = content.match(/^SECRET_TOKEN=(.+)$/m);
      if (m && m[1]) {
        existingToken = m[1].trim();
      }
    } catch {}
  }

  if (existingToken && existingToken !== 'browserpilot-secret') {
    return existingToken;
  }

  console.log(`\n${colors.bold}${colors.cyan}[1/3] Security Check${colors.reset}`);

  let tokenToUse = '';
  if (interactive && process.stdin.isTTY) {
    console.log(`  ${colors.dim}No custom secret authentication token found.${colors.reset}`);
    console.log(`  ${colors.dim}A token prevents unauthorized access to your browser bridge.${colors.reset}\n`);

    const input = await askQuestion(
      `  ${colors.bold}Enter secret token${colors.reset} ${colors.dim}[press Enter to auto-generate secure token]:${colors.reset} `
    );
    if (input) {
      tokenToUse = input;
    }
  }

  if (!tokenToUse) {
    tokenToUse = `bp_${crypto.randomBytes(12).toString('hex')}`;
    console.log(`  ${colors.green}✔${colors.reset} Generated secure token: ${colors.bold}${colors.green}${tokenToUse}${colors.reset}`);
  } else {
    console.log(`  ${colors.green}✔${colors.reset} Using provided token: ${colors.bold}${colors.green}${tokenToUse}${colors.reset}`);
  }

  // Save to .env file
  try {
    let currentContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
    if (currentContent.includes('SECRET_TOKEN=')) {
      currentContent = currentContent.replace(/^SECRET_TOKEN=.*$/m, `SECRET_TOKEN=${tokenToUse}`);
    } else {
      currentContent += `\nSECRET_TOKEN=${tokenToUse}\n`;
    }
    fs.writeFileSync(envPath, currentContent.trim() + '\n', 'utf8');
    console.log(`  ${colors.dim}Saved to ${envPath}${colors.reset}`);
  } catch (err: any) {
    console.log(`  ${colors.yellow}⚠ Could not write token to ${envPath}: ${err.message}${colors.reset}`);
  }

  return tokenToUse;
}

function detectPublicIp(): string {
  try {
    const ip = execSync('curl -sS --max-time 3 https://api.ipify.org || curl -sS --max-time 3 https://ifconfig.me', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
    if (ip && /^(\d{1,3}\.){3}\d{1,3}$/.test(ip)) {
      return ip;
    }
  } catch {}
  return 'YOUR_VPS_IP';
}

interface FirewallInfo {
  type: 'ufw' | 'firewalld' | 'iptables' | 'nftables' | 'none';
  active: boolean;
  isPortAllowed: boolean;
}

function detectFirewall(port: string): FirewallInfo {
  // 1. Check ufw
  try {
    const ufwCheck = execSync('which ufw', { stdio: 'pipe' });
    if (ufwCheck) {
      const statusOut = execSync('ufw status 2>/dev/null', { encoding: 'utf8' }).trim();
      const isActive = statusOut.toLowerCase().includes('status: active');
      if (isActive) {
        const isAllowed = statusOut.includes(port);
        return { type: 'ufw', active: true, isPortAllowed: isAllowed };
      }
    }
  } catch {}

  // 2. Check firewalld
  try {
    const fwdCheck = execSync('which firewall-cmd', { stdio: 'pipe' });
    if (fwdCheck) {
      const state = execSync('firewall-cmd --state 2>/dev/null', { encoding: 'utf8' }).trim();
      const isActive = state === 'running';
      if (isActive) {
        const listPorts = execSync('firewall-cmd --list-ports 2>/dev/null', { encoding: 'utf8' });
        const isAllowed = listPorts.includes(`${port}/tcp`) || listPorts.includes(port);
        return { type: 'firewalld', active: true, isPortAllowed: isAllowed };
      }
    }
  } catch {}

  // 3. Check iptables
  try {
    const iptCheck = execSync('which iptables', { stdio: 'pipe' });
    if (iptCheck) {
      const rules = execSync('iptables -L INPUT -n 2>/dev/null', { encoding: 'utf8' });
      // If default policy is DROP or REJECT, firewall is actively blocking
      const isDropPolicy = rules.includes('Chain INPUT (policy DROP') || rules.includes('Chain INPUT (policy REJECT');
      if (isDropPolicy) {
        const isAllowed = rules.includes(`dpt:${port}`);
        return { type: 'iptables', active: true, isPortAllowed: isAllowed };
      }
    }
  } catch {}

  // 4. Check nftables
  try {
    const nftCheck = execSync('which nft', { stdio: 'pipe' });
    if (nftCheck) {
      const ruleset = execSync('nft list ruleset 2>/dev/null', { encoding: 'utf8' });
      if (ruleset && ruleset.includes('type filter hook input')) {
        const isAllowed = ruleset.includes(`dport ${port}`);
        return { type: 'nftables', active: true, isPortAllowed: isAllowed };
      }
    }
  } catch {}

  return { type: 'none', active: false, isPortAllowed: true };
}

function openFirewallPort(fwType: FirewallInfo['type'], port: string): boolean {
  const sudoPrefix = process.getuid && process.getuid() === 0 ? '' : 'sudo ';
  try {
    if (fwType === 'ufw') {
      execSync(`${sudoPrefix}ufw allow ${port}/tcp`, { stdio: 'inherit' });
      return true;
    } else if (fwType === 'firewalld') {
      execSync(`${sudoPrefix}firewall-cmd --permanent --add-port=${port}/tcp && ${sudoPrefix}firewall-cmd --reload`, { stdio: 'inherit' });
      return true;
    } else if (fwType === 'iptables') {
      execSync(`${sudoPrefix}iptables -I INPUT -p tcp --dport ${port} -j ACCEPT`, { stdio: 'inherit' });
      return true;
    } else if (fwType === 'nftables') {
      execSync(`${sudoPrefix}nft add rule inet filter input tcp dport ${port} accept`, { stdio: 'inherit' });
      return true;
    }
  } catch (err: any) {
    console.error(`  ${colors.red}✖ Failed to configure firewall rule:${colors.reset} ${err.message}`);
  }
  return false;
}

async function runStart(args: string[]) {
  let port = '8770';
  let shouldOpenTunnel = false;
  let forceFire = false;
  let noFire = false;

  for (const a of args) {
    if (a.startsWith('--port=')) {
      port = a.slice(7);
    } else if (a === '--tunnel') {
      shouldOpenTunnel = true;
    } else if (a === '--fire') {
      forceFire = true;
    } else if (a === '--no-fire') {
      noFire = true;
    }
  }

  console.log(`\n${colors.bold}${colors.cyan}══════════════════════════════════════════════════════════════${colors.reset}`);
  console.log(`  ${colors.bold}${colors.cyan}🚀 BrowserPilot Activation & Startup${colors.reset}`);
  console.log(`${colors.bold}${colors.cyan}══════════════════════════════════════════════════════════════${colors.reset}`);

  // 1. Ensure security secret token
  const token = await ensureSecretToken(!args.includes('--quiet'));

  // 2. Process Manager & Tunnel Check
  console.log(`\n${colors.bold}${colors.cyan}[2/3] Process & Tunnel Manager${colors.reset}`);

  let hasFirePm = false;
  try {
    execSync('which fire', { stdio: 'ignore' });
    hasFirePm = true;
  } catch {}

  if (!hasFirePm && !noFire) {
    console.log(`  ${colors.yellow}Fire PM was not found on your system.${colors.reset}`);
    console.log(`  Fire PM provides background process management and free reverse proxy tunnels.`);
    console.log(`  ${colors.bold}GitHub Repository:${colors.reset} ${colors.underline}${colors.blue}https://github.com/Fire-Package/fire-pm${colors.reset}\n`);

    let installFire = forceFire;
    if (!installFire && process.stdin.isTTY) {
      const ans = await askQuestion(
        `  ${colors.bold}Would you like to install Fire PM now?${colors.reset} ${colors.dim}[y/N]:${colors.reset} `
      );
      if (ans.toLowerCase() === 'y' || ans.toLowerCase() === 'yes') {
        installFire = true;
      }
    }

    if (installFire) {
      console.log(`\n  ${colors.cyan}Installing Fire PM via official installer...${colors.reset}`);
      try {
        execSync('curl -fsSL https://raw.githubusercontent.com/Fire-Package/fire-pm/main/install.sh | sudo bash', {
          stdio: 'inherit'
        });
        hasFirePm = true;
        console.log(`  ${colors.green}✔ Fire PM installed successfully!${colors.reset}\n`);
      } catch (err: any) {
        console.log(`  ${colors.yellow}⚠ Fire PM install failed (${err.message}). Continuing in standalone mode...${colors.reset}\n`);
      }
    } else {
      console.log(`  ${colors.dim}Continuing in standalone mode without Fire PM.${colors.reset}\n`);
    }
  }

  // 3. Launch Daemon
  console.log(`${colors.bold}${colors.cyan}[3/3] Starting Daemon on port ${port}...${colors.reset}`);

  const userDir = path.join(process.env.HOME || '/root', '.browserpilot');
  if (!fs.existsSync(userDir)) {
    try { fs.mkdirSync(userDir, { recursive: true }); } catch {}
  }
  const pidFile = path.join(userDir, 'daemon.pid');
  const logFile = path.join(userDir, 'daemon.log');

  let started = false;

  // Attempt 1: Fire PM
  if (hasFirePm) {
    try {
      execSync('fire start browserpilot', { stdio: 'pipe' });
      started = true;
      console.log(`  ${colors.green}✔${colors.reset} Started via Fire PM (${colors.bold}fire-browserpilot${colors.reset})`);
    } catch {
      // Fire PM might not have registered it yet, try systemctl if available
    }
  }

  // Attempt 2: Systemd
  if (!started) {
    try {
      execSync('systemctl start fire-browserpilot', { stdio: 'pipe' });
      started = true;
      console.log(`  ${colors.green}✔${colors.reset} Started via systemctl (${colors.bold}fire-browserpilot.service${colors.reset})`);
    } catch {}
  }

  // Attempt 3: Standalone background node process
  if (!started) {
    const distIndex = path.resolve(__dirname, 'index.js');
    const envPrefix = `PORT=${port} WS_PORT=${port} SECRET_TOKEN=${token}`;
    try {
      execSync(`nohup sh -c "${envPrefix} node ${distIndex}" > ${logFile} 2>&1 & echo $! > ${pidFile}`, {
        stdio: 'ignore'
      });
      started = true;
      const pid = fs.existsSync(pidFile) ? fs.readFileSync(pidFile, 'utf8').trim() : 'active';
      console.log(`  ${colors.green}✔${colors.reset} Started standalone background process (${colors.bold}PID: ${pid}${colors.reset})`);
      console.log(`  ${colors.dim}Logs written to: ${logFile}${colors.reset}`);
    } catch (e: any) {
      console.error(`  ${colors.red}✖ Failed to start daemon:${colors.reset} ${e.message}`);
      process.exit(1);
    }
  }

  // 4. Firewall & Port Access Verification
  const fw = detectFirewall(port);
  let tunnelUrl = '';

  if (fw.active && !fw.isPortAllowed) {
    console.log(`\n  ${colors.yellow}⚠ Firewall Notice:${colors.reset} Active firewall (${colors.bold}${fw.type}${colors.reset}) detected, but port ${colors.bold}${port}${colors.reset} is not allowed.`);

    if (hasFirePm) {
      console.log(`  ${colors.green}✔ Fire PM is available!${colors.reset} Opening a secure reverse proxy tunnel to bypass firewall...`);
      try {
        execSync(`fire tunnel open ${port}`, { stdio: 'pipe' });
      } catch {}
    } else if (process.stdin.isTTY) {
      const ans = await askQuestion(
        `  ${colors.bold}Would you like to open port ${port}/tcp using ${fw.type}?${colors.reset} ${colors.dim}[y/N]:${colors.reset} `
      );
      if (ans.toLowerCase() === 'y' || ans.toLowerCase() === 'yes') {
        const opened = openFirewallPort(fw.type, port);
        if (opened) {
          console.log(`  ${colors.green}✔ Successfully allowed port ${port}/tcp in ${fw.type}!${colors.reset}`);
        }
      } else {
        console.log(`  ${colors.dim}Skipped opening port. Direct connections may be blocked by your firewall.${colors.reset}`);
      }
    }
  } else if (shouldOpenTunnel && hasFirePm) {
    try {
      console.log(`\n  ${colors.dim}Opening reverse proxy tunnel on port ${port}...${colors.reset}`);
      execSync(`fire tunnel open ${port}`, { stdio: 'pipe' });
    } catch {}
  }

  // Check if tunnel descriptor exists
  const tunnelEnv = `/tmp/fire-tunnels/${port}.env`;
  if (fs.existsSync(tunnelEnv)) {
    try {
      const content = fs.readFileSync(tunnelEnv, 'utf8');
      const m = content.match(/URL=(https?:\/\/[^\s]+)/);
      if (m && m[1]) tunnelUrl = m[1];
    } catch {}
  }

  const publicIp = detectPublicIp();

  // Print Beautiful Connection Summary
  console.log(`\n${colors.bold}${colors.green}══════════════════════════════════════════════════════════════${colors.reset}`);
  console.log(`  ${colors.bold}${colors.green}✔ BrowserPilot Daemon is ONLINE!${colors.reset}`);
  console.log(`${colors.bold}${colors.green}══════════════════════════════════════════════════════════════${colors.reset}\n`);

  console.log(`  ${colors.bold}How to connect your Browser Extension:${colors.reset}`);
  console.log(`  ${colors.dim}1. Click the BrowserPilot extension icon in Edge / Chrome / Brave${colors.reset}`);
  console.log(`  ${colors.dim}2. Paste your WebSocket URL below & click "Connect":${colors.reset}\n`);

  if (tunnelUrl) {
    const wsTunnel = `wss://${tunnelUrl.replace(/^https?:\/\//, '')}?token=${token}`;
    console.log(`  ${colors.bold}${colors.cyan}● Secure Tunnel URL (Recommended):${colors.reset}`);
    console.log(`    ${colors.bold}${colors.green}${wsTunnel}${colors.reset}\n`);
  } else {
    console.log(`  ${colors.bold}${colors.cyan}● Direct IP Connection:${colors.reset}`);
    console.log(`    ${colors.bold}${colors.green}ws://${publicIp}:${port}?token=${token}${colors.reset}\n`);
    console.log(`  ${colors.bold}${colors.cyan}● Local Loopback (same machine):${colors.reset}`);
    console.log(`    ${colors.bold}${colors.green}ws://127.0.0.1:${port}?token=${token}${colors.reset}\n`);
  }

  console.log(`  ${colors.bold}Authentication Token:${colors.reset} ${colors.yellow}${token}${colors.reset}`);
  console.log(`  ${colors.bold}Status Check:${colors.reset}         ${colors.dim}Run ${colors.bold}bp status${colors.reset} or ${colors.bold}bp doctor${colors.reset}\n`);

  if (!tunnelUrl) {
    console.log(`  ${colors.dim}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}`);
    console.log(`  ${colors.bold}${colors.yellow}Firewall & Tunnel Guidance:${colors.reset}`);
    console.log(`  ${colors.dim}• Direct VPS IP:${colors.reset} Ensure port ${port} is open: ${colors.cyan}sudo ufw allow ${port}/tcp${colors.reset}`);
    console.log(`  ${colors.dim}• SSH Tunnel:${colors.reset}   Forward from local machine: ${colors.cyan}ssh -N -R ${port}:localhost:${port} user@${publicIp}${colors.reset}`);
    console.log(`  ${colors.dim}• Free Tunnel:${colors.reset}  Run ${colors.bold}bp tunnel open${colors.reset} or use Cloudflare / ngrok${colors.reset}`);
    console.log(`  ${colors.dim}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}\n`);
  }
}

async function runStop() {
  console.log(`\n${colors.bold}Stopping BrowserPilot Daemon...${colors.reset}`);

  // 1. Try Fire PM
  try {
    execSync('fire stop browserpilot', { stdio: 'pipe' });
    console.log(`  ${colors.green}✔${colors.reset} Stopped service via Fire PM`);
  } catch {}

  // 2. Try Systemd
  try {
    execSync('systemctl stop fire-browserpilot', { stdio: 'pipe' });
    console.log(`  ${colors.green}✔${colors.reset} Stopped systemd service`);
  } catch {}

  // 3. Try PID file
  const pidFile = path.join(process.env.HOME || '/root', '.browserpilot', 'daemon.pid');
  if (fs.existsSync(pidFile)) {
    try {
      const pid = fs.readFileSync(pidFile, 'utf8').trim();
      if (pid) {
        process.kill(Number(pid), 'SIGTERM');
        fs.unlinkSync(pidFile);
        console.log(`  ${colors.green}✔${colors.reset} Stopped standalone process (PID: ${pid})`);
      }
    } catch {}
  }

  // 4. Fallback pkill
  try {
    execSync("pkill -f 'browserpilot/mcp-server/dist/index.js' || true", { stdio: 'pipe' });
  } catch {}

  console.log(`\n${colors.green}✔ BrowserPilot daemon stopped.${colors.reset}\n`);
}

async function runRestart(args: string[]) {
  await runStop();
  await runStart(args);
}

async function runLogs(isFollow: boolean) {
  const flag = isFollow ? '-f' : '-n 50';

  // Check systemd first
  try {
    const isSys = execSync('systemctl is-active fire-browserpilot 2>/dev/null', { encoding: 'utf8' }).trim();
    if (isSys === 'active' || isSys === 'failed') {
      execSync(`journalctl -u fire-browserpilot ${flag} --no-pager`, { stdio: 'inherit' });
      return;
    }
  } catch {}

  // Check standalone log file
  const logFile = path.join(process.env.HOME || '/root', '.browserpilot', 'daemon.log');
  const tempLog = '/tmp/browserpilot.log';

  if (fs.existsSync(logFile)) {
    execSync(`tail ${flag} ${logFile}`, { stdio: 'inherit' });
  } else if (fs.existsSync(tempLog)) {
    execSync(`tail ${flag} ${tempLog}`, { stdio: 'inherit' });
  } else {
    console.log(`\n${colors.yellow}No active daemon log files found.${colors.reset}\n`);
  }
}

async function runTunnel(action?: string, port = '8770') {
  const tunnelFile = `/tmp/fire-tunnels/${port}.env`;

  if (action === 'open') {
    try {
      console.log(`${colors.dim}Opening Fire PM tunnel on port ${port}...${colors.reset}`);
      execSync(`fire tunnel open ${port}`, { stdio: 'inherit' });
    } catch (e: any) {
      console.error(`${colors.red}Failed to open tunnel:${colors.reset} ${e.message}`);
    }
    return;
  }

  if (action === 'close') {
    try {
      console.log(`${colors.dim}Closing Fire PM tunnel on port ${port}...${colors.reset}`);
      execSync(`fire tunnel close ${port}`, { stdio: 'inherit' });
    } catch (e: any) {
      console.error(`${colors.red}Failed to close tunnel:${colors.reset} ${e.message}`);
    }
    return;
  }

  // Default: display tunnel info
  if (fs.existsSync(tunnelFile)) {
    try {
      const content = fs.readFileSync(tunnelFile, 'utf8');
      const m = content.match(/URL=(https?:\/\/[^\s]+)/);
      if (m && m[1]) {
        console.log(`\n${colors.bold}Active Tunnel URL:${colors.reset}  ${colors.cyan}${m[1]}${colors.reset}`);
        console.log(`${colors.bold}WebSocket URL:${colors.reset}      ${colors.cyan}wss://${m[1].replace(/^https?:\/\//, '')}${colors.reset}\n`);
        return;
      }
    } catch {}
  }

  console.log(`\n${colors.yellow}No active tunnel found for port ${port}.${colors.reset} Run ${colors.bold}bp tunnel open${colors.reset} to create one.\n`);
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'help';

  switch (command) {
    case 'start':
    case 'activate':
      await runStart(args.slice(1));
      break;
    case 'stop':
      await runStop();
      break;
    case 'restart':
      await runRestart(args.slice(1));
      break;
    case 'logs':
      await runLogs(args.includes('-f') || args.includes('--follow'));
      break;
    case 'doctor':
      await runDoctor();
      break;
    case 'status':
      await runStatus();
      break;
    case 'tabs':
      await runTabs(args.slice(1));
      break;
    case 'nav': {
      const isNewTab = args.includes('--new-tab');
      const targetUrl = args.filter((a) => !a.startsWith('--'))[1];
      await runNav(targetUrl, isNewTab);
      break;
    }
    case 'snap': {
      const outFile = args.filter((a) => !a.startsWith('--'))[1];
      await runSnap(outFile);
      break;
    }
    case 'tunnel':
      await runTunnel(args[1]);
      break;
    case 'help':
    case '--help':
    case '-h':
      printHelp();
      break;
    default:
      console.error(`\n${colors.red}Unknown command:${colors.reset} ${command}`);
      printHelp();
      process.exit(1);
  }
}

main().catch((err) => {
  console.error('\nFatal CLI error:', err);
  process.exit(1);
});
