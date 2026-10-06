/* eslint-disable no-template-curly-in-string */

const builder = require('electron-builder')
const beforePack = require('./build-before-pack')
const afterPack = require('./build-after-pack')
const pkg = require('../package.json')
const repository = new URL(pkg.repository.url.replace(/^git\+/, '').replace(/\.git$/, ''))
const [repositoryOwner, repositoryName] = repository.pathname.slice(1).split('/')

/**
* @type {import('electron-builder').Configuration}
* @see https://www.electron.build/configuration/configuration
*/
const options = {
  ...(process.env.RAIN_ELECTRON_DIST ? { electronDist: require('node:path').resolve(process.env.RAIN_ELECTRON_DIST) } : {}),
  appId: 'com.rainmusic.desktop',
  productName: 'rain-music-desktop',
  // 原生模块（better-sqlite3 / bufferutil / utf-8-validate / font_manager）随包提供
  // 与当前 Electron 兼容的预编译二进制，不用 node-gyp 就地重编译：
  // 本机没有 Visual Studio C++ 工具链，且项目路径含空格（node-gyp 已知限制）。
  // 若后续在具备 VS 工具链的机器上需要重编译，可临时改为 true。
  npmRebuild: false,
  beforePack,
  afterPack,
  protocols: {
    name: 'rain-music-protocol',
    schemes: [
      'rainmusic',
    ],
  },
  directories: {
    buildResources: './resources',
    output: process.env.RAIN_PACKAGE_OUTPUT || './build',
  },
  files: [
    '!node_modules/**/*',
    'node_modules/font-list',
    'node_modules/better-sqlite3/lib',
    'node_modules/better-sqlite3/package.json',
    'node_modules/better-sqlite3/build/Release/better_sqlite3.node',
    'node_modules/electron-font-manager/index.js',
    'node_modules/electron-font-manager/package.json',
    'node_modules/electron-font-manager/build/Release/font_manager.node',
    'node_modules/node-gyp-build',
    'node_modules/bufferutil',
    'node_modules/utf-8-validate',
    'dist/**/*',
  ],
  asar: {
    smartUnpack: false,
  },
  extraResources: [
    './licenses',
  ],
  publish: [
    {
      provider: 'github',
      owner: repositoryOwner,
      repo: repositoryName,
    },
  ],
}
/**
 * @type {import('electron-builder').Configuration}
 * @see https://www.electron.build/configuration/configuration
 */
const winOptions = {
  win: {
    icon: './resources/icons/icon.ico',
    legalTrademarks: 'Rain Music',
    // artifactName: '${productName}-v${version}-${env.ARCH}-${env.TARGET}.${ext}',
  },
  nsis: {
    oneClick: false,
    language: '2052',
    allowToChangeInstallationDirectory: true,
    // differentialPackage: true,
    license: './licenses/license.rtf',
    shortcutName: 'Rain Music',
  },
}
/**
 * @type {import('electron-builder').Configuration}
 * @see https://www.electron.build/configuration/configuration
 */
const linuxOptions = {
  linux: {
    maintainer: 'ChoyChou <zhouchaoyi03@foxmail.com>',
    // artifactName: '${productName}-${version}.${env.ARCH}.${ext}',
    icon: './resources/icons',
    category: 'Utility;AudioVideo;Audio;Player;Music;',
    desktop: {
      // https://www.electron.build/app-builder-lib.interface.linuxdesktopfile
      // https://www.electronjs.org/docs/latest/tutorial/linux-desktop-actions
      // https://specifications.freedesktop.org/desktop-entry-spec/latest/example.html
      // https://developer.gnome.org/documentation/guidelines/maintainer/integrating.html#desktop-files
      entry: {
        Name: 'Rain Music',
        'Name[zh_CN]': 'Rain Music',
        'Name[zh_TW]': 'Rain Music',
        Encoding: 'UTF-8',
        MimeType: 'x-scheme-handler/rainmusic',
        StartupNotify: 'false',
      },
    },
  },
  appImage: {
    license: './licenses/license_zh.txt',
    category: 'Utility;AudioVideo;Audio;Player;Music;',
  },
}
/**
 * @type {import('electron-builder').Configuration}
 * @see https://www.electron.build/configuration/configuration
 */
const macOptions = {
  mac: {
    icon: './resources/icons/icon.icns',
    category: 'public.app-category.music',
    // artifactName: '${productName}-${version}.${ext}',
  },
  dmg: {
    window: {
      width: 530,
      height: 380,
    },
    contents: [
      {
        x: 140,
        y: 200,
      },
      {
        x: 390,
        y: 200,
        type: 'link',
        path: '/Applications',
      },
    ],
    title: 'Rain Music v${version}',
  },
}

// win: {
// tagret: {
//   setup: ['nsis', '${productName}-v${version}-${env.ARCH}-Setup.${ext}'],
//   green: ['7z', '${productName}-v${version}-${env.ARCH}-green.${ext}'],
//   portable: ['portable', '${productName}-v${version}-${env.ARCH}-portable.${ext}'],
// },
// },
// linux: {
// platform: Platform.WINDOWS,
// arch: {
//   x64: builder.Arch.x64,
//   arm64: builder.Arch.arm64,
//   armv7l: builder.Arch.armv7l,
// },
// tagret: {
//   deb: ['deb', '${productName}_${version}_${env.ARCH}.${ext}'],
//   appImage: ['AppImage', '${productName}_${version}_${env.ARCH}.${ext}'],
//   pacman: ['pacman', '${productName}_${version}_${env.ARCH}.${ext}'],
//   rpm: ['rpm', '${productName}-${version}.${env.ARCH}.${ext}'],
// },
// },
// mac: {
// arch: {
//   x64: builder.Arch.x64,
//   x86: builder.Arch.ia32,
//   arm64: builder.Arch.arm64,
// },
// tagret: {
//   dmg: ['dmg', '${productName}-${version}-${env.ARCH}.${ext}'],
// },
// },

const createTarget = {
  /**
   *
   * @param {*} arch
   * @param {*} packageType
   * @returns {{ buildOptions: import('electron-builder').CliOptions, options: import('electron-builder').Configuration }}
   */
  win(arch, packageType) {
    switch (packageType) {
      case 'setup':
        winOptions.artifactName = `\${productName}-v\${version}-${arch}-Setup.\${ext}`
        return {
          buildOptions: { win: ['nsis'] },
          options: winOptions,
        }
      case 'green':
        winOptions.artifactName = `\${productName}-v\${version}-win_${arch}-green.\${ext}`
        return {
          buildOptions: { win: ['7z'] },
          options: winOptions,
        }
      case 'win7_setup':
        winOptions.artifactName = `\${productName}-v\${version}-win7_${arch}-Setup.\${ext}`
        return {
          buildOptions: { win: ['nsis'] },
          options: winOptions,
        }
      case 'win7_green':
        winOptions.artifactName = `\${productName}-v\${version}-win7_${arch}-green.\${ext}`
        return {
          buildOptions: { win: ['7z'] },
          options: winOptions,
        }
      case 'portable':
        winOptions.artifactName = `\${productName}-v\${version}-${arch}-portable.\${ext}`
        return {
          buildOptions: { win: ['portable'] },
          options: winOptions,
        }
      default: throw new Error('Unknown package type: ' + packageType)
    }
  },
  /**
   *
   * @param {*} arch
   * @param {*} packageType
   * @returns {{ buildOptions: import('electron-builder').CliOptions, options: import('electron-builder').Configuration }}
   */
  linux(arch, packageType) {
    switch (packageType) {
      case 'deb':
        linuxOptions.artifactName = `\${productName}_\${version}_${arch == 'x64' ? 'amd64' : arch}.\${ext}`
        return {
          buildOptions: { linux: ['deb'] },
          options: linuxOptions,
        }
      case 'appImage':
        linuxOptions.artifactName = `\${productName}_\${version}_${arch}.\${ext}`
        return {
          buildOptions: { linux: ['AppImage'] },
          options: linuxOptions,
        }
      case 'pacman':
        linuxOptions.artifactName = `\${productName}_\${version}_${arch}.\${ext}`
        return {
          buildOptions: { linux: ['pacman'] },
          options: linuxOptions,
        }
      case 'rpm':
        linuxOptions.artifactName = `\${productName}-\${version}.${arch}.\${ext}`
        return {
          buildOptions: { linux: ['rpm'] },
          options: linuxOptions,
        }
      default: throw new Error('Unknown package type: ' + packageType)
    }
  },
  /**
   *
   * @param {*} arch
   * @param {*} packageType
   * @returns {{ buildOptions: import('electron-builder').CliOptions, options: import('electron-builder').Configuration }}
   */
  mac(arch, packageType) {
    switch (packageType) {
      case 'dmg':
        macOptions.artifactName = `\${productName}-\${version}-${arch}.\${ext}`
        return {
          buildOptions: { mac: ['dmg'] },
          options: macOptions,
        }
      default: throw new Error('Unknown package type: ' + packageType)
    }
  },
}

/**
 *
 * @param {'win' | 'mac' | 'linux' | 'dir'} target 构建目标平台
 * @param {'x86_64' | 'x64' | 'x86' | 'arm64' | 'armv7l'} arch 包架构
 * @param {*} packageType 包类型
 * @param {'onTagOrDraft' | 'always' | 'never'} publishType 发布类型
 */
const build = async(target, arch, packageType, publishType) => {
  if (target == 'dir') {
    await builder.build({
      dir: true,
      publish: 'never',
      config: { ...options, ...winOptions, ...linuxOptions, ...macOptions },
    })
    return
  }
  if (target == 'register-dir') {
    // 免安装的「预览」构建：
    // 1. 只构建 Windows 目录版，避免 dir 分支混合三平台配置
    // 2. 去掉 protocols，避免向系统注册表写入 rainmusic:// 协议关联
    //    （实测该键会指向官方版安装目录，注册会把对方的协议关联劫持过来）
    // 3. 换用独立的 appId / productName：
    //    - 与已安装的官方版区分开，数据目录、开始菜单项、单实例锁天然隔离
    //    - 避免和正在运行的官方版抢 singleInstanceLock 而启动即退出
    // 4. 关闭 npmRebuild：原生模块（better-sqlite3 / bufferutil / utf-8-validate）
    //    均已自带与 Electron 42 兼容的预编译二进制，无需本地 node-gyp 重编译
    //    （本机也没有 Visual Studio C++ 工具链）
    //    注意：npmRebuild 是 Configuration 的选项，必须放在 config 内
    const { protocols, ...previewOptions } = options
    await builder.build({
      dir: true,
      x64: true,
      publish: 'never',
      config: {
        ...previewOptions,
        ...winOptions,
        appId: 'com.rainmusic.desktop.preview',
        productName: 'rain-music-preview',
        npmRebuild: false,
        extraMetadata: {
          productName: 'rain-music-preview',
        },
      },
    })
    return
  }
  const targetInfo = createTarget[target](arch, packageType)
  // Promise is returned
  await builder.build({
    ...targetInfo.buildOptions,
    publish: publishType ?? 'never',
    x64: arch == 'x64' || arch == 'x86_64',
    ia32: arch == 'x86' || arch == 'x86_64',
    arm64: arch == 'arm64',
    armv7l: arch == 'armv7l',
    config: { ...options, ...targetInfo.options },
  })
  // .then((result) => {
  //   console.log(JSON.stringify(result))
  // })
  // .catch((error) => {
  //   console.error(error)
  // })
}

const params = {}

for (const param of process.argv.slice(2)) {
  const [name, value] = param.split('=')
  params[name] = value
}

if (params.target == null) throw new Error('Missing target')
if (params.target != 'dir' && params.target != 'register-dir' && params.arch == null) throw new Error('Missing arch')
if (params.target != 'dir' && params.target != 'register-dir' && params.type == null) throw new Error('Missing type')

console.log(params.target, params.arch, params.type, params.publish ?? '')
build(params.target, params.arch, params.type, params.publish).catch(error => {
  console.error(error)
  process.exitCode = 1
})
