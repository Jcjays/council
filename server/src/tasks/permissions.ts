/**
 * What "Allow for this tab" remembers. A simple shell command is remembered by
 * its program and subcommand (`Bash(npm test:*)`); anything that chains,
 * pipes, redirects or substitutes is remembered only exactly; other tools by name.
 */

const SHELL_TOOLS = new Set(['Bash', 'PowerShell']);
const SHELL_OPERATORS = /&&|\|\||[;|`<>\n]|\$\(/;
const SUBCOMMAND = /^[A-Za-z][\w:-]*$/;

function commandOf(input: unknown): string | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const command = (input as Record<string, unknown>).command;
  return typeof command === 'string' ? command.trim() : undefined;
}

function commandPrefix(command: string): string | undefined {
  if (SHELL_OPERATORS.test(command)) return undefined;
  const [program, second] = command.split(/\s+/);
  if (!program) return undefined;
  return second && SUBCOMMAND.test(second) ? `${program} ${second}` : program;
}

export function permissionRule(toolName: string, input: unknown): string {
  const command = SHELL_TOOLS.has(toolName) ? commandOf(input) : undefined;
  if (command === undefined) return toolName;
  const prefix = commandPrefix(command);
  return prefix ? `${toolName}(${prefix}:*)` : `${toolName}(${command})`;
}

export function ruleAllows(rule: string, toolName: string, input: unknown): boolean {
  if (rule === toolName) return true;
  if (!rule.startsWith(`${toolName}(`) || !rule.endsWith(')')) return false;
  const command = commandOf(input);
  if (command === undefined) return false;
  const body = rule.slice(toolName.length + 1, -1);
  if (!body.endsWith(':*')) return body === command;
  if (SHELL_OPERATORS.test(command)) return false;
  const prefix = body.slice(0, -2);
  return command === prefix || command.startsWith(`${prefix} `);
}

const ACTIONS: Record<string, { action: string; field: string }> = {
  Bash: { action: 'run a command', field: 'command' },
  PowerShell: { action: 'run a command', field: 'command' },
  WebFetch: { action: 'fetch a web page', field: 'url' },
  WebSearch: { action: 'search the web', field: 'query' },
  Write: { action: 'write a file', field: 'file_path' },
  Edit: { action: 'edit a file', field: 'file_path' },
  MultiEdit: { action: 'edit a file', field: 'file_path' },
  NotebookEdit: { action: 'edit a notebook', field: 'notebook_path' },
};

/** A short sentence for the approval card: what the worker wants to do, and to what. */
export function describeRequest(toolName: string, input: unknown): { action: string; detail: string } {
  const known = ACTIONS[toolName];
  const fields = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  if (known && typeof fields[known.field] === 'string') return { action: known.action, detail: fields[known.field] as string };
  return { action: `use ${toolName}`, detail: JSON.stringify(input ?? {}) };
}
