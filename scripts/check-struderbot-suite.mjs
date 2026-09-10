import assert from 'node:assert/strict';
import {existsSync, readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const skillsRoot = join(repoRoot, 'skills');
const manifestPath = join(skillsRoot, 'STRUDERBOT_SUITE.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

function fail(message) {
  throw new Error(`StruderBot suite check failed: ${message}`);
}

function run(command, args, label) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    windowsHide: true
  });
  if (result.error || result.status !== 0) {
    const detail = [result.error?.message, result.stdout, result.stderr]
      .filter(Boolean)
      .join('\n')
      .trim();
    fail(`${label}\n${detail}`);
  }
  return result.stdout.trim();
}

function findPython() {
  const candidates = [];
  if (process.env.PYTHON) candidates.push([process.env.PYTHON, []]);
  candidates.push(['python3', []], ['python', []]);
  if (process.platform === 'win32') candidates.push(['py', ['-3']]);

  for (const [command, prefix] of candidates) {
    const result = spawnSync(command, [...prefix, '-c',
      'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")'], {
      encoding: 'utf8', windowsHide: true
    });
    if (result.status !== 0) continue;
    const match = result.stdout.trim().match(/^(\d+)\.(\d+)$/);
    if (!match) continue;
    if (Number(match[1]) > 3 ||
        (Number(match[1]) === 3 && Number(match[2]) >= 10)) {
      return {command, prefix, version: match[0]};
    }
  }
  fail('Python 3.10+ was not found. Set PYTHON to a real interpreter path; Windows Store shims are not sufficient.');
}

assert.equal(manifest.schemaVersion, 1);
assert.equal(manifest.installMode, 'complete-suite');

for (const [name, skill] of Object.entries(manifest.skills)) {
  const root = join(skillsRoot, name);
  if (!existsSync(root)) fail(`missing skill directory: ${name}`);
  for (const relativePath of skill.requiredFiles) {
    if (!existsSync(join(root, relativePath))) {
      fail(`${name} is missing required file ${relativePath}`);
    }
  }
  for (const dependency of [...(skill.requires ?? []), ...(skill.optional ?? [])]) {
    if (!manifest.skills[dependency]) {
      fail(`${name} names unknown suite dependency ${dependency}`);
    }
  }
  for (const dependency of skill.saamSkills ?? []) {
    if (!existsSync(join(skillsRoot, dependency, 'SKILL.md'))) {
      fail(`${name} requires missing SAAM skill ${dependency}`);
    }
  }

  const skillText = readFileSync(join(root, 'SKILL.md'), 'utf8');
  if (!skillText.startsWith('---')) fail(`${name}/SKILL.md lacks frontmatter`);
  if (!new RegExp(`^name:\\s*${name}\\s*$`, 'm').test(skillText)) {
    fail(`${name}/SKILL.md has the wrong frontmatter name`);
  }
  const agentText = readFileSync(join(root, 'agents', 'openai.yaml'), 'utf8');
  if (!agentText.includes(`$${name}`)) {
    fail(`${name}/agents/openai.yaml default prompt does not invoke $${name}`);
  }
}

const python = findPython();
const py = (args, label) => run(python.command, [...python.prefix, ...args], label);
const suiteSkillPaths = Object.keys(manifest.skills).map((name) => join('skills', name));

py(['-m', 'compileall', '-q', ...suiteSkillPaths], 'Python syntax compilation');

for (const skill of [
  'dobot-patterned-wall',
  'dobot-programmer',
  'dobot-non-planar-cladding'
]) {
  py(['-m', 'unittest', 'discover', '-s', join('skills', skill, 'tests'),
    '-p', 'test_*.py', '-v'], `${skill} regression tests`);
}

const gableScript = [
  'from pathlib import Path',
  'import sys',
  `root = Path(r"${join(skillsRoot, 'dobot-non-planar-cladding')}")`,
  'sys.path.insert(0, str(root / "scripts"))',
  'sys.path.insert(0, str(root / "tests"))',
  'import test_nonplanar_gable_cladding_toolpath as tests',
  'for name in sorted(n for n in dir(tests) if n.startswith("test_")):',
  '    getattr(tests, name)()'
].join('\n');
py(['-c', gableScript], 'non-planar gable function tests');

py([join('skills', 'dobot-dog-ears', 'scripts', 'plan_rectangular_dog_ears.py'),
  '--xmin=-20', '--xmax=20', '--ymin=-30', '--ymax=30'],
  'dog-ear planner smoke test');
py([join('skills', 'dobot-prime-lead-in', 'scripts', 'plan_prime.py'),
  '--part-xmin=-20', '--part-xmax=20', '--part-ymin=-30', '--part-ymax=30',
  '--bed-xmin=-100', '--bed-xmax=100', '--bed-ymin=-130', '--bed-ymax=130',
  '--entry-x=-20', '--entry-y=-30'], 'prime planner smoke test');
py([join('skills', 'dobot-spiral-lip', 'scripts', 'plan_lip.py'), '3'],
  'spiral-lip planner smoke test');
py([join('skills', 'dobot-patterned-wall', 'scripts', 'triangular_wall_geometry.py'),
  '--guide-radius=30', '--envelope=8', '--line-spacing=0.78',
  '--inner-perimeters=0', '--outer-perimeters=0'],
  'triangular geometry smoke test');
py([join('skills', 'dobot-patterned-wall', 'scripts', 'rectangular_triangular_touchback.py')],
  'rectangular touchback smoke test');

console.log(`StruderBot suite complete: ${Object.keys(manifest.skills).length} skills, Python ${python.version}, no third-party Python packages.`);
