import assert from 'node:assert'
import { EventEmitter } from 'node:events'
import * as autoEatPkg from 'mineflayer-auto-eat'
import mcData from 'minecraft-data'
import mcDataObj from 'minecraft-data/data.js'

if (mcDataObj.pc && !mcDataObj.pc['26.3']) {
  mcDataObj.pc['26.3'] = mcDataObj.pc['26.1'] || mcDataObj.pc['1.21.11']
}

// 1. Test bilingual plugin resolution
const autoEatPlugin = autoEatPkg.loader || autoEatPkg.plugin || autoEatPkg.default?.plugin || autoEatPkg.default?.loader || autoEatPkg.default
assert.strictEqual(typeof autoEatPlugin, 'function', 'autoEatPlugin must resolve to a function')

// 2. Test mock bot hasPlugin and loadPlugin contract
const bot = new EventEmitter()
bot._client = new EventEmitter()
bot.version = '26.3'
bot.registry = mcData('26.3')
bot.entity = { id: 1, height: 1.6, position: { x: 0, y: 64, z: 0 }, yaw: 0, pitch: 0 }
bot.entities = {}
bot.inventory = { items: () => [], slots: [] }
bot.supportFeature = () => false

const _plugins = new Set()
bot.hasPlugin = (plugin) => _plugins.has(plugin)
bot.loadPlugin = (plugin) => {
  const fn = plugin?.default || plugin
  if (typeof fn === 'function') {
    if (_plugins.has(fn)) return
    _plugins.add(fn)
    fn(bot)
  }
}

bot.loadPlugin(autoEatPlugin)
assert.ok(bot.hasPlugin(autoEatPlugin), 'bot.hasPlugin must return true after loading')
assert.ok(bot.autoEat, 'bot.autoEat instance must be attached to bot')

// 3. Test dual-version options configuration shim
const opts = bot.autoEat.opts || bot.autoEat.options || {}
opts.priority = 'foodPoints'
opts.bannedFood = ['rotten_flesh', 'poisonous_potato']
if (typeof bot.autoEat.setOpts === 'function') {
  bot.autoEat.setOpts({ priority: opts.priority, bannedFood: opts.bannedFood })
}
const effectivePriority = bot.autoEat.opts?.priority || bot.autoEat.options?.priority
assert.strictEqual(effectivePriority, 'foodPoints', 'autoEat priority must be configured to foodPoints')

// 4. Test dual-version lifecycle enable/disable methods
const disableFn = bot.autoEat.disable || bot.autoEat.disableAuto
const enableFn = bot.autoEat.enable || bot.autoEat.enableAuto
assert.strictEqual(typeof disableFn, 'function', 'disable or disableAuto must exist')
assert.strictEqual(typeof enableFn, 'function', 'enable or enableAuto must exist')

console.log('[PASS] auto_eat bilingual plugin resolution and mock contract verified')
