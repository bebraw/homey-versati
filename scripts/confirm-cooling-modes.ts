import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const output = optionValue(args, '--output') ?? path.join('tmp', 'cooling-modes.json');
  const probeArgs = [...args];

  if (!hasOption(probeArgs, '--modes')) {
    probeArgs.push('--modes', 'cool,cool_hot_water');
  }
  if (!hasOption(probeArgs, '--output')) {
    probeArgs.push('--output', output);
  }

  await fs.mkdir(path.dirname(output), { recursive: true });
  await run(process.execPath, ['.homeybuild/scripts/probe-modes.js', ...probeArgs]);
  await run(process.execPath, ['.homeybuild/scripts/analyze-mode-report.js', output]);
}

function hasOption(args: string[], option: string): boolean {
  return args.includes(option);
}

function optionValue(args: string[], option: string): string | undefined {
  const index = args.indexOf(option);
  return index >= 0 ? args[index + 1] : undefined;
}

function run(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} ${args.join(' ')} exited with ${code ?? 'unknown status'}`));
      }
    });
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
