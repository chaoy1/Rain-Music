/** Keep accessible names on every control, but show only useful hover labels. */
export const getTipText = (node: Element | null): string | null => {
  if (!node || node.nodeType !== 1 || node.getAttribute('ignore-tip') != null) return null
  const label = node.getAttribute('aria-label')?.trim()
  if (!label) return null
  if (node.matches('[role="group"], ul, ol, nav, section')) return null
  if (node.matches('button, [role="button"], a') && !node.textContent?.trim() && node.querySelector('svg, img')) return label
  if (!node.textContent?.trim()) return null
  const truncated = [node, ...node.querySelectorAll('span, p')].some(el => el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1)
  return truncated ? label : null
}
