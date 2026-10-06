const path = require('node:path')
const { optimize } = require('svgo')

module.exports = function svgSymbol(source) {
  const name = path.basename(this.resourcePath, '.svg')
  if (!/^[a-z0-9-]+$/.test(name)) throw new Error('Invalid icon asset name')
  const svg = optimize(source, { path: this.resourcePath, plugins: ['removeDimensions'] }).data
  const match = /^<svg\b([^>]*)>([\s\S]*)<\/svg>$/.exec(svg)
  if (!match) throw new Error(`Invalid SVG icon: ${name}`)
  const viewBox = /\bviewBox="([^"]+)"/.exec(match[1])?.[1]
  if (!viewBox) throw new Error(`SVG icon has no viewBox: ${name}`)
  const id = `icon-${name}`
  const markup = `<symbol id="${id}" viewBox="${viewBox}">${match[2]}</symbol>`
  return `
    var sprite = document.getElementById('rain-svg-sprite');
    if (!sprite) {
      sprite = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      sprite.id = 'rain-svg-sprite';
      sprite.setAttribute('aria-hidden', 'true');
      sprite.style.display = 'none';
      document.body.appendChild(sprite);
    }
    if (!document.getElementById(${JSON.stringify(id)})) sprite.insertAdjacentHTML('beforeend', ${JSON.stringify(markup)});
    module.exports = ${JSON.stringify(id)};
  `
}
