// Plugin for app.json usage (regular Node.js context)
const plugin = require('./plugin/build/index.cjs')
module.exports = plugin.default || plugin
