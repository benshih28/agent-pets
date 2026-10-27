const api = window.agentPetsPlugin
const storageResult = document.querySelector('#storage-result')
const messageResult = document.querySelector('#message-result')
const read = await api.storage.get('panel-demo')
storageResult.textContent = read.found ? `Storage: ${read.value.value}` : 'Storage: missing'

api.ui.onMessage(message => {
  if (message?.type === 'panel-demo:pong') messageResult.textContent = `Worker reply: ${message.value}`
})

document.querySelector('#send-message').addEventListener('click', async () => {
  const result = await api.ui.postMessage({ type: 'panel-demo:ping', value: 'hello from panel' })
  messageResult.textContent = `Message delivered: ${result.delivered}`
})
