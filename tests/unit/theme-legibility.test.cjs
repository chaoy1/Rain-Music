const test = require('node:test')
const assert = require('node:assert/strict')
const themes = require('../../src/common/theme/index.json')

const rgb = value => {
  const values = /^rgba?\(([^)]+)\)$/.exec(value)?.[1].split(',').map(Number)
  assert.ok(values && values.length >= 3, `Expected a concrete color, received ${value}`)
  return values
}
const over = (foreground, background) => foreground.slice(0, 3).map((v, i) => v * (foreground[3] ?? 1) + background[i] * (1 - (foreground[3] ?? 1)))
const luminance = color => color.slice(0, 3).map(c => c / 255).map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4).reduce((sum, c, i) => sum + c * [.2126, .7152, .0722][i], 0)
const contrast = (a, b) => {
  const [low, high] = [luminance(a), luminance(b)].sort((x, y) => x - y)
  return (high + .05) / (low + .05)
}

test('curated themes keep body, secondary text and accent readable on actual composited panels', () => {
  for (const id of ['mono', 'mono_dark', 'mist_blue', 'sand']) {
    const theme = themes.find(theme => theme.id === id)
    assert.ok(theme, `${id} is available`)
    const colors = { ...theme.config.themeColors, ...theme.config.extInfo }
    const app = rgb(colors['--color-app-background'])
    const panel = over(rgb(colors['--color-main-background']), app)
    for (const name of ['--color-font', '--color-font-label', '--color-primary']) {
      const value = colors[name] ?? colors[name === '--color-font' ? '--color-850' : '--color-450']
      const ratio = contrast(rgb(value), panel)
      assert.ok(ratio >= 4.5, `${id} ${name} has contrast ${ratio.toFixed(2)}, expected >= 4.5`)
    }
  }
})

test('colored presets leave reading surfaces neutral rather than washing content in accent color', () => {
  for (const id of ['mono', 'mist_blue', 'sand']) {
    const color = rgb(themes.find(theme => theme.id === id)?.config.extInfo['--color-main-background'])
    assert.ok(Math.max(...color.slice(0, 3)) - Math.min(...color.slice(0, 3)) <= 12, `${id} reading surface is neutral`)
  }
})

test('theme refresh retains old palette identities for existing saved settings', () => {
  for (const id of ['sage', 'green', 'blue', 'blue_plus', 'orange', 'red', 'pink', 'purple', 'grey', 'ming', 'blue2', 'black', 'mid_autumn', 'naruto', 'china_ink', 'happy_new_year']) {
    assert.ok(themes.some(theme => theme.id === id), `${id} remains loadable`)
  }
})
