export default {
  activate(api) {
    api.log.info('evil-loop entered its blocking loop')
    while (true) {}
  },
}
