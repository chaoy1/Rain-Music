const path = require('path')
const ESLintPlugin = require('eslint-webpack-plugin')

module.exports = {
  target: 'electron-main',
  output: {
    filename: '[name].js',
    library: {
      type: 'commonjs2',
    },
    path: path.join(__dirname, '../../dist'),
  },
  externals: {
    'font-list': 'font-list',
    'better-sqlite3': 'better-sqlite3',
    'electron-font-manager': 'electron-font-manager',
    bufferutil: 'bufferutil',
    'utf-8-validate': 'utf-8-validate',
  },
  resolve: {
    alias: {
      '@main': path.join(__dirname, '../../src/main'),
      '@renderer': path.join(__dirname, '../../src/renderer'),
      '@lyric': path.join(__dirname, '../../src/renderer-lyric'),
      '@common': path.join(__dirname, '../../src/common'),
    },
    extensions: ['.tsx', '.ts', '.js', '.mjs', '.json', '.node'],
  },
  module: {
    rules: [
      {
        test: /\.node$/,
        use: 'node-loader',
      },
      {
        test: /\.tsx?$/,
        use: 'ts-loader',
        exclude: /node_modules/,
      },
    ],
  },
  plugins: [
    // 预览构建可通过 DISABLE_ESLINT=1 跳过 lint，避免上游既有 lint 问题阻断构建
    ...(process.env.DISABLE_ESLINT ? [] : [new ESLintPlugin({ exclude: ['node_modules', 'vendor'] })]),
  ],
}
