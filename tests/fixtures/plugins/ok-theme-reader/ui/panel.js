const api = window.agentPetsPlugin
const list = document.querySelector('#tokens')
const modeLabel = document.querySelector('#mode')
const eventsLabel = document.querySelector('#events')
let events = 0

function render(theme) {
  modeLabel.textContent = `(${theme.mode})`
  const style = getComputedStyle(document.documentElement)
  list.replaceChildren(...Object.keys(theme.tokens).map(name => {
    const item = document.createElement('li')
    const value = style.getPropertyValue(name).trim()
    if (value.startsWith('rgb(')) {
      const swatch = document.createElement('span')
      swatch.className = 'swatch'
      swatch.style.background = value
      item.append(swatch)
    }
    item.append(`${name}: ${value}`)
    return item
  }))
}

render(await api.theme.get())
api.theme.onDidChange(theme => {
  events += 1
  eventsLabel.textContent = String(events)
  render(theme)
})
