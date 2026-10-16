#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { DaemonClient } from './daemon-client.js';

const client = new DaemonClient();

// ANSI color helpers
const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m'
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
  ${colors.green}doctor${colors.reset}                  Run end-to-end environment & connectivity diagnostics
  ${colors.green}status${colors.reset}                  Show current bridge, extension, and active tab status
  ${colors.green}tabs [list]${colors.reset}             List open browser tabs (${colors.dim}--filter=<keyword>${colors.reset})
  ${colors.green}tabs close <ids...>${colors.reset}     Close one or more tabs by ID (${colors.dim}--match=<pattern>${colors.reset})
  ${colors.green}nav <url>${colors.reset}               Navigate active tab to URL (${colors.dim}--new-tab${colors.reset})
  ${colors.green}snap [file.png]${colors.reset}         Take screenshot of active tab and save to disk
  ${colors.green}tunnel [url|open|close]${colors.reset} Manage/view Fire PM reverse proxy tunnel
  ${colors.green}help${colors.reset}                    Show this help message

${colors.bold}EXAMPLES:${colors.reset}
  bp doctor
  bp status
  bp tabs list
  bp tabs list --filter=youtube
  bp tabs close 1488399560 1488399570
  bp tabs close --match="youtube.com/@"
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

async function runTunnel(action?: string) {
  const tunnelFile = `/tmp/fire-tunnels/8770.env`;

  if (action === 'open') {
    try {
      console.log(`${colors.dim}Opening Fire PM tunnel on port 8770...${colors.reset}`);
      execSync('fire tunnel open 8770', { stdio: 'inherit' });
    } catch (e: any) {
      console.error(`${colors.red}Failed to open tunnel:${colors.reset} ${e.message}`);
    }
    return;
  }

  if (action === 'close') {
    try {
      console.log(`${colors.dim}Closing Fire PM tunnel on port 8770...${colors.reset}`);
      execSync('fire tunnel close 8770', { stdio: 'inherit' });
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

  console.log(`\n${colors.yellow}No active tunnel found for port 8770.${colors.reset} Run ${colors.bold}bp tunnel open${colors.reset} to create one.\n`);
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'help';

  switch (command) {
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
