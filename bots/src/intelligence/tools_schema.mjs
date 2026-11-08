// OpenAI/9Router Tool Schema Definitions for Autonomous Minecraft Agents

export const TOOLS_SCHEMA = [
  {
    type: 'function',
    function: {
      name: 'collect_blocks',
      description: 'Find and mine blocks from the world (e.g. oak_log, stone, coal_ore, iron_ore, dirt).',
      parameters: {
        type: 'object',
        properties: {
          block_name: { type: 'string', description: 'Minecraft block ID, e.g. oak_log, stone, dirt' },
          count: { type: 'integer', description: 'Number of blocks to mine (max 10)' }
        },
        required: ['block_name', 'count']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'deconstruct_area',
      description: 'Clear an area or quarry blocks top-down in a volume.',
      parameters: {
        type: 'object',
        properties: {
          radius: { type: 'integer', description: 'Radius around target in blocks (1-5, default 3)' },
          height: { type: 'integer', description: 'Height depth in blocks (1-5, default 2)' }
        },
        required: ['radius']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'attack_mob',
      description: 'Attack a nearby hostile or passive mob.',
      parameters: {
        type: 'object',
        properties: {
          mob_name: { type: 'string', description: 'Entity name, e.g. zombie, skeleton, spider, cow, pig' }
        },
        required: ['mob_name']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'follow_player',
      description: 'Follow the player who sent the message or nearest player.',
      parameters: {
        type: 'object',
        properties: {}
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'stay',
      description: 'Stop moving and stay at the current location.',
      parameters: {
        type: 'object',
        properties: {}
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'stop',
      description: 'Halt all actions and stand still.',
      parameters: {
        type: 'object',
        properties: {}
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'build_structure',
      description: 'Build structures or place blocks in the world. Types: "wall" (defensive barrier), "shelter" (hollow safety box with doorway), "pillar" (vertical tower), "floor" (flat platform), or "single" (single block like crafting table, torch, chest).',
      parameters: {
        type: 'object',
        properties: {
          structure_type: {
            type: 'string',
            enum: ['wall', 'shelter', 'pillar', 'floor', 'single'],
            description: 'Type of structure to build'
          },
          material: {
            type: 'string',
            description: 'Block material to place from inventory, e.g. dirt, cobblestone, oak_planks, crafting_table, torch'
          },
          size: {
            type: 'integer',
            description: 'Width or height size parameter (1-5, default 3)'
          }
        },
        required: ['structure_type', 'material']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'goto_coordinates',
      description: 'Walk or pathfind to explicit (x, y, z) 3D world coordinates safely with hop slicing.',
      parameters: {
        type: 'object',
        properties: {
          x: { type: 'number', description: 'X coordinate' },
          y: { type: 'number', description: 'Y coordinate (elevation)' },
          z: { type: 'number', description: 'Z coordinate' }
        },
        required: ['x', 'y', 'z']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'reply_chat',
      description: 'Say a verbal message or answer back to the player in game chat.',
      parameters: {
        type: 'object',
        properties: {
          message: { type: 'string', description: 'Short chat response (max 100 chars)' }
        },
        required: ['message']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'break_block',
      description: 'Break a specific block at 3D world coordinates (x, y, z).',
      parameters: {
        type: 'object',
        properties: {
          x: { type: 'number', description: 'X coordinate of block' },
          y: { type: 'number', description: 'Y coordinate of block' },
          z: { type: 'number', description: 'Z coordinate of block' }
        },
        required: ['x', 'y', 'z']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'inspect_block',
      description: 'Identify and inspect the block the bot is currently looking at with raycasting.',
      parameters: {
        type: 'object',
        properties: {}
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'activate_block',
      description: 'Interact with or use functional blocks such as doors, levers, chests, or crafting tables.',
      parameters: {
        type: 'object',
        properties: {
          block_name: { type: 'string', description: 'Block type name (e.g. oak_door, lever, chest, crafting_table)' },
          x: { type: 'number', description: 'Optional X coordinate' },
          y: { type: 'number', description: 'Optional Y coordinate' },
          z: { type: 'number', description: 'Optional Z coordinate' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'give_to_player',
      description: 'Walk up to a player, face them, and toss/give items from bot inventory.',
      parameters: {
        type: 'object',
        properties: {
          item_name: { type: 'string', description: 'Name of the item to give (or "all")' },
          count: { type: 'integer', description: 'Number of items to give (default 1)' },
          player_name: { type: 'string', description: 'Target player username' }
        },
        required: ['item_name']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'delegate_task',
      description: 'Command a squad member (Bob, Torin, Arthur, Willow) to perform an action. You are the orchestrator.',
      parameters: {
        type: 'object',
        properties: {
          target_agent: {
            type: 'string',
            enum: ['Bob', 'Torin', 'Arthur', 'Willow', 'Jotaro'],
            description: 'Target squad member name'
          },
          command: {
            type: 'string',
            description: 'Command or instruction for the agent (e.g. "!mine iron_ore 5", "!build wall dirt", "!stay", "!survey", "!come", "!attack_mob zombie")'
          },
          tactical_brief: {
            type: 'string',
            description: 'Short tactical context or reason for this squad order'
          }
        },
        required: ['target_agent', 'command']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'bootstrap_tools',
      description: 'Progress through survival tool tech tree: logs -> planks -> crafting table -> wooden pickaxe -> cobblestone -> stone tools.',
      parameters: {
        type: 'object',
        properties: {}
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'manage_farm',
      description: 'Till 9x9 hydrated farmland around water, plant seeds, harvest mature crops, and bake bread.',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['establish', 'harvest', 'bake'],
            description: 'Action to perform: "establish" to till/plant 9x9 farm, "harvest" to reap & replant, "bake" to turn wheat into bread'
          }
        },
        required: ['action']
      }
    }
  }
]
