// Shared, side-effect-free parsing for the bundled server entry point.
export function parseServeOptions(argv) {
  const options = { port: 8931, noOpen: false, sessionDir: null };
  const seen = new Set();
  const args = argv[0] === 'serve' ? argv.slice(1) : argv;
  for (let i = 0; i < args.length; i++) {
    const [flag, ...inline] = args[i].split('=');
    if (!['--port', '--session-dir', '--no-open'].includes(flag)) throw new Error('Unknown serve option: ' + flag);
    if (seen.has(flag)) throw new Error('Duplicate serve option: ' + flag);
    seen.add(flag);
    if (flag === '--no-open') {
      if (inline.length) throw new Error('--no-open does not take a value');
      options.noOpen = true;
      continue;
    }
    const value = inline.length ? inline.join('=') : args[++i];
    if (!value || value.startsWith('--')) throw new Error('Missing value for ' + flag);
    if (flag === '--port') {
      if (!/^\d+$/.test(value) || !Number.isInteger(Number(value)) || Number(value) > 65535) throw new Error('Port must be an integer from 0 to 65535');
      options.port = Number(value);
    } else options.sessionDir = value;
  }
  return options;
}
