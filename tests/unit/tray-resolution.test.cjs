const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { test } = require('node:test')
const { imageSize } = require('image-size')
const dir = path.resolve(__dirname, '../../src/static/images/tray')
test('Windows tray ICO contains native sizes from 100 through 400 percent', () => {
  const ico = fs.readFileSync(path.join(dir, 'tray_black.ico'))
  const count = ico.readUInt16LE(4)
  const sizes = Array.from({ length: count }, (_, i) => ico[6 + i * 16] || 256)
  for (const size of [16, 20, 24, 32, 48, 64]) assert.ok(sizes.includes(size), `Missing native ${size}px representation`)
})
test('tray PNGs provide exact native pixels for dark and light taskbars', () => {
  for (const prefix of ['tray_black', 'tray_white']) {
    for (const [suffix, size] of [['', 16], ['@1.25x', 20], ['@1.5x', 24], ['@2x', 32], ['@3x', 48], ['@4x', 64]]) {
      const dimensions = imageSize(fs.readFileSync(path.join(dir, prefix + suffix + '.png')))
      assert.equal(dimensions.width, size)
      assert.equal(dimensions.height, size)
    }
  }
})
