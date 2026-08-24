import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '..');
const uxRoot = path.join(repositoryRoot, 'ui-ux', 'ux');
const productionRoots = ['src', 'server', 'styles'].map((directory) =>
  path.join(repositoryRoot, directory),
);
const productionFiles = [
  path.join(repositoryRoot, 'index.html'),
  path.join(repositoryRoot, 'styles.css'),
];
const scannableExtensions = new Set([
  '.cjs',
  '.css',
  '.html',
  '.js',
  '.jsx',
  '.mjs',
  '.py',
  '.ts',
  '.tsx',
]);

const walk = (directory) => {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(entryPath) : [entryPath];
  });
};

const importPatterns = [
  /\b(?:import|export)\s+(?:type\s+)?[^;'"`]*?\sfrom\s*['"]([^'"]+)['"]/g,
  /\bimport\s*['"]([^'"]+)['"]/g,
  /\b(?:import|require)\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  /@import\s+(?:url\(\s*)?['"]([^'"]+)['"]/g,
  /\b(?:href|src)\s*=\s*['"]([^'"]+)['"]/g,
];

const normalizeSpecifier = (specifier) => specifier.split(/[?#]/, 1)[0];

const resolvesIntoUx = (sourceFile, specifier) => {
  const normalized = normalizeSpecifier(specifier);
  if (!normalized || /^(?:data:|https?:|node:)/.test(normalized)) return false;

  const target = path.isAbsolute(normalized)
    ? path.resolve(normalized)
    : normalized.startsWith('.')
      ? path.resolve(path.dirname(sourceFile), normalized)
      : null;

  if (!target) {
    return /(?:^|\/)ui-ux\/ux(?:\/|$)/.test(normalized);
  }

  const relative = path.relative(uxRoot, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
};

const extractImports = (source) =>
  importPatterns.flatMap((pattern) =>
    [...source.matchAll(new RegExp(pattern.source, pattern.flags))].map((match) => match[1]),
  );

const assertGuardLogic = () => {
  const probe = path.join(repositoryRoot, 'src', 'renderer', 'guard-probe.ts');
  const blockedImport = "import { fixture } from '../../ui-ux/ux/concepts/fixtures.js';";
  const [blockedSpecifier] = extractImports(blockedImport);
  if (!blockedSpecifier || !resolvesIntoUx(probe, blockedSpecifier)) {
    throw new Error('UX boundary guard self-check failed to reject a production UX import');
  }
  if (resolvesIntoUx(probe, './uiElements.js')) {
    throw new Error('UX boundary guard self-check rejected a production-local import');
  }
};

assertGuardLogic();

const filesToScan = [
  ...productionRoots.flatMap(walk),
  ...productionFiles.filter((filePath) => fs.existsSync(filePath)),
].filter((filePath) => scannableExtensions.has(path.extname(filePath)));

const violations = filesToScan.flatMap((filePath) => {
  const source = fs.readFileSync(filePath, 'utf8');
  return extractImports(source)
    .filter((specifier) => resolvesIntoUx(filePath, specifier))
    .map((specifier) => ({ filePath, specifier }));
});

if (violations.length > 0) {
  console.error('UX dependency boundary failed: production code must not import from ui-ux/ux.');
  violations.forEach(({ filePath, specifier }) => {
    console.error(`- ${path.relative(repositoryRoot, filePath)} -> ${specifier}`);
  });
  process.exitCode = 1;
} else {
  console.log(`UX dependency boundary passed (${filesToScan.length} production files scanned)`);
}
