import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const mode = process.argv[2]
if (mode !== 'debug' && mode !== 'release') {
  throw new Error('Use npm run android:apk or npm run android:release.')
}
/** @type {NodeJS.ProcessEnv} */
const env = { ...process.env, VITE_STORAGE_BACKEND: 'local' }
if (mode === 'release') {
  // 개발자별 비밀 파일은 저장소 밖에 둔다. CI에서는 환경 변수로 같은 값을 주입할 수 있다.
  const configPath = env.BALJACHWI_ANDROID_SIGNING_FILE ||
    join(homedir(), '.config', 'dongne-baljachwi', 'android-signing', 'signing.json')
  const fields = {
    BALJACHWI_ANDROID_KEYSTORE_PATH: 'storeFile',
    BALJACHWI_ANDROID_KEYSTORE_PASSWORD: 'storePassword',
    BALJACHWI_ANDROID_KEY_ALIAS: 'keyAlias',
    BALJACHWI_ANDROID_KEY_PASSWORD: 'keyPassword'
  }
  if (Object.keys(fields).some(name => !env[name]) && existsSync(configPath)) {
    const parsed = /** @type {unknown} */ (JSON.parse(readFileSync(configPath, 'utf8').replace(/^\uFEFF/, '')))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('The Android signing configuration must be an object.')
    }
    const config = /** @type {Record<string, unknown>} */ (parsed)
    for (const [name, field] of Object.entries(fields)) {
      const value = config[field]
      if (!env[name] && typeof value === 'string') env[name] = value
    }
  }
  if (Object.keys(fields).some(name => !env[name]?.trim())) {
    throw new Error('Release signing is not configured. See docs/ANDROID-RELEASE.md.')
  }
  if (!env.BALJACHWI_ANDROID_KEYSTORE_PATH || !existsSync(env.BALJACHWI_ANDROID_KEYSTORE_PATH)) {
    throw new Error('The Android upload keystore file does not exist.')
  }
}

/** @param {string} command @param {string[]} args @param {string} [cwd] */
function run(command, args, cwd = root) {
  const result = spawnSync(command, args, { cwd, env, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}

// npm의 실제 JS 진입점을 사용해 Windows .cmd 실행과 셸 인용 차이를 피한다.
if (!process.env.npm_execpath) throw new Error('Run this script through npm.')
run(process.execPath, [process.env.npm_execpath, 'run', 'android:sync'])
const tasks = mode === 'debug' ? [':app:assembleDebug'] : [':app:assembleRelease', ':app:bundleRelease']
if (process.platform === 'win32') {
  run('cmd.exe', ['/d', '/s', '/c', `gradlew.bat --no-daemon ${tasks.join(' ')}`], join(root, 'android'))
} else {
  run('sh', ['./gradlew', '--no-daemon', ...tasks], join(root, 'android'))
}

const output = join(root, 'output', 'android')
mkdirSync(output, { recursive: true })
const artifacts = mode === 'debug'
  ? [['apk/debug/app-debug.apk', 'dongne-baljachwi-debug.apk']]
  : [['apk/release/app-release.apk', 'dongne-baljachwi-release.apk'],
    ['bundle/release/app-release.aab', 'dongne-baljachwi-release.aab']]
const checksums = []
for (const [source, name] of artifacts) {
  const target = join(output, name)
  copyFileSync(join(root, 'android', 'app', 'build', 'outputs', source), target)
  checksums.push(`${createHash('sha256').update(readFileSync(target)).digest('hex')}  ${name}`)
  console.log(`Android artifact: ${target}`)
}
writeFileSync(join(output, `SHA256SUMS-${mode}.txt`), checksums.join('\n') + '\n')
