// Multi-Version Protocol Compatibility Adapter (Minecraft >= 1.14 [proto 477] -> 26.3 [proto 770+])
// ponytail: delegate durability to prismarine-item; gate protocol transitions via supportFeature()
import mcDataLoader from 'minecraft-data'
import mcDataObj from 'minecraft-data/data.js'

export const MIN_SUPPORTED_PROTOCOL = 477 // Minecraft 1.14 (lightSentSeparately + blockStateId)

if (mcDataObj.pc && !mcDataObj.pc['26.3']) {
  mcDataObj.pc['26.3'] = mcDataObj.pc['26.1'] || mcDataObj.pc['1.21.11'] || mcDataObj.pc['1.21.4']
}

export function resolveMcData(versionOrMcData = '1.21.4') {
  if (versionOrMcData && typeof versionOrMcData === 'object' && typeof versionOrMcData.supportFeature === 'function') {
    return versionOrMcData
  }
  const verStr = String(versionOrMcData || '1.21.4')
  const normalized = verStr === '26.3' && !mcDataLoader(verStr) ? '26.1' : verStr
  const data = mcDataLoader(verStr) || mcDataLoader(normalized) || mcDataLoader('1.21.4')
  if (!data) {
    throw new Error(`Unsupported Minecraft version: ${verStr}`)
  }
  return data
}

export function createVersionAdapter(versionOrMcData = '1.21.4') {
  const mcData = resolveMcData(versionOrMcData)
  const protocolVersion = mcData.version.version
  const minecraftVersion = String(versionOrMcData === '26.3' ? '26.3' : mcData.version.minecraftVersion)

  if (protocolVersion < MIN_SUPPORTED_PROTOCOL) {
    throw new RangeError(
      `Minecraft ${minecraftVersion} (protocol ${protocolVersion}) is below the >= 1.14 (protocol ${MIN_SUPPORTED_PROTOCOL}) paletted-section & separate-lighting floor`
    )
  }

  const tallWorld = Boolean(mcData.supportFeature('tallWorld'))
  const minY = tallWorld ? -64 : 0
  const maxY = tallWorld ? 319 : 255
  const numSections = tallWorld ? 24 : 16
  const optimalDiamondY = tallWorld ? -58 : 11
  const diamondOreNames = Object.freeze(tallWorld ? ['diamond_ore', 'deepslate_diamond_ore'] : ['diamond_ore'])
  let sequenceCounter = 0

  return Object.freeze({
    protocolVersion,
    minecraftVersion,
    tallWorld,
    minY,
    maxY,
    numSections,
    optimalDiamondY,
    diamondOreNames,
    lightSentSeparately: Boolean(mcData.supportFeature('lightSentSeparately')),
    blockStateId: Boolean(mcData.supportFeature('blockStateId')),
    hasChatSender: Boolean(mcData.supportFeature('clientboundChatHasSender')),
    hasDimensionData: Boolean(mcData.supportFeature('dimensionDataIsAvailable')),
    signedChat: Boolean(mcData.supportFeature('signedChat')),
    useChatSessions: Boolean(mcData.supportFeature('useChatSessions')),
    hasBundlePacket: Boolean(mcData.supportFeature('hasBundlePacket')),
    hasConfigState: Boolean(mcData.supportFeature('hasConfigurationState')),
    durabilitySerializeMode: protocolVersion >= 766 ? 'componentMap' : (mcData.supportFeature('whereDurabilityIsSerialized') || 'Damage'),
    hasTickEnd: Boolean(mcData.supportFeature('sendsClientTickEndPacket')),
    hasPlayerLoaded: Boolean(mcData.supportFeature('sendsPlayerLoadedPacket')),
    needsNetheriteUpgradeTemplate: protocolVersion >= 763,
    signHasFrontText: protocolVersion >= 763,

    sectionIndex(y) {
      const fy = Math.floor(Number(y))
      if (!Number.isFinite(fy) || fy < minY || fy > maxY) return -1
      return (fy - minY) >> 4
    },

    nextSequence() {
      sequenceCounter = (sequenceCounter + 1) & 0x7fffffff
      return sequenceCounter
    },

    getItemDurability(item) {
      if (!item) return null
      const max = Number(item.maxDurability || 0)
      if (max <= 0) return null
      let used = item.durabilityUsed
      if (used == null && item.componentMap && typeof item.componentMap.get === 'function') {
        used = item.componentMap.get('damage')?.data ?? 0
      }
      if (used == null && item.nbt?.value?.Damage?.value != null) {
        used = item.nbt.value.Damage.value
      }
      used = Number(used || 0)
      const remaining = Math.max(0, max - used)
      return {
        used,
        max,
        remaining,
        wearRatio: max > 0 ? used / max : 0,
        needsReplacement: remaining <= Math.ceil(max * 0.1)
      }
    },

    buildInitWorldPayload(worldEpoch = 1) {
      return {
        opCode: 0x00,
        minY,
        numSections,
        protocolVersion,
        worldEpoch: worldEpoch >>> 0
      }
    }
  })
}
