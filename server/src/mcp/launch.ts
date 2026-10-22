import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { PermissionBridge } from '../adapters/types.js';
import { SERVER_NAME, TOOL_NAME } from './permission-tool.js';

/** The name Claude Code knows the permission tool by. */
export const PERMISSION_TOOL = `mcp__${SERVER_NAME}__${TOOL_NAME}`;

/** The tool's file next to this one: `.js` once built, the `.ts` source (run by Node's type stripping) in development. */
function toolScript(): string {
  const js = fileURLToPath(new URL('./permission-tool.js', import.meta.url));
  return fs.existsSync(js) ? js : fileURLToPath(new URL('./permission-tool.ts', import.meta.url));
}

/** `--mcp-config` JSON that starts the permission tool for one run. */
export function permissionMcpConfig(bridge: PermissionBridge): string {
  return JSON.stringify({
    mcpServers: {
      [SERVER_NAME]: {
        type: 'stdio',
        command: process.execPath,
        args: [toolScript()],
        env: { COUNCIL_URL: bridge.url, COUNCIL_TAB_ID: bridge.tabId, COUNCIL_PERMISSION_TOKEN: bridge.token },
      },
    },
  });
}
